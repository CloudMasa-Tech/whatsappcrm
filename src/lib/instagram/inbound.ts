// ============================================================
// Canonical Instagram Inbound Message Ingestion Pipeline
//
// Shared by:
//   - POST /api/instagram/webhook  (real-time Meta webhooks)
//   - POST /api/instagram/sync-inbox (historical Meta / Direct DM pull)
//
// Handles:
//   - Project validation & archived guard
//   - Idempotent deduplication by (project_id, message_id)
//   - Sealed proxy URL generation for inbound media (cached on demand; no Storage bloat)
//   - Contact lookup/merge & auto-lead deal creation
//   - Channel-aware Conversation lookup/create + round-robin assignment
//   - Quoted reply resolution (`reply_to_message_id`)
//   - Unread counting, agent notifications, auto-unsnooze
//   - Sequential fan-out: Flows -> Automations -> AI Auto-Reply -> Webhook
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { isUniqueViolation } from "@/lib/contacts/dedupe";
import { ensureContactDeal } from "@/lib/deals/auto-lead";
import { runAutomationsForTrigger } from "@/lib/automations/engine";
import { dispatchInboundToFlows } from "@/lib/flows/engine";
import { dispatchInboundToAiReply } from "@/lib/ai/auto-reply";
import { getNextRoundRobinAgentId } from "@/lib/inbox/round-robin";
import { dispatchWebhookEvent } from "@/lib/webhooks/deliver";
import { dispatchNotification } from "@/lib/notifications/dispatch";
import { encrypt } from "@/lib/whatsapp/encryption";

export interface NormalizedInstagramInbound {
  accountId: string;
  projectId: string;
  configOwnerUserId: string;
  senderIgsid: string;
  senderUsername?: string | null;
  senderName?: string | null;
  senderAvatarUrl?: string | null;
  externalMessageId: string;
  text?: string | null;
  mediaUrl?: string | null;
  mediaType?: "text" | "image" | "video" | "audio" | string;
  replyToExternalMid?: string | null;
  timestampIso: string;
  fromMe?: boolean;
  isHistory?: boolean;
}

export interface InstagramIngestResult {
  contactId: string;
  conversationId: string;
  messageId: string;
  ingested: boolean;
}

/**
 * Seal an inbound Instagram attachment URL into an authenticated, cached
 * proxy endpoint (`/api/instagram/dm-media?ref=...`) instead of uploading
 * inbound chat media permanently into Supabase Storage.
 */
export function buildInstagramMediaProxyUrl(
  projectId: string,
  sourceUrl: string,
  externalMessageId: string | null | undefined,
  mediaKind: string,
): string {
  if (!sourceUrl || sourceUrl.startsWith("/api/instagram/dm-media")) {
    return sourceUrl;
  }
  try {
    const encrypted = encrypt(
      JSON.stringify({
        v: 1,
        p: projectId,
        u: sourceUrl,
        ...(externalMessageId ? { mid: externalMessageId } : {}),
        k: mediaKind,
      }),
    );
    const ref = Buffer.from(encrypted, "utf8").toString("base64url");
    return `/api/instagram/dm-media?ref=${ref}`;
  } catch {
    return sourceUrl;
  }
}

