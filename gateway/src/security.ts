// ============================================================
// Request authentication, both directions.
//
// Scheme is the CRM's own (src/lib/webhooks/sign.ts), reused verbatim
// so there is exactly one signing format in the system:
//
//   X-Wacrm-Signature: t=<unix_seconds>,v1=<hex HMAC-SHA256>
//   signed message:    `${t}.${rawBody}`
//
// The timestamp is inside the signed message, so an attacker cannot
// replay an old body under a fresh timestamp.
// ============================================================

import { createHmac, timingSafeEqual } from "node:crypto";

import { config } from "./config.js";

export function buildSignatureHeader(
  rawBody: string,
  secret: string,
  timestampSeconds: number,
): string {
  const signature = createHmac("sha256", secret)
    .update(`${timestampSeconds}.${rawBody}`)
    .digest("hex");
  return `t=${timestampSeconds},v1=${signature}`;
}

export function verifySignatureHeader(
  header: string,
  rawBody: string,
  secret: string,
  nowSeconds: number,
  toleranceSeconds = config.signatureToleranceSeconds,
): boolean {
  const parts = Object.fromEntries(
    header.split(",").map((kv) => {
      const i = kv.indexOf("=");
      return [kv.slice(0, i).trim(), kv.slice(i + 1)];
    }),
  );

  const t = Number(parts.t);
  const v1 = typeof parts.v1 === "string" ? parts.v1.trim().toLowerCase() : "";
  if (!Number.isFinite(t) || !v1) return false;
  if (Math.abs(nowSeconds - t) > toleranceSeconds) return false;

  const expected = createHmac("sha256", secret)
    .update(`${t}.${rawBody}`)
    .digest("hex");

  const a = Buffer.from(v1, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Constant-time bearer-token comparison. */
export function verifyBearerToken(header: string | undefined): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const presented = Buffer.from(header.slice(7), "utf8");
  const expected = Buffer.from(config.apiToken, "utf8");
  if (presented.length !== expected.length) return false;
  return timingSafeEqual(presented, expected);
}
