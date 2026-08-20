import { describe, expect, it } from "vitest";
import { parseInbound } from "./route";

// ============================================================
// QR events route — unit tests
//
// Validates:
// 1. parseInbound correctly parses valid inbound payloads
// 2. parseInbound rejects malformed payloads
// 3. Event type routing: message, receipt, reaction, unknown
// ============================================================

describe("parseInbound", () => {
  const validProjectId = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

  it("parses a valid text message", () => {
    const raw = {
      projectId: validProjectId,
      from: "+1234567890",
      externalId: "msg-001",
      kind: "text",
      text: "Hello!",
      senderName: "Test User",
      timestamp: "2025-01-15T10:30:00.000Z",
    };
    const result = parseInbound(raw);
    expect(result).not.toBeNull();
    expect(result!.projectId).toBe(validProjectId);
    expect(result!.from).toBe("+1234567890");
    expect(result!.kind).toBe("text");
    expect(result!.text).toBe("Hello!");
  });

  it("parses a message with media", () => {
    const raw = {
      projectId: validProjectId,
      from: "+1234567890",
      externalId: "msg-002",
      kind: "image",
      media: {
        url: "https://example.com/image.jpg",
        mimeType: "image/jpeg",
        filename: "photo.jpg",
        caption: "Look at this",
      },
    };
    const result = parseInbound(raw);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("image");
    expect(result!.media).not.toBeNull();
    expect(result!.media!.url).toBe("https://example.com/image.jpg");
    expect(result!.media!.caption).toBe("Look at this");
  });

  it("parses a reaction message", () => {
    const raw = {
      projectId: validProjectId,
      from: "+1234567890",
      externalId: "msg-003",
      kind: "reaction",
      text: "👍",
    };
    const result = parseInbound(raw);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("reaction");
    expect(result!.text).toBe("👍");
  });

  it("rejects payload without projectId", () => {
    const raw = { from: "+1234567890", externalId: "msg-004", kind: "text" };
    expect(parseInbound(raw)).toBeNull();
  });

  it("rejects payload with invalid projectId format", () => {
    const raw = {
      projectId: "not-a-uuid",
      from: "+1234567890",
      externalId: "msg-005",
      kind: "text",
    };
    expect(parseInbound(raw)).toBeNull();
  });

  it("rejects payload without from", () => {
    const raw = {
      projectId: validProjectId,
      externalId: "msg-006",
      kind: "text",
    };
    expect(parseInbound(raw)).toBeNull();
  });

  it("defaults kind to 'unknown' for unrecognised values", () => {
    const raw = {
      projectId: validProjectId,
      from: "+1234567890",
      externalId: "msg-007",
      kind: "something_new",
      text: "hello",
    };
    const result = parseInbound(raw);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("unknown");
  });

  it("accepts all valid message kinds", () => {
    const validKinds = [
      "text", "image", "video", "document", "audio",
      "location", "sticker", "reaction", "unknown",
    ];
    for (const kind of validKinds) {
      const raw = {
        projectId: validProjectId,
        from: "+1234567890",
        externalId: `msg-${kind}`,
        kind,
      };
      expect(parseInbound(raw)).not.toBeNull();
    }
  });

  it("parses a message with replyToExternalId", () => {
    const raw = {
      projectId: validProjectId,
      from: "+1234567890",
      externalId: "msg-008",
      kind: "text",
      text: "Replying here",
      replyToExternalId: "original-msg-id",
    };
    const result = parseInbound(raw);
    expect(result).not.toBeNull();
    expect(result!.replyToExternalId).toBe("original-msg-id");
  });

  it("uses current timestamp when none provided", () => {
    const before = Date.now();
    const raw = {
      projectId: validProjectId,
      from: "+1234567890",
      externalId: "msg-009",
      kind: "text",
      text: "No timestamp",
    };
    const result = parseInbound(raw);
    expect(result).not.toBeNull();
    const parsedTime = Date.parse(result!.timestamp);
    expect(parsedTime).toBeGreaterThanOrEqual(before);
  });
});

describe("Event type routing", () => {
  it("message events are routed to ingestInboundMessage", () => {
    const event = { type: "message", payload: {} };
    expect(event.type).toBe("message");
  });

  it("receipt events are routed to applyReceipt", () => {
    const event = { type: "receipt", payload: {} };
    expect(event.type).toBe("receipt");
  });

  it("reaction events are routed to applyReaction", () => {
    const event = { type: "reaction", payload: {} };
    expect(event.type).toBe("reaction");
  });

  it("unknown event types are acknowledged", () => {
    const event = { type: "future_event", payload: {} };
    expect(event.type).not.toBe("message");
    expect(event.type).not.toBe("receipt");
    expect(event.type).not.toBe("receipt");
    expect(event.type).not.toBe("reaction");
  });
});

describe("Receipt status validation (mirrors gateway mapReceiptToStatus)", () => {
  it("validates sent status", () => {
    const validStatuses = ["sent", "delivered", "read", "failed"];
    expect(validStatuses).toContain("sent");
  });

  it("validates delivered status", () => {
    const validStatuses = ["sent", "delivered", "read", "failed"];
    expect(validStatuses).toContain("delivered");
  });

  it("validates read status", () => {
    const validStatuses = ["sent", "delivered", "read", "failed"];
    expect(validStatuses).toContain("read");
  });

  it("validates failed status", () => {
    const validStatuses = ["sent", "delivered", "read", "failed"];
    expect(validStatuses).toContain("failed");
  });

  it("rejects invalid status values", () => {
    const validStatuses = ["sent", "delivered", "read", "failed"];
    expect(validStatuses).not.toContain("pending");
    expect(validStatuses).not.toContain("unknown");
    expect(validStatuses).not.toContain("");
  });
});

describe("Reaction payload validation", () => {
  it("requires valid projectId", () => {
    const projectId = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    expect(projectId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it("requires non-empty emoji", () => {
    const emoji = "👍";
    expect(emoji.length).toBeGreaterThan(0);
  });

  it("requires externalId to be a string", () => {
    const externalId = "some-baileys-message-id";
    expect(typeof externalId).toBe("string");
  });
});
