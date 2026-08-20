import { describe, expect, it } from "vitest";

import {
  STALE_AFTER_MS,
  deriveSessionStatus,
  isPairingStatus,
  isRotatingQr,
  isSessionStale,
  type StoredSessionStatus,
} from "./session-status";

// Fixed reference clock so every case is deterministic.
const NOW = new Date("2026-06-22T12:00:00.000Z").getTime();
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("deriveSessionStatus", () => {
  it("keeps 'connected' while the heartbeat is fresh", () => {
    expect(deriveSessionStatus("connected", ago(1_000), NOW)).toBe("connected");
    expect(deriveSessionStatus("connected", ago(STALE_AFTER_MS - 1), NOW)).toBe(
      "connected",
    );
  });

  it("reads a 'connected' row as stale once the heartbeat lapses", () => {
    // The gateway died without writing a status — a kill -9, an OOM, or
    // a shutdownAll() that deliberately left status='connected'.
    expect(deriveSessionStatus("connected", ago(STALE_AFTER_MS + 1), NOW)).toBe(
      "stale",
    );
    expect(deriveSessionStatus("connected", ago(6 * 60 * 60_000), NOW)).toBe(
      "stale",
    );
  });

  it("treats a 'connected' row with no heartbeat as stale", () => {
    expect(deriveSessionStatus("connected", null, NOW)).toBe("stale");
    expect(deriveSessionStatus("connected", undefined, NOW)).toBe("stale");
    expect(deriveSessionStatus("connected", "not-a-date", NOW)).toBe("stale");
  });

  it("does not flap on a future heartbeat (clock skew)", () => {
    const future = new Date(NOW + 30_000).toISOString();
    expect(deriveSessionStatus("connected", future, NOW)).toBe("connected");
  });

  it("passes every other stored status through untouched", () => {
    // None of these claim a live socket, so heartbeat age is irrelevant —
    // a stale one must not mask 'logged_out' or 'banned' behind 'stale'.
    const others: StoredSessionStatus[] = [
      "disconnected",
      "qr_pending",
      "connecting",
      "logged_out",
      "banned",
      "error",
    ];
    for (const status of others) {
      expect(deriveSessionStatus(status, ago(10 * 60_000), NOW)).toBe(status);
      expect(deriveSessionStatus(status, null, NOW)).toBe(status);
    }
  });

  it("falls back to 'disconnected' with no row", () => {
    expect(deriveSessionStatus(null, null, NOW)).toBe("disconnected");
    expect(deriveSessionStatus(undefined, ago(1_000), NOW)).toBe("disconnected");
  });
});

describe("isSessionStale", () => {
  it("is true only for an expired 'connected' claim", () => {
    expect(isSessionStale("connected", ago(STALE_AFTER_MS + 1), NOW)).toBe(true);
    expect(isSessionStale("connected", ago(1_000), NOW)).toBe(false);
    expect(isSessionStale("logged_out", ago(STALE_AFTER_MS + 1), NOW)).toBe(
      false,
    );
  });
});

describe("isPairingStatus", () => {
  it("is true only for the two states that need a live feed", () => {
    expect(isPairingStatus("connecting")).toBe(true);
    expect(isPairingStatus("qr_pending")).toBe(true);
  });

  it("is false for every settled state", () => {
    // These are terminal until a human acts, so polling them buys
    // nothing — and 'connected' polling forever is what the bounded
    // pairing window exists to prevent.
    const settled: StoredSessionStatus[] = [
      "connected",
      "disconnected",
      "logged_out",
      "banned",
      "error",
    ];
    for (const status of settled) {
      expect(isPairingStatus(status)).toBe(false);
    }
    expect(isPairingStatus("stale")).toBe(false);
    expect(isPairingStatus(null)).toBe(false);
    expect(isPairingStatus(undefined)).toBe(false);
  });
});

describe("isRotatingQr", () => {
  const ahead = (ms: number) => new Date(NOW + ms).toISOString();

  it("is true while the gateway is still refreshing the code", () => {
    // The gateway stamps qr_expires_at ~20s ahead on every QR it issues.
    expect(isRotatingQr("qr_pending", ahead(20_000), NOW)).toBe(true);
    expect(isRotatingQr("qr_pending", ahead(1), NOW)).toBe(true);
  });

  it("is false once the stamp has lapsed", () => {
    // A 'qr_pending' row left behind by a gateway that has since died.
    // Extending the poll window on this would poll a corpse forever.
    expect(isRotatingQr("qr_pending", ago(1), NOW)).toBe(false);
    expect(isRotatingQr("qr_pending", ago(10 * 60_000), NOW)).toBe(false);
    expect(isRotatingQr("qr_pending", ahead(0), NOW)).toBe(false);
  });

  it("is false without a usable stamp", () => {
    expect(isRotatingQr("qr_pending", null, NOW)).toBe(false);
    expect(isRotatingQr("qr_pending", undefined, NOW)).toBe(false);
    expect(isRotatingQr("qr_pending", "not-a-date", NOW)).toBe(false);
  });

  it("is false for any status other than qr_pending", () => {
    // 'connecting' has no code yet; 'connected' has had it cleared.
    expect(isRotatingQr("connecting", ahead(20_000), NOW)).toBe(false);
    expect(isRotatingQr("connected", ahead(20_000), NOW)).toBe(false);
    expect(isRotatingQr(null, ahead(20_000), NOW)).toBe(false);
  });
});
