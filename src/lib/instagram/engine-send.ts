// ============================================================
// Engine-Side Outbound Sender for Instagram Conversations
//
// Called ONLY when conversations.channel === 'instagram' from
// Flows, Automations, and AI Auto-Reply — keeping every WhatsApp
// execution path completely untouched.
// ============================================================

import { decrypt } from "@/lib/whatsapp/encryption";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { InteractiveMessagePayload } from "@/lib/whatsapp/interactive";
import { sendDirectTextMessage } from "./direct-client";
import { sendMetaMediaMessage, sendMetaTextMessage } from "./meta-client";
import type { InstagramTokenType } from "./types";

export interface EngineInstagramSendParams {
  projectId: string;
  conversationId: string;
  contactId: string;
  kind: "text" | "image" | "video" | "audio" | "document" | "interactive" | "template";
  text?: string | null;
  mediaUrl?: string | null;
  interactivePayload?: InteractiveMessagePayload | null;
  aiGenerated?: boolean;
}

function formatInteractiveAsInstagramText(payload: InteractiveMessagePayload): string {
  const lines: string[] = [];
  if (payload.header) lines.push(payload.header);
  lines.push(payload.body);
  if (payload.kind === "buttons") {
    payload.buttons.forEach((b, idx) => {
      lines.push(`${idx + 1}. ${b.title}`);
    });
  } else {
    let idx = 1;
    for (const sec of payload.sections) {
      if (sec.title) lines.push(`\n${sec.title}`);
      for (const r of sec.rows) {
        lines.push(`${idx}. ${r.title}${r.description ? ` — ${r.description}` : ""}`);
        idx++;
      }
    }
  }
  if (payload.footer) lines.push(payload.footer);
  return lines.join("\n").trim();
}

export async function engineSendToInstagram(
  params: EngineInstagramSendParams,
): Promise<{ externalMessageId: string }> {
  const db = supabaseAdmin();

  const { data: config, error: cfgErr } = await db
    .from("instagram_config")
    .select("*")
    .eq("project_id", params.projectId)
    .eq("status", "connected")
    .maybeSingle();

  if (cfgErr || !config) {
    throw new Error("Instagram is not connected for this project");
  }

  const { data: contact, error: contactErr } = await db
    .from("contacts")
    .select("id, instagram_id, instagram_username, phone")
    .eq("id", params.contactId)
    .eq("project_id", params.projectId)
    .maybeSingle();

  if (contactErr || !contact) {
    throw new Error("Instagram contact not found in this project");
  }

  const igsid = contact.instagram_id ? String(contact.instagram_id).trim() : null;
  const fallbackHandle =
    contact.instagram_username?.trim() ||
    contact.phone?.replace(/^ig[:_]/, "")?.trim() ||
    null;

  let textToSend = params.text?.trim() || "";
  if (params.kind === "interactive" && params.interactivePayload) {
    textToSend = formatInteractiveAsInstagramText(params.interactivePayload);
  }
  if (params.kind === "document" && params.mediaUrl && !textToSend) {
    textToSend = params.mediaUrl;
  }

  let externalId = `ig_bot_${Date.now()}`;

  if (config.connection_method === "direct") {
    if (!config.session_data) {
      throw new Error("Instagram Direct session is missing");
    }
    const target = igsid || fallbackHandle;
    if (!target) {
      throw new Error("Recipient Instagram handle or ID is missing");
    }
    const bodyText =
      params.mediaUrl && !textToSend
        ? params.mediaUrl
        : params.mediaUrl && textToSend
        ? `${textToSend}\n${params.mediaUrl}`
        : textToSend;

    const decryptedSession = decrypt(config.session_data);
    const res = await sendDirectTextMessage(decryptedSession, target, bodyText);
    if (!res.success) {
      throw new Error(res.error || "Failed to send Instagram Direct automated reply");
    }
    if (res.messageId) externalId = res.messageId;
  } else {
    if (!config.access_token) {
      throw new Error("Instagram Meta Access Token is missing");
    }
    if (!igsid) {
      throw new Error("Recipient IGSID is missing — cannot send Meta Graph DM");
    }
    const decryptedToken = decrypt(config.access_token);
    const opts = {
      tokenType: (config.token_type as InstagramTokenType | undefined) ?? undefined,
      igId: config.instagram_business_id ?? undefined,
      pageId: config.page_id ?? undefined,
    };

    if (
      params.mediaUrl &&
      (params.kind === "image" || params.kind === "video" || params.kind === "audio")
    ) {
      const r = await sendMetaMediaMessage(
        decryptedToken,
        igsid,
        params.mediaUrl,
        params.kind,
        opts,
      );
      externalId = r.messageId;
      if (textToSend) {
        await sendMetaTextMessage(decryptedToken, igsid, textToSend, opts);
      }
    } else {
      const r = await sendMetaTextMessage(
        decryptedToken,
        igsid,
        textToSend || (params.mediaUrl ?? ""),
        opts,
      );
      externalId = r.messageId;
    }
  }

  const nowIso = new Date().toISOString();
  const dbContentType =
    params.kind === "interactive"
      ? "interactive"
      : params.mediaUrl && (params.kind === "image" || params.kind === "video" || params.kind === "audio")
      ? params.kind
      : "text";

  const { error: msgErr } = await db.from("messages").insert({
    conversation_id: params.conversationId,
    project_id: params.projectId,
    sender_type: "bot",
    content_type: dbContentType,
    content_text: textToSend || null,
    media_url: params.mediaUrl ?? null,
    interactive_payload: params.interactivePayload ?? null,
    message_id: externalId,
    status: "sent",
    channel: "instagram",
    ai_generated: params.aiGenerated ?? false,
    created_at: nowIso,
  });

  if (msgErr) {
    throw new Error(`Sent to Instagram but DB insert failed: ${msgErr.message}`);
  }

  await db
    .from("conversations")
    .update({
      last_message_text: textToSend || `[${dbContentType}]`,
      last_message_at: nowIso,
      updated_at: nowIso,
      channel: "instagram",
    })
    .eq("id", params.conversationId)
    .eq("project_id", params.projectId);

  return { externalMessageId: externalId };
}

