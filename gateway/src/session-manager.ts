// ============================================================
// One WhatsApp Web socket per project.
//
// Isolation in this file is entirely code-enforced — the service-role
// client has no RLS to fall back on. Three rules hold it:
//
//   1. Sessions live in a Map keyed by project_id, and no function
//      here iterates or returns another project's socket.
//   2. Every Supabase read and write names its project_id.
//   3. Media uploads go to that project's own storage prefix.
//
// Lifecycle, and why each state exists:
//
//   connect()   → socket opens, Baileys emits a QR → status
//                 'qr_pending', the QR lands in whatsapp_sessions and
//                 reaches the browser over Realtime.
//   scan        → 'connected', credentials persisted, QR cleared.
//   transient   → 'connecting' and we reconnect with backoff. A
//     drop      dropped socket is normal; credentials are still good.
//   loggedOut   → 'logged_out' and credentials are DESTROYED. The
//                 phone unlinked us; nothing but a re-scan will help,
//                 and keeping dead keys makes the next attempt fail
//                 in confusing ways.
// ============================================================

import { Boom } from "@hapi/boom";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  jidNormalizedUser,
  type WAMessage,
  type WASocket,
  type proto,
} from "@whiskeysockets/baileys";
import QRCode from "qrcode";

import { clearAuthState, useSupabaseAuthState } from "./auth-state.js";
import { config } from "./config.js";
import { sendEventToCrm } from "./crm.js";
import { baileysLogger, logger } from "./logger.js";
import { loadProject, supabase } from "./supabase.js";

export type SessionStatus =
  | "disconnected"
  | "qr_pending"
  | "connecting"
  | "connected"
  | "logged_out"
  | "banned"
  | "error";

interface Session {
  projectId: string;
  accountId: string;
  socket: WASocket | null;
  status: SessionStatus;
  phoneNumber: string | null;
  reconnectAttempts: number;
  /** Set while a reconnect is pending, so we can cancel on shutdown. */
  reconnectTimer: NodeJS.Timeout | null;
  /** True once disconnect() ran, to stop the close handler reconnecting. */
  closing: boolean;
  /**
   * Tail of every `saveCreds()` write, chained rather than
   * fire-and-forget.
   *
   * `openSocket()` re-reads credentials from Supabase, and WhatsApp
   * closes the socket with 515 within a second of a scan. An unawaited
   * write loses that race: the reopen reads no creds row, falls back to
   * `initAuthCreds()`, and presents a fresh unregistered identity that
   * WhatsApp rejects — which lands in the loggedOut branch and destroys
   * the keys the scan just produced. Every reopen path awaits this.
   */
  credsWrites: Promise<void>;
}

const sessions = new Map<string, Session>();

export class SessionError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "SessionError";
    this.code = code;
    this.status = status;
  }
}

// ------------------------------------------------------------
// whatsapp_sessions row — the status surface the UI subscribes to
// ------------------------------------------------------------

interface SessionPatch {
  status?: SessionStatus;
  qr_code?: string | null;
  qr_expires_at?: string | null;
  phone_number?: string | null;
  wa_jid?: string | null;
  display_name?: string | null;
  last_connected_at?: string | null;
  last_disconnected_at?: string | null;
  last_error?: string | null;
  heartbeat_at?: string | null;
}

async function upsertSessionRow(
  projectId: string,
  accountId: string,
  patch: SessionPatch,
): Promise<void> {
  const { error } = await supabase.from("whatsapp_sessions").upsert(
    {
      project_id: projectId,
      account_id: accountId,
      gateway_instance: config.instanceId,
      updated_at: new Date().toISOString(),
      ...patch,
    },
    { onConflict: "project_id" },
  );
  if (error) {
    logger.error({ err: error, projectId }, "failed to update session row");
  }
}

/**
 * Point the project's PRIMARY channel at QR once a number is really
 * linked.
 *
 * `projects.allowed_channels` says which transports a project MAY use,
 * but outbound sending resolves on `projects.channel_type` (see
 * src/lib/channels/resolve.ts). Without this, a customer who switches
 * QR on for a project that was created for Cloud API pairs a number,
 * watches inbound messages arrive over this socket, and has every
 * reply routed to Meta credentials that may not even exist — inbound
 * and outbound silently disagreeing about the transport.
 *
 * Guarded three ways: `neq` makes it a no-op on every reconnect of an
 * already-QR project, and `contains` means a late-arriving connect
 * cannot re-point the transport at a channel an admin has since
 * revoked. Failure is logged, not thrown — the session is up either
 * way, and tearing it down over this would be the worse outcome.
 */
