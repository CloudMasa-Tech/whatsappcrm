// ============================================================
// Push events to the CRM.
//
// Inbound messages do NOT get written to `messages` from here. They go
// to the CRM's /api/channels/qr/events endpoint, which runs the same
// ingest pipeline the Meta webhook uses — contact dedup, conversation
// upsert, automations, flows, AI auto-reply, outbound webhooks. Doing
// it here instead would mean a second, silently diverging copy of that
// pipeline.
//
// Status changes are the exception: those are written straight to
// `whatsapp_sessions` (see session-manager), because the pairing UI
// reads that table over Realtime and a round trip through the CRM
// would add latency to a QR code that expires in seconds.
// ============================================================

import { config } from "./config.js";
import { logger } from "./logger.js";
import { buildSignatureHeader } from "./security.js";

export interface InboundEventPayload {
  projectId: string;
  from: string;
  externalId: string;
  kind: string;
  text?: string | null;
  senderName?: string | null;
  timestamp: string;
  fromMe?: boolean;
  isHistory?: boolean;
  media?: {
    url: string;
    mimeType: string;
    filename?: string | null;
    caption?: string | null;
  } | null;
  replyToExternalId?: string | null;
}

export interface ReceiptEventPayload {
  projectId: string;
  externalId: string;
  status: "sent" | "delivered" | "read" | "failed";
}

export interface ReactionEventPayload {
  projectId: string;
  externalId: string;
  emoji: string;
}

export interface ContactsEventPayload {
  projectId: string;
  contacts: Array<{
    phone: string;
    name?: string | null;
  }>;
}

type GatewayEvent =
  | { type: "message"; payload: InboundEventPayload }
  | { type: "receipt"; payload: ReceiptEventPayload }
  | { type: "reaction"; payload: ReactionEventPayload }
  | { type: "contacts"; payload: ContactsEventPayload };

/**
 * Deliver one event. Retries a few times with backoff — a CRM redeploy
 * should not lose an inbound message. Failures are logged and dropped
 * after the last attempt; the alternative (an unbounded in-memory
 * queue) would lose them on restart anyway and hide the problem.
 */
export async function sendEventToCrm(event: GatewayEvent): Promise<boolean> {
  const rawBody = JSON.stringify(event);
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const timestamp = Math.floor(Date.now() / 1000);
    try {
      const response = await fetch(`${config.crm.url}/api/channels/qr/events`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-masacrm-signature": buildSignatureHeader(
            rawBody,
            config.crm.webhookSecret,
            timestamp,
          ),
          "x-wacrm-signature": buildSignatureHeader(
            rawBody,
            config.crm.webhookSecret,
            timestamp,
          ),
        },
        body: rawBody,
        signal: AbortSignal.timeout(20_000),
      });

      if (response.ok) return true;

      // 4xx means the CRM rejected the payload itself — a retry sends
      // the identical bytes and gets the identical answer.
      if (response.status >= 400 && response.status < 500) {
        logger.error(
          {
            status: response.status,
            projectId: event.payload.projectId,
            type: event.type,
          },
          "CRM rejected event; not retrying",
        );
        return false;
      }

      logger.warn(
        { status: response.status, attempt, projectId: event.payload.projectId },
        "CRM event delivery failed; retrying",
      );
    } catch (err) {
      logger.warn(
        { err, attempt, projectId: event.payload.projectId },
        "CRM event delivery threw; retrying",
      );
    }

    if (attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)));
    }
  }

  logger.error(
    { projectId: event.payload.projectId, type: event.type },
    "CRM event delivery gave up",
  );
  return false;
}
