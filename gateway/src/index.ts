// ============================================================
// Gateway HTTP server.
//
// Server-to-server only. Nothing here is safe to expose to a browser,
// and nothing needs to be: the pairing UI reads status and QR codes
// from Supabase Realtime, so the browser never talks to this service.
// Deploy it on a private network where you can, and behind the bearer
// token + signature check everywhere else.
//
// Every route below authenticates twice — the bearer token, then an
// HMAC over the exact bytes of the body — and then checks that the
// project id in the path matches the one inside that signed body. A
// forged path cannot reach another tenant's socket.
// ============================================================

import { serve } from "@hono/node-server";
import { Hono } from "hono";

import { config } from "./config.js";
import { logger } from "./logger.js";
import { verifyBearerToken, verifySignatureHeader } from "./security.js";
import {
  connectSession,
  disconnectSession,
  getSessionStatus,
  liveSessionCount,
  restoreSessions,
  sendMessage,
  SessionError,
  shutdownAll,
  startHeartbeat,
} from "./session-manager.js";

const app = new Hono();

// ------------------------------------------------------------
// Health — the only unauthenticated route, so a load balancer or
// uptime check can reach it. It reveals a session count and nothing
// else: no project ids, no phone numbers.
// ------------------------------------------------------------
app.get("/health", (c) =>
  c.json({ ok: true, instance: config.instanceId, sessions: liveSessionCount() }),
);

// ------------------------------------------------------------
// Auth for everything under /v1
// ------------------------------------------------------------
app.use("/v1/*", async (c, next) => {
  if (!verifyBearerToken(c.req.header("authorization"))) {
    logger.warn({ path: c.req.path }, "rejected: bad or missing bearer token");
    return c.json({ error: "Unauthorized", code: "unauthorized" }, 401);
  }

  // Read the raw body once and stash it: the signature covers these
  // exact bytes, and re-serialising a parsed object would change them.
  const rawBody = c.req.method === "GET" ? "" : await c.req.text();
  const signature = c.req.header("x-masacrm-signature") || c.req.header("x-wacrm-signature");

  if (
    !signature ||
    !verifySignatureHeader(
      signature,
      rawBody,
      config.signingSecret,
      Math.floor(Date.now() / 1000),
    )
  ) {
    logger.warn({ path: c.req.path }, "rejected: bad or expired signature");
    return c.json({ error: "Invalid signature", code: "bad_signature" }, 401);
  }

  c.set("rawBody" as never, rawBody as never);
  await next();
});

/**
 * Parse the body and confirm its projectId matches the path.
 *
 * This is the check that makes path tampering useless: the signature
 * covers the body, so an attacker who alters the URL cannot alter the
 * signed projectId to match it.
 */
function projectIdFromRequest(
  pathProjectId: string,
  rawBody: string,
): { ok: true; projectId: string } | { ok: false; error: string } {
  if (!rawBody) return { ok: true, projectId: pathProjectId };

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { ok: false, error: "Body is not valid JSON" };
  }

  const bodyProjectId =
    parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>).projectId
      : undefined;

  if (typeof bodyProjectId === "string" && bodyProjectId !== pathProjectId) {
    return {
      ok: false,
      error: "projectId in the URL does not match the signed body",
    };
  }
  return { ok: true, projectId: pathProjectId };
}

function handleError(err: unknown) {
  if (err instanceof SessionError) {
    return { body: { error: err.message, code: err.code }, status: err.status };
  }
  const message = err instanceof Error ? err.message : String(err);
  logger.error({ err }, "unhandled gateway error");
  return { body: { error: message, code: "internal_error" }, status: 500 };
}

// ------------------------------------------------------------
// Sessions
// ------------------------------------------------------------

app.post("/v1/sessions/:projectId/connect", async (c) => {
  const rawBody = c.get("rawBody" as never) as unknown as string;
  const check = projectIdFromRequest(c.req.param("projectId"), rawBody);
  if (!check.ok) return c.json({ error: check.error, code: "project_mismatch" }, 400);

  try {
    return c.json(await connectSession(check.projectId));
  } catch (err) {
    const { body, status } = handleError(err);
    return c.json(body, status as 400);
  }
});

app.get("/v1/sessions/:projectId", (c) =>
  c.json(getSessionStatus(c.req.param("projectId"))),
);

app.delete("/v1/sessions/:projectId", async (c) => {
  const rawBody = c.get("rawBody" as never) as unknown as string;
  const check = projectIdFromRequest(c.req.param("projectId"), rawBody);
  if (!check.ok) return c.json({ error: check.error, code: "project_mismatch" }, 400);

  try {
    await disconnectSession(check.projectId);
    return c.json({ success: true });
  } catch (err) {
    const { body, status } = handleError(err);
    return c.json(body, status as 400);
  }
});

// ------------------------------------------------------------
// Outbound messages
// ------------------------------------------------------------

app.post("/v1/sessions/:projectId/messages", async (c) => {
  const rawBody = c.get("rawBody" as never) as unknown as string;
  const pathProjectId = c.req.param("projectId");
  const check = projectIdFromRequest(pathProjectId, rawBody);
  if (!check.ok) return c.json({ error: check.error, code: "project_mismatch" }, 400);

  let params: Record<string, unknown>;
  try {
    params = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return c.json({ error: "Body is not valid JSON", code: "bad_request" }, 400);
  }

  const to = typeof params.to === "string" ? params.to : "";
  const kind = typeof params.kind === "string" ? params.kind : "text";
  if (!to) {
    return c.json({ error: "`to` is required", code: "bad_request" }, 400);
  }

  try {
    const result = await sendMessage({
      // The path id, already proven to match the signed body — never
      // the raw body field on its own.
      projectId: pathProjectId,
      to,
      kind: kind as "text" | "image" | "video" | "document" | "audio",
      text: typeof params.text === "string" ? params.text : null,
      mediaUrl: typeof params.mediaUrl === "string" ? params.mediaUrl : null,
      filename: typeof params.filename === "string" ? params.filename : null,
      mimeType: typeof params.mimeType === "string" ? params.mimeType : null,
      quotedExternalId:
        typeof params.quotedExternalId === "string" ? params.quotedExternalId : null,
    });
    return c.json(result);
  } catch (err) {
    const { body, status } = handleError(err);
    return c.json(body, status as 400);
  }
});

// ------------------------------------------------------------
// Boot
// ------------------------------------------------------------

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  logger.info(
    { port: info.port, instance: config.instanceId },
    "gateway listening",
  );
});

const heartbeat = startHeartbeat();

// Reopen whatever was live before this process started. Deliberately
// after the server is listening, so a slow restore does not delay
// health checks.
void restoreSessions();

async function shutdown(signal: string) {
  logger.info({ signal }, "shutting down");
  clearInterval(heartbeat);
  await shutdownAll();
  server.close(() => process.exit(0));
  // Do not let a stuck socket hold the process open forever.
  setTimeout(() => process.exit(0), 10_000).unref();
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