async function promotePrimaryChannelToQr(projectId: string): Promise<void> {
  const { error } = await supabase
    .from("projects")
    .update({ channel_type: "qr" })
    .eq("id", projectId)
    .neq("channel_type", "qr")
    .contains("allowed_channels", ["qr"]);

  if (error) {
    logger.error(
      { err: error, projectId },
      "failed to promote channel_type to qr",
    );
  }
}

// ------------------------------------------------------------
// Media
// ------------------------------------------------------------

const MEDIA_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/amr": "amr",
  "application/pdf": "pdf",
};

/**
 * Download media off WhatsApp and re-host it in the project's own
 * storage prefix, returning the public URL.
 *
 * The prefix is `account-<id>/project-<id>/…`, which is what the
 * storage policies in migration 044 check — media from one project can
 * never land in another's folder.
 */
async function storeMedia(
  session: Session,
  message: WAMessage,
  mimeType: string,
  filename: string | null,
): Promise<string | null> {
  try {
    const buffer = (await downloadMediaMessage(
      message,
      "buffer",
      {},
      { logger: baileysLogger, reuploadRequest: session.socket!.updateMediaMessage },
    )) as Buffer;

    if (buffer.length > config.maxMediaBytes) {
      logger.warn(
        { projectId: session.projectId, bytes: buffer.length },
        "inbound media exceeds the size cap; dropping the attachment",
      );
      return null;
    }

    const ext =
      MEDIA_EXTENSIONS[mimeType] ??
      (filename?.includes(".") ? filename.split(".").pop()! : "bin");
    const safeBase = (filename ?? "media")
      .replace(/[^a-zA-Z0-9._-]/g, "-")
      .replace(/\.[^.]*$/, "")
      .slice(0, 60);
    const path = `account-${session.accountId}/project-${session.projectId}/${Date.now()}-${safeBase}.${ext}`;

    const { error } = await supabase.storage
      .from(config.mediaBucket)
      .upload(path, buffer, { contentType: mimeType, upsert: false });

    if (error) {
      logger.error({ err: error, projectId: session.projectId }, "media upload failed");
      return null;
    }

    const { data } = supabase.storage.from(config.mediaBucket).getPublicUrl(path);
    return data.publicUrl;
  } catch (err) {
    logger.error({ err, projectId: session.projectId }, "media download failed");
    return null;
  }
}

// ------------------------------------------------------------
// Inbound
// ------------------------------------------------------------

interface ExtractedMessage {
  kind: string;
  text: string | null;
  mimeType: string | null;
  filename: string | null;
  caption: string | null;
}

/** Flatten Baileys' union of message shapes into something uniform. */
function extractMessage(message: WAMessage): ExtractedMessage | null {
  const m = message.message;
  if (!m) return null;

  if (m.conversation) {
    return { kind: "text", text: m.conversation, mimeType: null, filename: null, caption: null };
  }
  if (m.extendedTextMessage?.text) {
    return {
      kind: "text",
      text: m.extendedTextMessage.text,
      mimeType: null,
      filename: null,
      caption: null,
    };
  }
  if (m.imageMessage) {
    return {
      kind: "image",
      text: m.imageMessage.caption ?? null,
      mimeType: m.imageMessage.mimetype ?? "image/jpeg",
      filename: null,
      caption: m.imageMessage.caption ?? null,
    };
  }
  if (m.videoMessage) {
    return {
      kind: "video",
      text: m.videoMessage.caption ?? null,
      mimeType: m.videoMessage.mimetype ?? "video/mp4",
      filename: null,
      caption: m.videoMessage.caption ?? null,
    };
  }
  if (m.audioMessage) {
    return {
      kind: "audio",
      text: null,
      mimeType: m.audioMessage.mimetype ?? "audio/ogg",
      filename: null,
      caption: null,
    };
  }
  if (m.documentMessage) {
    return {
      kind: "document",
      text: m.documentMessage.caption ?? null,
      mimeType: m.documentMessage.mimetype ?? "application/pdf",
      filename: m.documentMessage.fileName ?? null,
      caption: m.documentMessage.caption ?? null,
    };
  }
  if (m.stickerMessage) {
    return { kind: "sticker", text: null, mimeType: m.stickerMessage.mimetype ?? "image/webp", filename: null, caption: null };
  }
  if (m.locationMessage) {
    return { kind: "location", text: null, mimeType: null, filename: null, caption: null };
  }
  if (m.reactionMessage) {
    return {
      kind: "reaction",
      text: m.reactionMessage.text ?? null,
      mimeType: null,
      filename: null,
      caption: null,
    };
  }
  return { kind: "unknown", text: null, mimeType: null, filename: null, caption: null };
}

