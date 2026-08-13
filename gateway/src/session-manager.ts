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
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  jidNormalizedUser,
  type WAMessage,
  type WASocket,
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

async function handleInbound(session: Session, message: WAMessage): Promise<void> {
  // fromMe: our own outbound echoed back. Already persisted at send.
  if (message.key.fromMe) return;
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
// Connect
// ------------------------------------------------------------

async function openSocket(session: Session): Promise<void> {
  const { state, saveCreds } = await useSupabaseAuthState(session.projectId);
  const { version } = await fetchLatestBaileysVersion();

  const socket = makeWASocket({
    version,
    auth: state,
    logger: baileysLogger,
    // We are a CRM, not a phone: never mark things read on the
    // customer's behalf, and do not broadcast presence.
    markOnlineOnConnect: false,
    syncFullHistory: false,
    browser: ["wacrm", "Chrome", "1.0.0"],
  });

  session.socket = socket;

  socket.ev.on("creds.update", () => {
    void saveCreds();
  });

  socket.ev.on("connection.update", async (update) => {
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
      logger.info({ projectId: session.projectId }, "session connected");
    }

    if (connection === "close") {
      const statusCode = (lastDisconnect?.error as Boom | undefined)?.output
        ?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      const banned = statusCode === 403;

      if (session.closing) return;

      if (loggedOut || banned) {
        // Terminal. The credentials are dead — destroy them so the
        // next connect() starts a clean pairing instead of retrying
        // with keys WhatsApp has already rejected.
        session.status = banned ? "banned" : "logged_out";
        sessions.delete(session.projectId);
        await clearAuthState(session.projectId).catch((err) =>
          logger.error({ err, projectId: session.projectId }, "clearAuthState failed"),
        );
        await upsertSessionRow(session.projectId, session.accountId, {
          status: session.status,
          qr_code: null,
          qr_expires_at: null,
          last_disconnected_at: new Date().toISOString(),
          last_error: banned
            ? "WhatsApp rejected this number. It may be banned."
            : "The linked device was logged out. Scan the QR code again to reconnect.",
        });
        logger.warn(
          { projectId: session.projectId, statusCode },
          "session terminated by WhatsApp",
        );
        return;
      }

      // Transient. Credentials are still valid; back off and retry.
      session.reconnectAttempts += 1;
      if (session.reconnectAttempts > config.reconnect.maxAttempts) {
        session.status = "error";
        sessions.delete(session.projectId);
        await upsertSessionRow(session.projectId, session.accountId, {
          status: "error",
          last_disconnected_at: new Date().toISOString(),
          last_error: `Could not reconnect after ${config.reconnect.maxAttempts} attempts.`,
        });
        logger.error({ projectId: session.projectId }, "reconnect attempts exhausted");
        return;
      }

      const delay = Math.min(
        config.reconnect.baseMs * 2 ** (session.reconnectAttempts - 1),
        config.reconnect.maxMs,
      );
      session.status = "connecting";
      await upsertSessionRow(session.projectId, session.accountId, {
        status: "connecting",
        last_disconnected_at: new Date().toISOString(),
      });
      logger.warn(
        { projectId: session.projectId, statusCode, delay, attempt: session.reconnectAttempts },
        "session dropped; reconnecting",
      );

      session.reconnectTimer = setTimeout(() => {
        session.reconnectTimer = null;
        void openSocket(session).catch((err) =>
          logger.error({ err, projectId: session.projectId }, "reconnect failed"),
        );
      }, delay);
    }
  });

  socket.ev.on("messages.upsert", async ({ messages, type }) => {
    // 'notify' is a live message; 'append' is history sync, which we
    // do not want replayed into the inbox as new conversations.
    if (type !== "notify") return;
    for (const message of messages) {
      try {
        await handleInbound(session, message);
      } catch (err) {
        logger.error({ err, projectId: session.projectId }, "inbound handling failed");
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
  if (project.channel_type !== "qr") {
    throw new SessionError(
      "wrong_channel",
      "This project uses the Cloud API channel. QR pairing applies only to projects created with the QR channel.",
      409,
    );
  }

  const session: Session = {
    projectId,
    accountId: project.account_id,
    socket: null,
    status: "connecting",
    phoneNumber: null,
    reconnectAttempts: 0,
    reconnectTimer: null,
    closing: false,
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
    try {
      session.socket?.end(undefined);
    } catch {
      // Already closed.
    }
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

/** E.164 (+441234…) → WhatsApp JID (441234…@s.whatsapp.net). */
function toJid(phone: string): string {
  return `${phone.replace(/[^0-9]/g, "")}@s.whatsapp.net`;
}

export async function sendMessage(
  params: SendParams,
): Promise<{ externalId: string }> {
  const session = sessions.get(params.projectId);
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
    if (!result?.exists) {
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

  const restorable = (data ?? []).filter(
    (row) =>
      !row.gateway_instance || row.gateway_instance === config.instanceId,
  );

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

/** Periodic liveness stamp for every connected session. */
export function startHeartbeat(): NodeJS.Timeout {
  return setInterval(() => {
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
    try {
      session.socket?.end(undefined);
    } catch {
      // Already closed.
    }
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
