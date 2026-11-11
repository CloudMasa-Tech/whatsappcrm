// ============================================================
// Outbound Instagram Message Dispatcher
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/whatsapp/encryption";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendDirectTextMessage } from "./direct-client";
import { sendMetaTextMessage, sendMetaMediaMessage } from "./meta-client";
import type { InstagramSendMessageResult, InstagramTokenType } from "./types";

export interface SendInstagramMessageParams {
  conversationId: string;
  projectId: string;
  accountId: string;
  userId?: string;
  contentText?: string | null;
  mediaUrl?: string | null;
  mediaType?: "image" | "video" | "audio" | "document" | "text" | string;
  filename?: string | null;
  replyToMessageId?: string | null;
}

export class InstagramSendError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 400, code = "instagram_send_error") {
    super(message);
    this.name = "InstagramSendError";
    this.status = status;
    this.code = code;
  }
}

export async function sendInstagramMessage(
  db: SupabaseClient,
  params: SendInstagramMessageParams,
): Promise<InstagramSendMessageResult> {
  const {
    conversationId,
    projectId,
    contentText,
    mediaUrl,
    mediaType = "image",
    filename,
    replyToMessageId,
  } = params;

  const trimmedText = contentText?.trim() || "";
  if (!trimmedText && !mediaUrl) {
    throw new InstagramSendError("Message must have text content or media URL.", 400, "empty_message");
  }

  // Instagram Messaging supports text, image, video, and audio (not PDF documents/templates)
  if (mediaUrl && mediaType === "document") {
    throw new InstagramSendError(
      "Instagram Direct Messages only support images, videos, audio notes, and text (documents are not supported by Instagram).",
      400,
      "unsupported_media_kind",
    );
  }
  const normalizedMediaType: "image" | "video" | "audio" =
    mediaType === "video" || mediaType === "audio" ? mediaType : "image";

  // 1. Fetch Instagram configuration for this project
  const { data: config, error: configErr } = await db
    .from("instagram_config")
    .select("*")
    .eq("project_id", projectId)
    .maybeSingle();

  if (configErr || !config || config.status !== "connected") {
    throw new InstagramSendError(
      "Instagram is not connected for this project. Please connect it in Instagram Settings.",
      400,
      "instagram_not_connected",
    );
  }

  // 2. Fetch target conversation and recipient contact
  const { data: conv, error: convErr } = await db
    .from("conversations")
    .select("id, contact_id, contacts(id, instagram_id, instagram_username, name, phone)")
    .eq("id", conversationId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (convErr || !conv) {
    throw new InstagramSendError("Conversation not found.", 404, "conversation_not_found");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contact = (Array.isArray(conv.contacts) ? conv.contacts[0] : conv.contacts) as any;
  const igsid = contact?.instagram_id ? String(contact.instagram_id).trim() : null;
  const usernameHandle =
    contact?.instagram_username?.trim() ||
    contact?.phone?.replace(/^ig[:_]/, "")?.trim() ||
    null;

  // Resolve parent external message_id if replying to a quoted message
  let replyToExternalMid: string | null = null;
  if (replyToMessageId) {
    const { data: parentMsg } = await db
      .from("messages")
      .select("message_id")
      .eq("id", replyToMessageId)
      .eq("conversation_id", conversationId)
      .maybeSingle();
    replyToExternalMid = (parentMsg?.message_id as string | null) ?? null;
  }

  let externalMessageId = `ig_${Date.now()}`;

  // 3. Send over active transport
  if (config.connection_method === "direct") {
    if (!config.session_data) {
      throw new InstagramSendError(
        "Instagram session data is missing. Please reconnect your account.",
        400,
        "missing_session",
      );
    }

    if (mediaUrl && !trimmedText) {
      throw new InstagramSendError(
        "Sending photo/video attachments in DMs requires Meta Cloud API connection. Switch to Meta Cloud API or send a text message.",
        400,
        "direct_media_unsupported",
      );
    }

    const recipientTarget = igsid || usernameHandle;
    if (!recipientTarget) {
      throw new InstagramSendError(
        "Recipient Instagram identifier is missing.",
        400,
        "missing_recipient",
      );
    }

    const decryptedSession = decrypt(config.session_data);
    const textToSend = mediaUrl ? `${trimmedText}\n${mediaUrl}`.trim() : trimmedText;
    const res = await sendDirectTextMessage(decryptedSession, recipientTarget, textToSend);

    if (!res.success) {
      throw new InstagramSendError(
        res.error || "Failed to send Instagram Direct message.",
        502,
        "direct_send_failed",
      );
    }

    if (res.messageId) {
      externalMessageId = res.messageId;
    }
    // Backfill numeric instagram_id when resolved on direct send
    if (!igsid && res.recipientPk && contact?.id) {
      await supabaseAdmin()
        .from("contacts")
        .update({ instagram_id: res.recipientPk })
        .eq("id", contact.id)
        .eq("project_id", projectId);
    }
  } else {
    // Meta Cloud API / Instagram Login API
    if (!config.access_token) {
      throw new InstagramSendError(
        "Meta Access Token is missing. Please update your Instagram settings.",
        400,
        "missing_token",
      );
    }

    if (!igsid) {
      throw new InstagramSendError(
        "Meta Cloud API requires the customer's Instagram Scoped ID (IGSID). Meta only issues an IGSID after the user messages you first or via Comment-to-DM Private Reply.",
        400,
        "missing_igsid",
      );
    }

    const decryptedToken = decrypt(config.access_token);
    const opts = {
      replyToMid: replyToExternalMid,
      tokenType: (config.token_type as InstagramTokenType | undefined) ?? undefined,
      igId: config.instagram_business_id ?? undefined,
      pageId: config.page_id ?? undefined,
    };

    if (mediaUrl) {
      const res = await sendMetaMediaMessage(
        decryptedToken,
        igsid,
        mediaUrl,
        normalizedMediaType,
        opts,
      );
      externalMessageId = res.messageId;
      // Meta Instagram attachment API doesn't carry inline text captions on the attachment packet; send text follow-up if provided
      if (trimmedText) {
        await sendMetaTextMessage(decryptedToken, igsid, trimmedText, opts);
      }
    } else {
      const res = await sendMetaTextMessage(decryptedToken, igsid, trimmedText, opts);
      externalMessageId = res.messageId;
    }
  }

  // 4. Record outbound message in database
  const nowIso = new Date().toISOString();
  const { data: inserted, error: insertErr } = await db
    .from("messages")
    .insert({
      conversation_id: conversationId,
      project_id: projectId,
      sender_type: "agent",
      content_type: mediaUrl ? normalizedMediaType : "text",
      content_text: trimmedText || filename || null,
      media_url: mediaUrl || null,
      reply_to_message_id: replyToMessageId || null,
      message_id: externalMessageId,
      status: "sent",
      channel: "instagram",
      created_at: nowIso,
    })
    .select("id")
    .single();

  if (insertErr || !inserted) {
    console.error("[Instagram send] message insertion failed:", insertErr);
    throw new InstagramSendError(
      "Message sent to Instagram, but failed to save in conversation history.",
      500,
      "db_insert_failed",
    );
  }

  // 5. Update conversation preview
  await db
    .from("conversations")
    .update({
      last_message_text: trimmedText || (mediaUrl ? `[${normalizedMediaType}]` : "Message"),
      last_message_at: nowIso,
      updated_at: nowIso,
      channel: "instagram",
    })
    .eq("id", conversationId)
    .eq("project_id", projectId);

  // 6. Pause any active automated flow run when a human agent intervenes
  if (conv.contact_id) {
    await supabaseAdmin()
      .from("flow_runs")
      .update({ status: "paused", ended_reason: "agent_replied" })
      .eq("project_id", projectId)
      .eq("contact_id", conv.contact_id)
      .eq("status", "active");
  }

  return {
    messageId: inserted.id as string,
    externalMessageId,
    success: true,
  };
}