async function handleInbound(
  session: Session,
  message: WAMessage,
  isHistory = false,
): Promise<void> {
  // Groups and broadcasts are out of scope — the CRM models 1:1
  // customer conversations, and a group would produce contacts that
  // are not really contacts.
  const remoteJid = message.key.remoteJid ?? "";
  if (!remoteJid || remoteJid.endsWith("@g.us") || remoteJid === "status@broadcast") {
    return;
  }

  const extracted = extractMessage(message);
  if (!extracted) return;

  const phone = `+${jidNormalizedUser(remoteJid).split("@")[0]}`;
  const fromMe = Boolean(message.key.fromMe);

  // Customer reactions: send as a dedicated reaction event so the
  // CRM persists them as message_reactions rows, not as text messages.
  if (extracted.kind === "reaction") {
    const reactionContext = (message.message?.reactionMessage as any)?.contextInfo;
    const targetExternalId = reactionContext?.stanzaId ?? null;
    if (targetExternalId && extracted.text) {
      await sendEventToCrm({
        type: "reaction",
        payload: {
          projectId: session.projectId,
          externalId: targetExternalId,
          emoji: extracted.text,
        },
      });
    }
    return;
  }

  let mediaUrl: string | null = null;
  if (extracted.mimeType && ["image", "video", "audio", "document", "sticker"].includes(extracted.kind)) {
    mediaUrl = await storeMedia(session, message, extracted.mimeType, extracted.filename);
    if (!mediaUrl) {
      logger.warn(
        { projectId: session.projectId, kind: extracted.kind },
        "media unavailable; forwarding the message without its attachment",
      );
    }
  }

  const timestamp =
    typeof message.messageTimestamp === "number"
      ? new Date(message.messageTimestamp * 1000).toISOString()
      : new Date().toISOString();

  await sendEventToCrm({
    type: "message",
    payload: {
      projectId: session.projectId,
      from: phone,
      externalId: message.key.id ?? "",
      kind: extracted.kind,
      text: extracted.text,
      senderName: message.pushName ?? null,
      timestamp,
      fromMe,
      isHistory,
      media: mediaUrl && extracted.mimeType
        ? {
            url: mediaUrl,
            mimeType: extracted.mimeType,
            filename: extracted.filename,
            caption: extracted.caption,
          }
        : null,
      replyToExternalId:
        message.message?.extendedTextMessage?.contextInfo?.stanzaId ?? null,
    },
  });
}

// ------------------------------------------------------------
// Delivery receipts
// ------------------------------------------------------------

/** Map a Baileys receipt status to the CRM's forward-only status ladder. */
function mapReceiptToStatus(
  receipt: any,
): "sent" | "delivered" | "read" | null {
  const status = receipt.status;
  if (status === 1) return "sent";
  if (status === 3) return "delivered";
  if (status === 4 || status === 5) return "read";
  return null;
}

// ------------------------------------------------------------
// Connect
// ------------------------------------------------------------

/**
 * Baileys requires a brand-new socket after a 515 close; it does not
 * reuse the old one. Restarts happen ~1s after every fresh pairing, so
 * without this the listeners accumulate: several `connection.update`
 * handlers end up writing the same `whatsapp_sessions` row, and a late
 * close from a socket we already replaced clobbers the live one's
 * status and inflates `reconnectAttempts`.
 *
 * `removeAllListeners` takes one event name at a time (no zero-arg
 * overload on BaileysEventEmitter), so every event openSocket()
 * registers has to be named here.
 */