export async function ingestInstagramMessage(
  db: SupabaseClient,
  msg: NormalizedInstagramInbound,
): Promise<InstagramIngestResult | null> {
  const {
    accountId,
    projectId,
    configOwnerUserId,
    senderIgsid,
    externalMessageId,
    timestampIso,
  } = msg;

  // 0. Check project exists and is active
  const { data: project } = await db
    .from("projects")
    .select("id, archived_at")
    .eq("id", projectId)
    .maybeSingle();

  if (!project || project.archived_at) {
    return null;
  }

  // 1. Idempotency check by external message_id
  if (externalMessageId) {
    const { data: existing } = await db
      .from("messages")
      .select("id, conversation_id")
      .eq("project_id", projectId)
      .eq("message_id", externalMessageId)
      .maybeSingle();

    if (existing) {
      return {
        contactId: "",
        conversationId: existing.conversation_id as string,
        messageId: existing.id as string,
        ingested: false,
      };
    }
  }

  const cleanUsername = msg.senderUsername?.trim().replace(/^@+/, "") || null;
  const cleanName = msg.senderName?.trim() || (cleanUsername ? `@${cleanUsername}` : `Instagram User (${senderIgsid.slice(0, 6)})`);

  // 2. Resolve or create Instagram Contact (project-scoped)
  let contactId: string | null = null;
  let existingContact: {
    id: string;
    name: string | null;
    instagram_id: string | null;
    instagram_username: string | null;
    avatar_url: string | null;
  } | null = null;

  if (senderIgsid) {
    const { data } = await db
      .from("contacts")
      .select("id, name, instagram_id, instagram_username, avatar_url")
      .eq("project_id", projectId)
      .eq("instagram_id", senderIgsid)
      .maybeSingle();
    existingContact = data;
  }

  if (!existingContact && cleanUsername) {
    const { data } = await db
      .from("contacts")
      .select("id, name, instagram_id, instagram_username, avatar_url")
      .eq("project_id", projectId)
      .ilike("instagram_username", cleanUsername)
      .maybeSingle();
    existingContact = data;
  }

  if (existingContact) {
    contactId = existingContact.id as string;
    const patch: Record<string, unknown> = {};
    if (!existingContact.instagram_id && senderIgsid) patch.instagram_id = senderIgsid;
    if (cleanUsername && existingContact.instagram_username !== cleanUsername) {
      patch.instagram_username = cleanUsername;
    }
    if (msg.senderAvatarUrl && !existingContact.avatar_url) {
      patch.avatar_url = msg.senderAvatarUrl;
    }
    if (cleanName && (!existingContact.name || String(existingContact.name).startsWith("Instagram User"))) {
      patch.name = cleanName;
    }
    if (Object.keys(patch).length > 0) {
      await db.from("contacts").update(patch).eq("id", contactId).eq("project_id", projectId);
    }
  } else {
    const { data: created, error: contactErr } = await db
      .from("contacts")
      .insert({
        account_id: accountId,
        project_id: projectId,
        user_id: configOwnerUserId,
        name: cleanName,
        instagram_id: senderIgsid || null,
        instagram_username: cleanUsername || `ig_${senderIgsid.slice(0, 10)}`,
        phone: `ig:${senderIgsid || cleanUsername}`,
        avatar_url: msg.senderAvatarUrl || null,
        channel: "instagram",
      })
      .select("id")
      .single();

    if (contactErr || !created) {
      if (isUniqueViolation(contactErr)) {
        const { data: raced } = await db
          .from("contacts")
          .select("id")
          .eq("project_id", projectId)
          .or(
            senderIgsid && cleanUsername
              ? `instagram_id.eq.${senderIgsid},instagram_username.ilike.${cleanUsername}`
              : senderIgsid
              ? `instagram_id.eq.${senderIgsid}`
              : `instagram_username.ilike.${cleanUsername}`,
          )
          .maybeSingle();
        if (raced) contactId = raced.id as string;
      }
      if (!contactId) {
        console.error("[instagram/inbound] contact insert failed:", contactErr);
        return null;
      }
    } else {
      contactId = created.id as string;
      void ensureContactDeal(db, {
        contactId,
        projectId,
        accountId,
        userId: configOwnerUserId,
        name: cleanName,
        phone: cleanUsername ? `@${cleanUsername}` : senderIgsid,
      });
    }
  }

  // 3. Resolve or create Instagram Conversation (channel-scoped)
  let conversationId: string | null = null;
  let isFirstInbound = false;
  let assignedAgentId: string | null = null;
  let existingUnread = 0;
  let lastMessageAt: string | null = null;

  const { data: existingConv } = await db
    .from("conversations")
    .select("id, unread_count, assigned_agent_id, last_message_at")
    .eq("project_id", projectId)
    .eq("contact_id", contactId)
    .eq("channel", "instagram")
    .maybeSingle();

  if (existingConv) {
    conversationId = existingConv.id as string;
    existingUnread = Number(existingConv.unread_count ?? 0);
    assignedAgentId = (existingConv.assigned_agent_id as string | null) ?? null;
    lastMessageAt = (existingConv.last_message_at as string | null) ?? null;
  } else {
    isFirstInbound = true;
    const roundRobinAgent = await getNextRoundRobinAgentId(db, accountId, projectId).catch(() => null);
    const { data: newConv, error: convErr } = await db
      .from("conversations")
      .insert({
        account_id: accountId,
        project_id: projectId,
        contact_id: contactId,
        user_id: configOwnerUserId,
        assigned_agent_id: roundRobinAgent,
        status: "open",
        channel: "instagram",
      })
      .select("id, assigned_agent_id")
      .single();

    if (convErr || !newConv) {
      if (isUniqueViolation(convErr)) {
        const { data: raced } = await db
          .from("conversations")
          .select("id, unread_count, assigned_agent_id, last_message_at")
          .eq("project_id", projectId)
          .eq("contact_id", contactId)
          .eq("channel", "instagram")
          .maybeSingle();
        if (raced) {
          conversationId = raced.id as string;
          existingUnread = Number(raced.unread_count ?? 0);
          assignedAgentId = (raced.assigned_agent_id as string | null) ?? null;
          lastMessageAt = (raced.last_message_at as string | null) ?? null;
          isFirstInbound = false;
        }
      }
      if (!conversationId) {
        console.error("[instagram/inbound] conversation insert failed:", convErr);
        return null;
      }
    } else {
      conversationId = newConv.id as string;
      assignedAgentId = (newConv.assigned_agent_id as string | null) ?? null;
    }
  }

  // 4. Route inbound attachments through the ephemeral cached proxy (no Storage upload)
  const contentType =
    msg.mediaType === "image" || msg.mediaType === "video" || msg.mediaType === "audio"
      ? msg.mediaType
      : msg.mediaUrl
      ? "image"
      : "text";

  const storedMediaUrl = msg.mediaUrl
    ? buildInstagramMediaProxyUrl(projectId, msg.mediaUrl, externalMessageId, contentType)
    : null;

  // Resolve reply_to UUID if Meta gave parent mid
  let replyToUuid: string | null = null;
  if (msg.replyToExternalMid) {
    const { data: replyRow } = await db
      .from("messages")
      .select("id")
      .eq("conversation_id", conversationId)
      .eq("message_id", msg.replyToExternalMid)
      .maybeSingle();
    replyToUuid = (replyRow?.id as string | null) ?? null;
  }

  const fromMe = Boolean(msg.fromMe);
  const isHistory = Boolean(msg.isHistory);
  const textContent = msg.text?.trim() || null;

  // 5. Insert message
  const { data: insertedMsg, error: msgErr } = await db
    .from("messages")
    .insert({
      conversation_id: conversationId,
      project_id: projectId,
      sender_type: fromMe ? "agent" : "customer",
      content_type: contentType,
      content_text: textContent,
      media_url: storedMediaUrl,
      reply_to_message_id: replyToUuid,
      message_id: externalMessageId || null,
      status: "delivered",
      channel: "instagram",
      created_at: timestampIso,
    })
    .select("id")
    .single();

  if (msgErr || !insertedMsg) {
    if (isUniqueViolation(msgErr)) {
      return {
        contactId,
        conversationId,
        messageId: "",
        ingested: false,
      };
    }
    console.error("[instagram/inbound] message insert failed:", msgErr);
    return null;
  }

  const preview = textContent || (storedMediaUrl ? `[${contentType}]` : "[Instagram Message]");
  const isNewer = !lastMessageAt || new Date(timestampIso) >= new Date(lastMessageAt);

  if (isNewer) {
    await db
      .from("conversations")
      .update({
        last_message_text: preview,
        last_message_at: timestampIso,
        unread_count: fromMe || isHistory ? existingUnread : existingUnread + 1,
        updated_at: new Date().toISOString(),
        channel: "instagram",
      })
      .eq("id", conversationId)
      .eq("project_id", projectId);
  }

  // 6. Downstream notifications & responders for live customer DMs
  if (!fromMe && !isHistory) {
    if (assignedAgentId) {
      void dispatchNotification(db, {
        accountId,
        projectId,
        userId: assignedAgentId,
        type: "new_message",
        title: `New Instagram DM from ${cleanName}`,
        body: preview,
        conversationId,
        contactId,
      });
    }

    // Auto-unsnooze active reminders
    void (async () => {
      try {
        const { data: reminders } = await db
          .from("conversation_reminders")
          .select("id")
          .eq("conversation_id", conversationId)
          .is("completed_at", null);
        if (reminders && reminders.length > 0) {
          await db
            .from("conversation_reminders")
            .update({ completed_at: new Date().toISOString() })
            .eq("conversation_id", conversationId)
            .is("completed_at", null);
          await db
            .from("conversations")
            .update({ status: "open", updated_at: new Date().toISOString() })
            .eq("id", conversationId);
        }
      } catch (err) {
        console.error("[instagram/inbound] auto-unsnooze failed:", err);
      }
    })();

    const textForEngines = textContent ?? "";
    let consumedByFlow = false;

    if (textForEngines) {
      try {
        const flowRes = await dispatchInboundToFlows({
          accountId,
          projectId,
          userId: configOwnerUserId,
          contactId,
          conversationId,
          isFirstInboundMessage: isFirstInbound,
          message: {
            kind: "text",
            text: textForEngines,
            meta_message_id: externalMessageId,
          },
        });
        consumedByFlow = Boolean(flowRes?.consumed);
      } catch (err) {
        console.error("[instagram/inbound] flow dispatch failed:", err);
      }
    }

    const triggers: Array<"first_inbound_message" | "new_message_received"> = isFirstInbound
      ? ["first_inbound_message", "new_message_received"]
      : ["new_message_received"];

    for (const triggerType of triggers) {
      try {
        await runAutomationsForTrigger({
          accountId,
          projectId,
          triggerType,
          contactId,
          context: {
            message_text: textForEngines,
            conversation_id: conversationId,
          },
        });
      } catch (err) {
        console.error("[instagram/inbound] automation dispatch failed:", err);
      }
    }

    if (!consumedByFlow && textForEngines) {
      try {
        await dispatchInboundToAiReply({
          accountId,
          projectId,
          conversationId,
          contactId,
          configOwnerUserId,
        });
      } catch (err) {
        console.error("[instagram/inbound] AI reply dispatch failed:", err);
      }
    }

    try {
      await dispatchWebhookEvent(db, accountId, projectId, "message.received", {
        project_id: projectId,
        conversation_id: conversationId,
        contact_id: contactId,
        text: textForEngines,
        channel: "instagram",
      });
    } catch (err) {
      console.error("[instagram/inbound] webhook dispatch failed:", err);
    }
  }

  return {
    contactId,
    conversationId,
    messageId: insertedMsg.id as string,
    ingested: true,
  };
}

