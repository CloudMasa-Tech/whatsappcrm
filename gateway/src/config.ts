// ============================================================
// Environment. Read once at boot and fail fast — a gateway that
// starts with a missing secret would look healthy right up until it
// silently accepted an unsigned request.
// ============================================================

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `[gateway] Missing required environment variable ${name}. ` +
        "See gateway/.env.example.",
    );
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 8088),

  // Identifies this process in `whatsapp_sessions.gateway_instance`.
  // Matters once more than one gateway runs: two instances must never
  // open a socket for the same project, or WhatsApp sees conflicting
  // devices and drops both.
  instanceId: process.env.GATEWAY_INSTANCE_ID ?? `gateway-${process.pid}`,

  supabase: {
    url: required("SUPABASE_URL"),
    // Service role: this process bypasses RLS entirely. Nothing here
    // may ever take a project id from an unauthenticated caller.
    serviceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  },

  // Must be byte-identical to the Next app's ENCRYPTION_KEY: both
  // sides read and write the same `whatsapp_session_keys.payload`
  // ciphertexts, and a mismatch means every stored session is
  // unreadable (and unrecoverable without a re-scan).
  encryptionKey: required("ENCRYPTION_KEY"),

  // Inbound auth: the CRM proves itself with this bearer token plus an
  // HMAC over the body.
  apiToken: required("GATEWAY_API_TOKEN"),
  signingSecret: required("GATEWAY_SIGNING_SECRET"),

  // Outbound: where we push inbound messages and status changes, and
  // the secret we sign them with (verified by the CRM).
  crm: {
    url: required("CRM_URL").replace(/\/+$/, ""),
    webhookSecret: required("GATEWAY_WEBHOOK_SECRET"),
  },

  // Bucket for media we download off WhatsApp before telling the CRM
  // about it. Paths are account-<id>/project-<id>/… so the storage
  // policies in migration 044 apply.
  mediaBucket: process.env.GATEWAY_MEDIA_BUCKET ?? "chat-media",
  // 16 MB, matching the bucket's own limit. A few large videos in
  // flight will otherwise exhaust a small VPS: Baileys hands us media
  // as an in-memory buffer.
  maxMediaBytes: Number(process.env.GATEWAY_MAX_MEDIA_BYTES ?? 16 * 1024 * 1024),

  // Replay window for signed requests, both directions.
  signatureToleranceSeconds: 300,

  // How often a live session writes `heartbeat_at`. A "connected"
  // session whose heartbeat goes stale is actually down — that is what
  // the CRM alerts on, rather than trusting `status`.
  heartbeatIntervalMs: Number(process.env.GATEWAY_HEARTBEAT_MS ?? 60_000),

  // Reconnect backoff bounds. WhatsApp tolerates reconnects poorly if
  // they are aggressive, so start at a second and cap at a minute.
  reconnect: {
    baseMs: 1_000,
    maxMs: 60_000,
    maxAttempts: Number(process.env.GATEWAY_MAX_RECONNECT_ATTEMPTS ?? 20),
  },
} as const;

export type Config = typeof config;