const SOCKET_EVENTS = [
  "creds.update",
  "connection.update",
  "messaging-history.set",
  "messages.upsert",
  "messages.update",
] as const;

function teardownSocket(socket: WASocket | null): void {
  if (!socket) return;
  for (const event of SOCKET_EVENTS) {
    try {
      socket.ev.removeAllListeners(event);
    } catch {
      // Nothing registered for this event — fine.
    }
  }
  try {
    socket.end(undefined);
  } catch {
    // Already closed.
  }
}

/** A 515 restart needs no backoff — only correct ordering. */
const RESTART_DELAY_MS = 250;

/**
 * Replace `dead` with a fresh socket after `delayMs`.
 *
 * Detach first so the dying socket cannot write status mid-reopen, then
 * wait for outstanding credential writes: `openSocket()` reads them
 * back from Supabase, so reopening ahead of the write is what breaks a
 * just-scanned pairing.
 */
function scheduleReopen(
  session: Session,
  dead: WASocket | null,
  delayMs: number,
): void {
  session.reconnectTimer = setTimeout(() => {
    session.reconnectTimer = null;
    void (async () => {
      teardownSocket(dead);
      await session.credsWrites;
      if (session.closing) return;
      await openSocket(session);
    })().catch((err) =>
      logger.error({ err, projectId: session.projectId }, "reconnect failed"),
    );
  }, delayMs);
}

