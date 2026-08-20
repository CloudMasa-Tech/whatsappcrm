import { describe, expect, it } from "vitest";

import {
  STALE_AFTER_MS,
  deriveSessionStatus,
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
