// ============================================================
// Gateway client — the CRM's only door to the QR session service.
//
// The gateway is a separate always-on Node process holding one
// WhatsApp Web socket per project (see gateway/README.md). It cannot
// live inside Next.js: route handlers are short-lived, and a QR
// session is a WebSocket that must stay open for weeks.
//
// Trust model
// -----------
// The gateway runs with the Supabase SERVICE ROLE — it bypasses RLS
// entirely. So the link between CRM and gateway is authenticated
// twice over:
//
//   1. a bearer token, so only our server can call it at all;
//   2. an HMAC signature over the raw body plus a timestamp, reusing
//      the Stripe-style scheme already in src/lib/webhooks/sign.ts,
//      so a leaked URL is not enough to forge a request and an old
//      request cannot be replayed.
//
// And the rule that actually holds tenancy: **the CRM never forwards
// a client-supplied project id.** Callers resolve the project from the
// session first (src/lib/auth/project.ts), and pass the authorised id.
// The gateway re-checks that the id in the path matches the id in the
// signed body, so a tampered path fails there too.
//
// This module is server-only — it reads secrets from the environment.
// ============================================================

import { buildSignatureHeader } from "@/lib/webhooks/sign";

export class GatewayError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 502) {
    super(message);
    this.name = "GatewayError";
    this.code = code;
    this.status = status;
  }
}

/** True when the deployment has a gateway configured at all. */
export function isGatewayConfigured(): boolean {
  return Boolean(
    process.env.WHATSAPP_GATEWAY_URL && process.env.WHATSAPP_GATEWAY_TOKEN,
  );
}

function gatewayConfig(): { url: string; token: string; secret: string } {
  const url = process.env.WHATSAPP_GATEWAY_URL;
  const token = process.env.WHATSAPP_GATEWAY_TOKEN;
  const secret = process.env.WHATSAPP_GATEWAY_SIGNING_SECRET;

  if (!url || !token || !secret) {
    throw new GatewayError(
      "gateway_not_configured",
      "The WhatsApp QR gateway is not configured. Set WHATSAPP_GATEWAY_URL, " +
        "WHATSAPP_GATEWAY_TOKEN and WHATSAPP_GATEWAY_SIGNING_SECRET, and make " +
        "sure the gateway service is running.",
      503,
    );
  }
  return { url: url.replace(/\/+$/, ""), token, secret };
}

interface GatewayRequestOptions {
  method?: "GET" | "POST" | "DELETE";
  /** Serialised verbatim; the same bytes are what get signed. */
  body?: unknown;
  /** Abort after this many ms. Sends are slow-ish; status is quick. */
  timeoutMs?: number;
}

/**
 * Call the gateway and return its parsed JSON.
 *
 * Throws `GatewayError` on transport failure, timeout, or a non-2xx
 * response, carrying the gateway's own `code` when it sent one so the
 * UI can distinguish "session not connected" from "gateway is down".
 */
export async function gatewayRequest<T = unknown>(
  path: string,
  options: GatewayRequestOptions = {},
): Promise<T> {
  const { url, token, secret } = gatewayConfig();
  const { method = "GET", body, timeoutMs = 30_000 } = options;

  // Sign the exact bytes we send. Re-serialising on either side would
  // let a whitespace difference break every signature.
  const rawBody = body === undefined ? "" : JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1000);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${url}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        "x-wacrm-signature": buildSignatureHeader(rawBody, secret, timestamp),
      },
      body: method === "GET" ? undefined : rawBody,
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    throw new GatewayError(
      aborted ? "gateway_timeout" : "gateway_unreachable",
      aborted
        ? `The WhatsApp gateway did not respond within ${Math.round(timeoutMs / 1000)}s.`
        : `Could not reach the WhatsApp gateway: ${err instanceof Error ? err.message : String(err)}`,
      504,
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const record =
      payload && typeof payload === "object"
        ? (payload as Record<string, unknown>)
        : {};
    throw new GatewayError(
      typeof record.code === "string" ? record.code : "gateway_error",
      typeof record.error === "string"
        ? record.error
        : `Gateway responded ${response.status}`,
      // 5xx from the gateway is our problem to surface as 502; its 4xx
      // are genuine client errors worth passing through unchanged.
      response.status >= 500 ? 502 : response.status,
    );
  }

  return payload as T;
}

// ------------------------------------------------------------
// Typed endpoints
// ------------------------------------------------------------

export interface GatewaySessionStatus {
  projectId: string;
  status:
    | "disconnected"
    | "qr_pending"
    | "connecting"
    | "connected"
    | "logged_out"
    | "banned"
    | "error";
  phoneNumber?: string | null;
  lastError?: string | null;
}

/**
 * Start (or restart) pairing for a project. The QR itself is NOT
 * returned here — the gateway writes it to `whatsapp_sessions`, and
 * the UI picks it up over Supabase Realtime. That keeps the browser
 * off the gateway entirely: no CORS, no second auth surface, and the
 * gateway can sit on a private network.
 */
export function connectSession(projectId: string) {
  return gatewayRequest<GatewaySessionStatus>(
    `/v1/sessions/${projectId}/connect`,
    { method: "POST", body: { projectId }, timeoutMs: 20_000 },
  );
}

/** Log out and destroy stored credentials. Requires a re-scan after. */
export function disconnectSession(projectId: string) {
  return gatewayRequest<{ success: true }>(`/v1/sessions/${projectId}`, {
    method: "DELETE",
    body: { projectId },
    timeoutMs: 20_000,
  });
}

export function getSessionStatus(projectId: string) {
  return gatewayRequest<GatewaySessionStatus>(`/v1/sessions/${projectId}`, {
    timeoutMs: 10_000,
  });
}

export interface GatewaySendParams {
  projectId: string;
  to: string;
  kind: "text" | "image" | "video" | "document" | "audio";
  text?: string | null;
  mediaUrl?: string | null;
  filename?: string | null;
  /**
   * Required by WhatsApp for documents; ignored for other kinds. When
   * omitted the gateway falls back to application/octet-stream, which
   * still delivers — the recipient's client just picks its icon from
   * the file extension instead.
   */
  mimeType?: string | null;
  /** External id of the message being replied to. */
  quotedExternalId?: string | null;
}

export function sendViaGateway(params: GatewaySendParams) {
  return gatewayRequest<{ externalId: string }>(
    `/v1/sessions/${params.projectId}/messages`,
    { method: "POST", body: params, timeoutMs: 45_000 },
  );
}