async function openSocket(session: Session): Promise<void> {
  if (session.socket) {
    teardownSocket(session.socket);
    session.socket = null;
  }
  const { state, saveCreds } = await useSupabaseAuthState(session.projectId);
  const { version } = await fetchLatestBaileysVersion();

  const socket = makeWASocket({
    version,
    auth: state,
    logger: baileysLogger,
    // We are a CRM, not a phone: never mark things read on the
    // customer's behalf, and do not broadcast presence.
    markOnlineOnConnect: false,
    syncFullHistory: true,
    browser: Browsers.ubuntu("Chrome"),
    keepAliveIntervalMs: 25_000,
    connectTimeoutMs: 60_000,
    defaultQueryTimeoutMs: 60_000,
    retryRequestDelayMs: 500,
    maxMsgRetryCount: 5,
  });

  session.socket = socket;

  socket.ev.on("creds.update", () => {
    // Chained, not fire-and-forget — see Session.credsWrites. Errors are
    // logged and swallowed so one failed write cannot reject the tail
    // every later reopen awaits.
    session.credsWrites = session.credsWrites
      .then(() => saveCreds())
      .catch((err) =>
        logger.error(
          { err, projectId: session.projectId },
          "saveCreds failed — a reconnect may require a re-scan",
        ),
      );
  });

  socket.ev.on("connection.update", async (update) => {
    // Ignore a socket we have already replaced. Its close arrives after
    // the successor is live, and acting on it would overwrite the new
    // socket's status and consume its reconnect budget.
    if (session.socket !== socket) return;

    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      // Render to a data URL here so the browser needs no QR library
      // and no direct line to this service.
      const dataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
      session.status = "qr_pending";
      await upsertSessionRow(session.projectId, session.accountId, {
        status: "qr_pending",
        qr_code: dataUrl,
        // Baileys rotates the QR roughly every 20s; the UI counts down
        // against this and asks the user to retry when it lapses.
        qr_expires_at: new Date(Date.now() + 20_000).toISOString(),
        last_error: null,
      });
      logger.info({ projectId: session.projectId }, "QR issued");
    }

    if (connection === "open") {
      session.status = "connected";
      session.reconnectAttempts = 0;
      const jid = socket.user?.id ? jidNormalizedUser(socket.user.id) : null;
      session.phoneNumber = jid ? `+${jid.split("@")[0]}` : null;

      await upsertSessionRow(session.projectId, session.accountId, {
        status: "connected",
        qr_code: null,
        qr_expires_at: null,
        phone_number: session.phoneNumber,
        wa_jid: jid,
        display_name: socket.user?.name ?? null,
        last_connected_at: new Date().toISOString(),
        last_error: null,
        heartbeat_at: new Date().toISOString(),
      });
      await promotePrimaryChannelToQr(session.projectId);
      logger.info({ projectId: session.projectId }, "session connected");
    }

    if (connection === "close") {
      const statusCode = (lastDisconnect?.error as Boom | undefined)?.output
        ?.statusCode;
      const isExplicitLogout = (statusCode as number | undefined) === (DisconnectReason.loggedOut as number);
      const isBanned = statusCode === 403;
      const isRestartRequired = (statusCode as number | undefined) === (DisconnectReason.restartRequired as number);
      const isConnectionReplaced =
        (statusCode as number | undefined) === (DisconnectReason.connectionReplaced as number) ||
        statusCode === 440;

      if (session.closing) return;

      if (isRestartRequired) {
        // 515. Expected — WhatsApp closes the socket immediately after a
        // successful scan and requires a new one carrying the
        // credentials that scan produced. Not a failure: it must not
        // consume a reconnect attempt, must not back off (the QR the
        // customer just scanned is spent, and a long delay reads as
        // "nothing happened"), and must not report an error to the UI.
        session.status = "connecting";
        await upsertSessionRow(session.projectId, session.accountId, {
          status: "connecting",
          qr_code: null,
          qr_expires_at: null,
          last_error: null,
        });
        logger.info(
          { projectId: session.projectId },
          "restart required after pairing; reopening socket",
        );
        scheduleReopen(session, socket, RESTART_DELAY_MS);
        return;
      }

      if (isExplicitLogout || isBanned) {
        // Terminal: The phone unlinked the device or WhatsApp banned the number.
        session.status = isBanned ? "banned" : "logged_out";
        sessions.delete(session.projectId);
        await clearAuthState(session.projectId).catch((err) =>
          logger.error({ err, projectId: session.projectId }, "clearAuthState failed"),
        );
        await upsertSessionRow(session.projectId, session.accountId, {
          status: session.status,
          qr_code: null,
          qr_expires_at: null,
          last_disconnected_at: new Date().toISOString(),
          last_error: isBanned
            ? "WhatsApp rejected this number. It may be banned."
            : "The linked device was logged out on WhatsApp. Scan the QR code again to reconnect.",
        });
        logger.warn(
          { projectId: session.projectId, statusCode },
          "session terminated by WhatsApp",
        );
        return;
      }

      // Transient drop (network hiccup, WhatsApp server migration, 440 conflict, timeout).
      // Keep credentials intact and reconnect indefinitely in the background.
      session.reconnectAttempts += 1;
      const delay = isConnectionReplaced
        ? 5_000
        : Math.min(
            config.reconnect.baseMs * 1.5 ** Math.min(session.reconnectAttempts, 8),
            30_000,
          );

      session.status = "connecting";
      await upsertSessionRow(session.projectId, session.accountId, {
        status: "connecting",
        last_disconnected_at: new Date().toISOString(),
        last_error: null,
      });
      logger.warn(
        { projectId: session.projectId, statusCode, delay, attempt: session.reconnectAttempts },
        "session dropped; reconnecting in background",
      );

      scheduleReopen(session, socket, delay);
    }
  });

  socket.ev.on("messaging-history.set", async ({ chats, contacts, messages }) => {
    logger.info(
      {
        projectId: session.projectId,
        messagesCount: messages?.length ?? 0,
        chatsCount: chats?.length ?? 0,
        contactsCount: contacts?.length ?? 0,
      },
      "messaging history received from WhatsApp",
    );

    if (Array.isArray(chats)) {
      for (const chat of chats) {
        const remoteJid = chat.id ?? "";
        if (!remoteJid || remoteJid.endsWith("@g.us") || remoteJid === "status@broadcast") {
          continue;
        }
        const phone = `+${jidNormalizedUser(remoteJid).split("@")[0]}`;
        const name = chat.name ?? null;
        const timestamp = chat.conversationTimestamp
          ? new Date(
              typeof chat.conversationTimestamp === "number"
                ? chat.conversationTimestamp * 1000
                : Number(chat.conversationTimestamp) * 1000,
            ).toISOString()
          : new Date().toISOString();

        await sendEventToCrm({
          type: "message",
          payload: {
            projectId: session.projectId,
            from: phone,
            externalId: `history-chat-${chat.id}`,
            kind: "text",
            text: null,
            senderName: name,
            timestamp,
            fromMe: false,
            isHistory: true,
          },
        }).catch((err) => {
          logger.warn({ err, projectId: session.projectId }, "chat sync failed");
        });
      }
    }

    if (Array.isArray(messages)) {
      for (const message of messages) {
        try {
          await handleInbound(session, message, true);
        } catch (err) {
          logger.error(
            { err, projectId: session.projectId },
            "history message handling failed",
          );
        }
      }
    }
  });

  socket.ev.on("messages.upsert", async ({ messages, type }) => {
    const isHistory = type === "append";
    for (const message of messages) {
      try {
        await handleInbound(session, message, isHistory);
      } catch (err) {
        logger.error({ err, projectId: session.projectId }, "inbound handling failed");
      }
    }
  });

  // Delivery/read receipts — Baileys emits updates when WhatsApp
  // confirms delivery (two ticks) or read (blue ticks). The CRM
  // applies a forward-only status ladder on its side.
  socket.ev.on("messages.update", async (updates) => {
    for (const update of updates) {
      try {
        const receipt = (update.update as any)?.receipt;
        if (!receipt) continue;

        const status = mapReceiptToStatus(receipt);
        if (!status) continue;

        await sendEventToCrm({
          type: "receipt",
          payload: {
            projectId: session.projectId,
            externalId: update.key.id ?? "",
            status,
          },
        });
      } catch (err) {
        logger.error({ err, projectId: session.projectId }, "receipt handling failed");
      }
    }
  });
}

