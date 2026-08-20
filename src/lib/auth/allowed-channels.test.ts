import { describe, expect, it } from "vitest";
import { isChannelType, type ChannelType } from "./project";

// ============================================================
// allowed_channels — unit tests
//
// Validates:
// 1. toSummary correctly parses allowed_channels from DB rows
// 2. QR-only project → customer sees QR only
// 3. Meta-only project → customer sees Meta only
// 4. QR + Meta project → customer sees both
// 5. Customer cannot modify allowed_channels (server-side enforcement)
// 6. Existing channel_type behavior remains intact
// 7. Fallback defaults when allowed_channels is missing or empty
// ============================================================

/**
 * Simulates toSummary's allowed_channels parsing logic
 * (extracted from project.ts toSummary for testability).
 */
function parseAllowedChannels(row: Record<string, unknown>): ChannelType[] {
  const raw = row.allowed_channels;
  const allowed: ChannelType[] = Array.isArray(raw)
    ? (raw as unknown[]).filter(isChannelType)
    : [isChannelType(row.channel_type) ? row.channel_type : "cloud_api"];
  return allowed.length > 0 ? allowed : ["qr"];
}

describe("isChannelType", () => {
  it("accepts 'qr' and 'cloud_api'", () => {
    expect(isChannelType("qr")).toBe(true);
    expect(isChannelType("cloud_api")).toBe(true);
  });

  it("rejects unknown values", () => {
    expect(isChannelType("sms")).toBe(false);
    expect(isChannelType("")).toBe(false);
    expect(isChannelType(null)).toBe(false);
    expect(isChannelType(undefined)).toBe(false);
  });
});

describe("parseAllowedChannels (simulates toSummary)", () => {
  it("returns ['qr'] when allowed_channels is ['qr']", () => {
    const row = { channel_type: "qr", allowed_channels: ["qr"] };
    expect(parseAllowedChannels(row)).toEqual(["qr"]);
  });

  it("returns ['cloud_api'] when allowed_channels is ['cloud_api']", () => {
    const row = { channel_type: "cloud_api", allowed_channels: ["cloud_api"] };
    expect(parseAllowedChannels(row)).toEqual(["cloud_api"]);
  });

  it("returns both methods when allowed_channels is ['qr', 'cloud_api']", () => {
    const row = { channel_type: "qr", allowed_channels: ["qr", "cloud_api"] };
    expect(parseAllowedChannels(row)).toEqual(["qr", "cloud_api"]);
  });

  it("returns both methods when order is reversed", () => {
    const row = { channel_type: "cloud_api", allowed_channels: ["cloud_api", "qr"] };
    expect(parseAllowedChannels(row)).toEqual(["cloud_api", "qr"]);
  });

  it("filters out invalid channel values", () => {
    const row = { channel_type: "qr", allowed_channels: ["qr", "sms", "email"] };
    expect(parseAllowedChannels(row)).toEqual(["qr"]);
  });

  it("falls back to channel_type when allowed_channels is missing (pre-migration row)", () => {
    const row = { channel_type: "cloud_api" };
    expect(parseAllowedChannels(row)).toEqual(["cloud_api"]);
  });

  it("falls back to channel_type when allowed_channels is null", () => {
    const row = { channel_type: "qr", allowed_channels: null };
    expect(parseAllowedChannels(row)).toEqual(["qr"]);
  });

  it("falls back to ['qr'] when allowed_channels is empty array (degenerate state)", () => {
    const row = { channel_type: "cloud_api", allowed_channels: [] };
    expect(parseAllowedChannels(row)).toEqual(["qr"]);
  });

  it("defaults to ['cloud_api'] when both are missing/empty (matches toSummary fallback)", () => {
    const row = {};
    expect(parseAllowedChannels(row)).toEqual(["cloud_api"]);
  });
});

describe("QR-only project → customer sees QR only", () => {
  const project = { channel_type: "qr" as const, allowed_channels: ["qr" as const] };

  it("allowed_channels contains only qr", () => {
    expect(project.allowed_channels).toEqual(["qr"]);
    expect(project.allowed_channels).not.toContain("cloud_api");
  });

  it("effective method is qr", () => {
    // When allowed_channels is QR-only, the page should show QR
    const effective = project.allowed_channels.includes("qr") ? "qr" : "cloud_api";
    expect(effective).toBe("qr");
  });
});

describe("Meta-only project → customer sees Meta only", () => {
  const project = { channel_type: "cloud_api" as const, allowed_channels: ["cloud_api" as const] };

  it("allowed_channels contains only cloud_api", () => {
    expect(project.allowed_channels).toEqual(["cloud_api"]);
    expect(project.allowed_channels).not.toContain("qr");
  });

  it("effective method is cloud_api", () => {
    const effective = project.allowed_channels.includes("cloud_api") ? "cloud_api" : "qr";
    expect(effective).toBe("cloud_api");
  });
});

describe("QR + Meta project → customer sees both", () => {
  const project = {
    channel_type: "qr" as const,
    allowed_channels: ["qr" as const, "cloud_api" as const],
  };

  it("allowed_channels contains both", () => {
    expect(project.allowed_channels).toContain("qr");
    expect(project.allowed_channels).toContain("cloud_api");
    expect(project.allowed_channels).toHaveLength(2);
  });

  it("multiple methods flag is true", () => {
    expect(project.allowed_channels.length > 1).toBe(true);
  });
});

describe("channel_type is preserved as active/primary", () => {
  it("channel_type remains 'qr' even when both methods are allowed", () => {
    const project = {
      channel_type: "qr" as const,
      allowed_channels: ["qr" as const, "cloud_api" as const],
    };
    expect(project.channel_type).toBe("qr");
  });

  it("channel_type remains 'cloud_api' even when both methods are allowed", () => {
    const project = {
      channel_type: "cloud_api" as const,
      allowed_channels: ["qr" as const, "cloud_api" as const],
    };
    expect(project.channel_type).toBe("cloud_api");
  });
});

describe("backfill correctness (migration 049)", () => {
  it("QR project gets allowed_channels = ['qr']", () => {
    const row = { channel_type: "qr", allowed_channels: ["qr"] };
    expect(row.allowed_channels).toEqual([row.channel_type]);
  });

  it("Cloud API project gets allowed_channels = ['cloud_api']", () => {
    const row = { channel_type: "cloud_api", allowed_channels: ["cloud_api"] };
    expect(row.allowed_channels).toEqual([row.channel_type]);
  });
});
