// ============================================================
// QR session status — pure, unit-testable, no I/O.
//
// `whatsapp_sessions.status` records what the gateway last WROTE, which
// is not the same as what is true now. Nothing marks a session down
// when the gateway stops:
//
//   - shutdownAll() deliberately leaves status='connected' and only
//     clears gateway_instance, so restoreSessions() can reclaim the row
//     on the next boot.
//   - A crash, OOM kill, or container replacement runs no code at all.
//
// Either way the row still reads 'connected' with no socket in
// existence, and the pairing UI used to believe it indefinitely.
//
// So "connected" is treated as a claim that expires. The gateway stamps
// `heartbeat_at` every GATEWAY_HEARTBEAT_MS for each live session
// (startHeartbeat() in gateway/src/session-manager.ts); a stamp older
// than STALE_AFTER_MS means the socket is gone whatever `status` says.
// This mirrors how src/lib/presence.ts derives "offline" from staleness
// rather than storing it — same reasoning, different table.
//
// `now` is injected (epoch ms) rather than read from the clock so
// derivation stays deterministic and testable. See
// session-status.test.ts.
// ============================================================

/** What the gateway stores in `whatsapp_sessions.status`. */
export type StoredSessionStatus =
  | "disconnected"
  | "qr_pending"
  | "connecting"
  | "connected"
  | "logged_out"
  | "banned"
  | "error";

/**
 * What a viewer sees. Adds `stale`: the row claims 'connected' but the
 * gateway stopped stamping its heartbeat, so no socket is really up.
 */
export type DisplaySessionStatus = StoredSessionStatus | "stale";

/**
 * Must match the gateway's `GATEWAY_HEARTBEAT_MS` (config.ts default
 * 60_000). Raising it there without raising it here would flap a live
 * session to `stale`; the multiplier below is the safety margin.
 */
export const GATEWAY_HEARTBEAT_MS = 60_000;

/**
 * A 'connected' row whose heartbeat is older than this reads as `stale`.
 * Three missed beats — enough that one slow write, a brief network
 * partition, or a Supabase hiccup doesn't flap a healthy session.
 */
export const STALE_AFTER_MS = 10 * GATEWAY_HEARTBEAT_MS;

/**
 * Derive the status to display from the stored row.
 *
 * Only 'connected' is subject to expiry. The other states are terminal
 * or transitional and carry no liveness claim: 'connecting' and
 * 'qr_pending' are inherently short-lived (the UI shows a spinner or a
 * QR), and 'logged_out' / 'banned' / 'error' / 'disconnected' already
 * say the session is down.
 *
 * A 'connected' row with NO heartbeat at all is also stale: the gateway
 * stamps `heartbeat_at` in the same write that sets 'connected', so a
 * missing value means the row predates this mechanism or was written by
 * something else.
 */
export function deriveSessionStatus(
  stored: StoredSessionStatus | null | undefined,
  heartbeatAt: string | null | undefined,
  now: number,
): DisplaySessionStatus {
  if (!stored) return "disconnected";
  if (stored !== "connected") return stored;

  if (!heartbeatAt) return "stale";
  const last = new Date(heartbeatAt).getTime();
  if (Number.isNaN(last)) return "stale";
  // A heartbeat in the future (clock skew between the gateway host and
  // the viewer's browser) is not evidence of staleness — only age is.
  if (now - last > STALE_AFTER_MS) return "stale";

  return "connected";
}

/**
 * Poll interval for clients that read this table while Realtime is NOT
 * confirmed subscribed. Fast enough to catch a QR before it rotates
 * (~20s), slow enough not to hammer the server from an idle tab.
 *
 * Realtime can be absent entirely: migration 044 adds
 * whatsapp_sessions to the `supabase_realtime` publication inside a
 * block that downgrades a privilege error to a WARNING, so a SQL-editor
 * run by a non-owner leaves the migration green and Realtime off. A
 * client with no fallback then shows its page-load state forever.
 */
export const POLL_MS = 5_000;

/**
 * Poll interval while a pairing is actually IN FLIGHT.
 *
 * Faster than POLL_MS because the thing being waited on is a QR code
 * that WhatsApp rotates every ~20s, and a user is staring at an empty
 * box until it lands.
 */
export const PAIRING_POLL_MS = 2_000;

/**
 * How long a pairing window stays open — i.e. how long we keep polling
 * unconditionally after someone presses Connect.
 *
 * Bounded on purpose. The alternative ("poll while status is
 * transient") never terminates when the gateway dies mid-connect: it
 * leaves the row on 'connecting' forever, and a forgotten tab would
 * poll every 2s until it was closed. Three minutes is long enough to
 * find a phone and scan; after that the screen says what is wrong and
 * offers a manual retry, which reopens the window.
 *
 * A window that sees a LIVE, rotating QR extends itself — see
 * `isRotatingQr`.
 */
export const PAIRING_WINDOW_MS = 3 * 60_000;

/**
 * How long 'connecting' may sit with no QR before we call it stuck.
 *
 * The gateway emits a QR within a second or two of opening its socket,
 * so anything past this is a real fault — most often that the gateway
 * is unreachable or its environment is incomplete, neither of which
 * produces an error the browser can see.
 */
export const PAIRING_STUCK_AFTER_MS = 30_000;

/**
 * True while the session is mid-transition, in either direction.
 *
 * These are the two states that need a live feed: 'connecting' is
 * waiting for a QR, 'qr_pending' is waiting for a scan. Everything
 * else is terminal until a human acts.
 */
export function isPairingStatus(
  status: StoredSessionStatus | DisplaySessionStatus | null | undefined,
): boolean {
  return status === "connecting" || status === "qr_pending";
}

/**
 * True when the row holds a QR the gateway is still actively rotating.
 *
 * This is the signal that a pairing is making real progress, as opposed
 * to a `qr_pending` row left behind by a gateway that has since died.
 * The gateway stamps `qr_expires_at` ~20s ahead on every QR it issues,
 * so a lapsed stamp means nothing is refreshing it any more.
 *
 * `now` is injected for the same reason as in `deriveSessionStatus`.
 */
export function isRotatingQr(
  status: StoredSessionStatus | DisplaySessionStatus | null | undefined,
  qrExpiresAt: string | null | undefined,
  now: number,
): boolean {
  if (status !== "qr_pending" || !qrExpiresAt) return false;
  const expires = new Date(qrExpiresAt).getTime();
  if (Number.isNaN(expires)) return false;
  return expires > now;
}

/**
 * How often a client should re-derive staleness with no inbound event.
 * A lapsing heartbeat is the *absence* of a write, so nothing can push
 * it — only the local clock advancing reveals it.
 */
export const STALENESS_TICK_MS = 15_000;

/** True when the row's own `status` cannot be trusted as-is. */
export function isSessionStale(
  stored: StoredSessionStatus | null | undefined,
  heartbeatAt: string | null | undefined,
  now: number,
): boolean {
  return deriveSessionStatus(stored, heartbeatAt, now) === "stale";
}
