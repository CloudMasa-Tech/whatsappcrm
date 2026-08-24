// ============================================================
// Outbound Instagram Message Dispatcher
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/whatsapp/encryption";
import { sendDirectTextMessage } from "./direct-client";
import { sendMetaTextMessage, sendMetaMediaMessage } from "./meta-client";
import type { InstagramSendMessageResult } from "./types";

export interface SendInstagramMessageParams {
  conversationId: string;
  projectId: string;
  accountId: string;
  userId?: string;
  contentText?: string | null;
  mediaUrl?: string | null;
  mediaType?: "image" | "video" | "audio";
}

export async function sendInstagramMessage(
  db: SupabaseClient,
  params: SendInstagramMessageParams,
): Promise<InstagramSendMessageResult> {
  const { conversationId, projectId, accountId, contentText, mediaUrl, mediaType = "image" } = params;

  if (!contentText && !mediaUrl) {
    throw new Error("Message must have text content or media URL.");
  }

  // 1. Fetch Instagram configuration for this project
  const { data: config, error: configErr } = await db
    .from("instagram_config")
    .select("*")
    .eq("project_id", projectId)
    .maybeSingle();

  if (configErr || !config || config.status !== "connected") {
    throw new Error("Instagram is not connected for this project. Please configure it in Instagram Settings.");
  }

  // 2. Fetch target conversation and recipient contact
  const { data: conv, error: convErr } = await db
    .from("conversations")
    .select("id, contact_id, contacts(id, instagram_id, instagram_username, name, phone)")
    .eq("id", conversationId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (convErr || !conv) {
    throw new Error("Conversation not found.");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contact = conv.contacts as any;
  const recipientTarget =
    contact?.instagram_id ||
    contact?.instagram_username ||
    contact?.phone?.replace(/^ig:/, "") ||
    contact?.name;

  if (!recipientTarget) {
    throw new Error("Recipient Instagram account identifier is missing.");
  }

  let externalMessageId = `ig_${Date.now()}`;

  // 3. Send over the active connection method
  if (config.connection_method === "direct") {
    if (!config.session_data) {
      throw new Error("Instagram session data is missing. Please reconnect your account.");
    }
    const decryptedSession = decrypt(config.session_data);
    const textToSend = contentText || (mediaUrl ? `[Media: ${mediaUrl}]` : "");
    const res = await sendDirectTextMessage(decryptedSession, recipientTarget, textToSend);

    if (!res.success) {
      throw new Error(res.error || "Failed to send Instagram Direct message.");
    }
    if (res.messageId) {
      externalMessageId = res.messageId;
    }
  } else {
    // Meta Cloud API
    if (!config.access_token) {
      throw new Error("Meta Access Token is missing. Please update your Instagram settings.");
    }
    const decryptedToken = decrypt(config.access_token);

    if (mediaUrl) {
      const res = await sendMetaMediaMessage(decryptedToken, recipientTarget, mediaUrl, mediaType);
      externalMessageId = res.messageId;
    } else if (contentText) {
      const res = await sendMetaTextMessage(decryptedToken, recipientTarget, contentText);
      externalMessageId = res.messageId;
    }
  }

  // 4. Record outbound message in database
  const { data: inserted, error: insertErr } = await db
    .from("messages")
    .insert({
      conversation_id: conversationId,
      project_id: projectId,
      sender_type: "agent",
      content_type: mediaUrl ? mediaType : "text",
      content_text: contentText || null,
      media_url: mediaUrl || null,
      message_id: externalMessageId,
      status: "delivered",
      channel: "instagram",
      created_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (insertErr || !inserted) {
    console.error("[Instagram send] message insertion failed:", insertErr);
    throw new Error("Message sent to Instagram, but failed to save in conversation history.");
  }

  // 5. Update conversation preview
  await db
    .from("conversations")
    .update({
      last_message_text: contentText || (mediaUrl ? `[${mediaType}]` : "Message"),
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      channel: "instagram",
    })
    .eq("id", conversationId);

  return {
    messageId: inserted.id as string,
    externalMessageId,
    success: true,
  };
}
