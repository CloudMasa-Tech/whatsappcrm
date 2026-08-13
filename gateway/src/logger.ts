import pino from "pino";

/**
 * Structured logs. Every session-scoped line carries `projectId` so a
 * multi-tenant gateway's output can be filtered per customer during an
 * incident.
 *
 * Never log message bodies, phone numbers, or anything out of
 * `whatsapp_session_keys`: this process handles credentials that can
 * send as a customer's own number.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: ["payload", "creds", "*.payload", "*.creds", "req.headers.authorization"],
    censor: "[redacted]",
  },
});

/** Baileys wants a pino-compatible logger; give it a quieter child. */
export const baileysLogger = logger.child({ component: "baileys" });
baileysLogger.level = process.env.BAILEYS_LOG_LEVEL ?? "warn";