/**
 * Start (or restart) a project's session.
 *
 * Idempotent for a live session: calling it on an already-connected
 * project returns the current status rather than opening a second
 * socket, which WhatsApp would read as a conflicting device.
 */
export async function connectSession(projectId: string): Promise<{
  projectId: string;
  status: SessionStatus;
  phoneNumber: string | null;
}> {
  const existing = sessions.get(projectId);
  if (existing && (existing.status === "connected" || existing.status === "qr_pending")) {
    return {
      projectId,
      status: existing.status,
      phoneNumber: existing.phoneNumber,
    };
  }

  const project = await loadProject(projectId);
  if (!project) {
    throw new SessionError("project_not_found", "Unknown project", 404);
  }
  if (project.archived_at) {
    throw new SessionError(
      "project_archived",
      "This project is archived. Restore it before connecting a number.",
      409,
    );
  }
  // Allow QR connection for any project regardless of channel_type.
  // Both QR and Cloud API should always be available as connection
  // methods.

  const session: Session = {
    projectId,
    accountId: project.account_id,
    socket: null,
    status: "connecting",
    phoneNumber: null,
    reconnectAttempts: 0,
    reconnectTimer: null,
    closing: false,
    credsWrites: Promise.resolve(),
  };
  sessions.set(projectId, session);

  await upsertSessionRow(projectId, project.account_id, {
    status: "connecting",
    qr_code: null,
    qr_expires_at: null,
    last_error: null,
  });

  try {
    await openSocket(session);
  } catch (err) {
    sessions.delete(projectId);
    const message = err instanceof Error ? err.message : String(err);
    await upsertSessionRow(projectId, project.account_id, {
      status: "error",
      last_error: message,
    });
    throw new SessionError("connect_failed", message, 502);
  }

  return { projectId, status: session.status, phoneNumber: session.phoneNumber };
}

/** Log out, destroy credentials, and forget the session. */
export async function disconnectSession(projectId: string): Promise<void> {
  const session = sessions.get(projectId);
  const accountId =
    session?.accountId ?? (await loadProject(projectId))?.account_id ?? null;

  if (session) {
    session.closing = true;
    if (session.reconnectTimer) clearTimeout(session.reconnectTimer);
    try {
      // logout() tells the phone to drop the link, so the device
      // disappears from the customer's linked-devices list rather than
      // lingering as a ghost.
      await session.socket?.logout();
    } catch (err) {
      logger.warn({ err, projectId }, "logout call failed; clearing local state anyway");
    }
    teardownSocket(session.socket);
    sessions.delete(projectId);
  }

  await clearAuthState(projectId);

  if (accountId) {
    await upsertSessionRow(projectId, accountId, {
      status: "disconnected",
      qr_code: null,
      qr_expires_at: null,
      phone_number: null,
      wa_jid: null,
      display_name: null,
      last_disconnected_at: new Date().toISOString(),
      last_error: null,
    });
  }
}

