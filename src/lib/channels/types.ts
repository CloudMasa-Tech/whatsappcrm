// ============================================================
// Channel abstraction — the CRM speaks two WhatsApp transports.
//
//   'cloud_api'  Meta Graph API. Official, template-gated, webhook
//                delivery. Everything wacrm did before projects.
//   'qr'         WhatsApp Web pairing (Baileys) held open by the
//                gateway service. No templates, no Meta-style
//                interactive messages, but any number can connect by
//                scanning a QR code.
//
// A PROJECT picks one — `projects.channel_type` — and every message in
// that project travels over it. The pair is deliberately not
// switchable on a live project: existing conversations would be
// stranded on a transport that can no longer reach them.
//
// This module is types + capability rules only, so it stays importable
// from anywhere (including client components) without dragging in the
// Node-only transport code.
// ============================================================

export type ChannelType = "cloud_api" | "qr";

/** Message kinds the app can send, mirroring VALID_MESSAGE_TYPES. */
export type MessageKind =
  | "text"
  | "template"
  | "interactive"
  | "image"
  | "video"
  | "document"
  | "audio";

/**
 * What each transport can actually do.
 *
 * `template` and `interactive` are Cloud API constructs: approved
 * message templates and Meta's button/list payloads exist only inside
 * the Graph API. A QR session can send the same *text*, but it cannot
 * send an approved template or render native interactive controls, and
 * pretending otherwise would fail at send time with an opaque error.
 * Callers ask `supportsMessageKind()` and disable the control instead.
 */
const CHANNEL_CAPABILITIES: Record<ChannelType, readonly MessageKind[]> = {
  cloud_api: [
    "text",
    "template",
    "interactive",
    "image",
    "video",
    "document",
    "audio",
  ],
  qr: ["text", "image", "video", "document", "audio"],
};

export function supportsMessageKind(
  channel: ChannelType,
  kind: MessageKind | string,
): boolean {
  const allowed = CHANNEL_CAPABILITIES[channel];
  return !!allowed && (allowed as readonly string[]).includes(kind);
}

/** Human-readable reason, used verbatim in API errors and tooltips. */
export function unsupportedReason(
  channel: ChannelType,
  kind: MessageKind | string,
): string {
  if (channel === "qr" && kind === "template") {
    return "Approved message templates are a Cloud API feature. This project is connected by QR code — send the message as text instead.";
  }
  if (channel === "qr" && kind === "interactive") {
    return "Interactive buttons and list messages are a Cloud API feature. This project is connected by QR code — send the message as text instead.";
  }
  return `The ${channel === "qr" ? "QR" : "Cloud API"} channel does not support "${kind}" messages.`;
}

/** Where a project's outbound messages go. */
export interface ProjectChannel {
  projectId: string;
  accountId: string;
  channelType: ChannelType;
}

/** Normalised inbound message, transport-independent. */
export interface InboundMessage {
  projectId: string;
  /** Sender's phone in E.164-ish form, as the transport reported it. */
  from: string;
  /** Transport message id — Meta's wamid, or Baileys' key.id. */
  externalId: string;
  kind: MessageKind | "location" | "sticker" | "reaction" | "unknown";
  text?: string | null;
  /** Profile name the transport reported, if any. */
  senderName?: string | null;
  timestamp: string;
  /** True if the message was sent from the linked WhatsApp account/phone. */
  fromMe?: boolean;
  /** True if the message arrived as part of historical chat sync. */
  isHistory?: boolean;
  media?: {
    /** Already-hosted URL. The gateway uploads before notifying us. */
    url: string;
    mimeType: string;
    filename?: string | null;
    caption?: string | null;
  } | null;
  /** External id of the message this one replies to, if any. */
  replyToExternalId?: string | null;
}
