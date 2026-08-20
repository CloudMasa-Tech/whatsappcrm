// ============================================================
// Transport hop for the engines (automations, flows).
//
// Those engines predate projects and call Meta's Graph API directly
// rather than going through `sendMessageToConversation`. That was fine
// when every account spoke Cloud API. With QR projects it is not: an
// automation on a QR project would build a Graph request against a
// `whatsapp_config` row that does not exist.
//
// Rather than rewrite both engines onto the send core (a much larger
// change, and they persist their messages differently — sender_type
// 'bot', their own logging), this gives them one function to ask:
// "is this project on QR, and if so, send it." A null return means
// "not QR — carry on with the existing Meta path", so the Cloud API
// behaviour is untouched.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { GatewayError, sendViaGateway } from "./gateway";
import { resolveProjectChannel } from "./resolve";
import { supportsMessageKind, unsupportedReason } from "./types";

export interface EngineSendParams {
  db: SupabaseClient;
  projectId: string;
  /** Recipient in E.164. */
  to: string;
  kind: "text" | "image" | "video" | "document" | "audio";
  text?: string | null;
  mediaUrl?: string | null;
  filename?: string | null;
}

/**
 * Send through the QR gateway when the project is on that channel.
 *
 * Returns the transport message id on success, or `null` when the
 * project is NOT a QR project — the caller should then run its
 * existing Cloud API path.
 *
 * Throws when the project is on QR but the send is impossible (the
 * session is not paired, the gateway is down, the message kind has no
 * QR equivalent). Callers surface that as a failed step rather than
 * silently dropping the message.
 */
export async function sendViaQrIfApplicable(
  params: EngineSendParams,
): Promise<string | null> {
  const { db, projectId, to, kind, text, mediaUrl, filename } = params;

  const channel = await resolveProjectChannel(db, projectId);
  if (!channel || channel.channelType !== "qr") return null;

  if (!supportsMessageKind("qr", kind)) {
    throw new Error(unsupportedReason("qr", kind));
  }

  try {
    const { externalId } = await sendViaGateway({
      projectId,
      to,
      kind,
      text: text ?? null,
      mediaUrl: mediaUrl ?? null,
      filename: filename ?? null,
    });
    return externalId;
  } catch (err) {
    if (err instanceof GatewayError) {
      // Keep the gateway's own wording — it distinguishes "not paired
      // yet" from "gateway unreachable", and the engine step detail is
      // where an operator will read it.
      throw new Error(err.message);
    }
    throw err;
  }
}

/**
 * True when a project cannot express `kind`. Lets an engine reject a
 * step at validation time — before it has logged a run and half-sent
 * a sequence — rather than at the network call.
 */
export async function projectSupportsKind(
  db: SupabaseClient,
  projectId: string,
  kind: string,
): Promise<boolean> {
  const channel = await resolveProjectChannel(db, projectId);
  if (!channel) return false;
  return supportsMessageKind(channel.channelType, kind);
}