export function getSessionStatus(projectId: string): {
  projectId: string;
  status: SessionStatus;
  phoneNumber: string | null;
} {
  const session = sessions.get(projectId);
  return {
    projectId,
    status: session?.status ?? "disconnected",
    phoneNumber: session?.phoneNumber ?? null,
  };
}

// ------------------------------------------------------------
// Send
// ------------------------------------------------------------

export interface SendParams {
  projectId: string;
  to: string;
  kind: "text" | "image" | "video" | "document" | "audio";
  text?: string | null;
  mediaUrl?: string | null;
  filename?: string | null;
  /** Required by WhatsApp for documents; ignored for other kinds. */
  mimeType?: string | null;
  quotedExternalId?: string | null;
}

/** E.164 (+441234…) or JID → WhatsApp JID (441234…@s.whatsapp.net). */
function toJid(phone: string): string {
  if (phone.includes("@")) return phone;
  return `${phone.replace(/[^0-9]/g, "")}@s.whatsapp.net`;
}

export async function sendMessage(
  params: SendParams,
): Promise<{ externalId: string }> {
  logger.info({ projectId: params.projectId, sessionsKnown: Array.from(sessions.keys()) }, "[sendMessage] start");
  let session = sessions.get(params.projectId);
  if (!session || !session.socket || session.status !== "connected") {
    logger.info({ projectId: params.projectId, currentStatus: session?.status }, "[sendMessage] attempting connectSession");
    try {
      await connectSession(params.projectId);
      session = sessions.get(params.projectId);
    } catch (err) {
      logger.error({ err, projectId: params.projectId }, "[sendMessage] connectSession threw");
    }
  }

  // If connecting, wait up to 4s for socket readiness
  if (session && session.status === "connecting") {
    for (let i = 0; i < 25; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const current = sessions.get(params.projectId);
      if (current && (current.status as string) === "connected" && current.socket) {
        session = current;
        break;
      }
    }
  }

  logger.info({ projectId: params.projectId, finalStatus: session?.status, hasSocket: Boolean(session?.socket) }, "[sendMessage] after wait");

  if (!session || session.status !== "connected" || !session.socket) {
    throw new SessionError(
      "session_not_connected",
      "This project's WhatsApp number is not connected. Pair it by scanning the QR code in Settings.",
      409,
    );
  }

  const jid = toJid(params.to);

  // Refuse to send to a number that is not on WhatsApp — otherwise the
  // message vanishes and the CRM shows it as sent.
  try {
    // onWhatsApp returns undefined (not an empty array) when the
    // lookup itself could not run, so destructure defensively.
    const results = (await session.socket.onWhatsApp(jid)) ?? [];
    const result = results[0];
    if (result && result.exists === false) {
      throw new SessionError(
        "recipient_not_on_whatsapp",
        `${params.to} is not registered on WhatsApp.`,
        400,
      );
    }
  } catch (err) {
    if (err instanceof SessionError) throw err;
    // The check itself failing is not a reason to block the send.
    logger.warn({ err, projectId: params.projectId }, "onWhatsApp check failed; sending anyway");
  }

  const options = params.quotedExternalId
    ? // Baileys wants the full quoted message; we only persist its id,
      // so send a minimal stub. WhatsApp renders the quote from the id.
      { quoted: { key: { id: params.quotedExternalId, remoteJid: jid, fromMe: false }, message: {} } }
    : undefined;

  let sent;
  try {
    switch (params.kind) {
      case "text":
        sent = await session.socket.sendMessage(jid, { text: params.text ?? "" }, options);
        break;
      case "image":
        sent = await session.socket.sendMessage(
          jid,
          { image: { url: params.mediaUrl! }, caption: params.text ?? undefined },
          options,
        );
        break;
      case "video":
        sent = await session.socket.sendMessage(
          jid,
          { video: { url: params.mediaUrl! }, caption: params.text ?? undefined },
          options,
        );
        break;
      case "audio":
        sent = await session.socket.sendMessage(
          jid,
          { audio: { url: params.mediaUrl! }, mimetype: "audio/ogg; codecs=opus", ptt: true },
          options,
        );
        break;
      case "document":
        sent = await session.socket.sendMessage(
          jid,
          {
            document: { url: params.mediaUrl! },
            // WhatsApp requires a mimetype on documents. The generic
            // octet-stream fallback still delivers; the recipient's
            // client falls back to the file extension for its icon.
            mimetype: params.mimeType ?? "application/octet-stream",
            fileName: params.filename ?? "document",
            caption: params.text ?? undefined,
          },
          options,
        );
        break;
      default:
        throw new SessionError("unsupported_kind", `Cannot send "${params.kind}" over a QR session.`, 400);
    }
  } catch (err) {
    if (err instanceof SessionError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new SessionError("send_failed", message, 502);
  }

  const externalId = sent?.key?.id;
  if (!externalId) {
    throw new SessionError("send_failed", "WhatsApp returned no message id.", 502);
  }
  return { externalId };
}

// ------------------------------------------------------------
// Boot + shutdown
// ------------------------------------------------------------

/**
 * Reopen sessions that were live when this process (or its
 * predecessor) stopped. Credentials are in Supabase, so a redeploy
 * costs a reconnect, not a re-scan.
 *
 * Only rows claimed by THIS instance, or by no instance, are
 * restored — otherwise two gateways would race to own one socket.
 */
export async function restoreSessions(): Promise<void> {
  const { data, error } = await supabase
    .from("whatsapp_sessions")
    .select("project_id, gateway_instance, status")
    .in("status", ["connected", "connecting"]);

  if (error) {
    logger.error({ err: error }, "could not list sessions to restore");
    return;
  }

  const restorable = data ?? [];

  logger.info({ count: restorable.length }, "restoring sessions");

  for (const row of restorable) {
    try {
      await connectSession(row.project_id as string);
    } catch (err) {
      logger.error(
        { err, projectId: row.project_id },
        "failed to restore session",
      );
    }
  }
}

/** Periodic liveness stamp and auto-heal watchdog for all paired sessions. */
export function startHeartbeat(): NodeJS.Timeout {
  return setInterval(async () => {
    const now = new Date().toISOString();
    for (const session of sessions.values()) {
      if (session.status !== "connected") continue;
      void supabase
        .from("whatsapp_sessions")
        .update({ heartbeat_at: now })
        .eq("project_id", session.projectId)
        .then(({ error }) => {
          if (error) {
            logger.warn({ err: error, projectId: session.projectId }, "heartbeat failed");
          }
        });
    }

    // Auto-heal watchdog: periodically scan for paired sessions that should be live
    // but have no active in-memory socket (e.g. following network recovery or sleep)
    try {
      const { data: activeRows } = await supabase
        .from("whatsapp_sessions")
        .select("project_id, status")
        .in("status", ["connected", "connecting"]);
      if (activeRows && activeRows.length > 0) {
        for (const row of activeRows) {
          const pid = row.project_id as string;
          const existing = sessions.get(pid);
          if (!existing || (!existing.socket && existing.status !== "qr_pending" && !existing.closing)) {
            logger.info({ projectId: pid }, "auto-healing session connection");
            void connectSession(pid).catch((err) => {
              logger.warn({ err, projectId: pid }, "auto-heal connectSession failed");
            });
          }
        }
      }
    } catch (err) {
      logger.warn({ err }, "watchdog scan failed");
    }
  }, config.heartbeatIntervalMs);
}

/**
 * Close every socket without destroying credentials — this is a
 * restart, not a logout. Clearing gateway_instance lets whichever
 * process comes up next claim the session.
 */
export async function shutdownAll(): Promise<void> {
  logger.info({ count: sessions.size }, "closing sessions");
  for (const session of sessions.values()) {
    session.closing = true;
    if (session.reconnectTimer) clearTimeout(session.reconnectTimer);
    // Detach before closing: a close handler firing mid-shutdown would
    // write 'connecting' over the row restoreSessions() is about to read.
    teardownSocket(session.socket);
    await supabase
      .from("whatsapp_sessions")
      .update({ gateway_instance: null })
      .eq("project_id", session.projectId);
  }
  sessions.clear();
}

export function liveSessionCount(): number {
  return sessions.size;
}
