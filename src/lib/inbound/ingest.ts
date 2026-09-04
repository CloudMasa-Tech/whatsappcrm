// ============================================================
// Channel-independent inbound ingest.
//
// A message arriving from a QR session and one arriving from Meta's
// webhook must produce the same result: the same contact dedup, the
// same conversation, the same unread bookkeeping, and the same
// downstream fan-out to automations / flows / AI auto-reply /
// outbound webhooks.
//
// This module owns that shared path for the QR channel. The Meta
// webhook keeps its own copy for now — it carries a lot of
// Cloud-API-only work (delivery statuses, template lifecycle events,
// Meta media download with token refresh) that has no analogue here,
// and rewriting it in the same pass as introducing a second channel
// would put the riskiest refactor and the newest feature in one
// change. The dispatch calls at the bottom are deliberately identical
// to the webhook's so the two cannot drift in behaviour.
//
// Everything here runs with the SERVICE ROLE — RLS is bypassed. So
// every single query names its project_id explicitly. That is the
// only thing standing between two tenants at this layer.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { findExistingContact, isUniqueViolation } from "@/lib/contacts/dedupe";
import { normalizePhone } from "@/lib/whatsapp/phone-utils";
import { runAutomationsForTrigger } from "@/lib/automations/engine";
import { dispatchInboundToFlows } from "@/lib/flows/engine";
import { dispatchInboundToAiReply } from "@/lib/ai/auto-reply";
import { getNextRoundRobinAgentId } from "@/lib/inbox/round-robin";
import { dispatchWebhookEvent } from "@/lib/webhooks/deliver";
import type { InboundMessage } from "@/lib/channels/types";

export interface IngestResult {
  contactId: string;
  conversationId: string;
  messageId: string;
  /** False when the message was a duplicate and nothing was written. */
  ingested: boolean;
}

/** Map a transport's message kind onto the `messages.content_type` enum. */
function toContentType(kind: string): string {
  switch (kind) {
    case "image":
    case "video":
    case "audio":
    case "document":
    case "location":
      return kind;
    case "sticker":
      return "image";
    default:
      return "text";
  }
}

/** Preview line for the conversation list. */
function previewText(message: InboundMessage): string {
  if (message.text) return message.text;
  if (message.media?.caption) return message.media.caption;
  return `[${message.kind}]`;
}

/**
 * Ingest one inbound message.
 *
 * `accountId` is read from the project rather than taken from the
 * caller — the gateway names a project, and the project decides which
 * organisation it belongs to. Accepting both from the wire would let a
 * compromised gateway write into any account.
 */
export async function ingestInboundMessage(
  db: SupabaseClient,
  message: InboundMessage,
): Promise<IngestResult | null> {
  const { projectId } = message;

  const { data: project, error: projectError } = await db
    .from("projects")
    .select("id, account_id, archived_at")
    .eq("id", projectId)
    .maybeSingle();

  if (projectError || !project) {
    console.error("[ingest] unknown project:", projectId, projectError);
    return null;
  }
  if (project.archived_at) {
    // An archived project should not accumulate new conversations. The
    // session ought to be disconnected too; log it so the mismatch is
    // visible rather than silently swallowing customer messages.
    console.warn("[ingest] dropping inbound for archived project:", projectId);
    return null;
  }
  const accountId = project.account_id as string;

  const phone = normalizePhone(message.from) ? message.from : null;
  if (!phone) {
    console.warn("[ingest] unusable sender phone:", message.from);
    return null;
  }

  // ---- idempotency ------------------------------------------------
  // Transports redeliver. The gateway retries a failed CRM push, and
  // WhatsApp itself can repeat a message after a reconnect. Keyed on
  // (project, transport id) so a retry is a no-op rather than a
  // duplicate row in the customer's thread.
  if (message.externalId) {
    const { data: existing } = await db
      .from("messages")
      .select("id, conversation_id")
      .eq("project_id", projectId)
      .eq("message_id", message.externalId)
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

  // ---- contact ----------------------------------------------------
  const contact = await resolveContact(db, {
    accountId,
    projectId,
    phone,
    name: message.senderName ?? null,
  });
  if (!contact) return null;

  // ---- conversation -----------------------------------------------
  const conversation = await resolveConversation(db, {
    accountId,
    projectId,
    contactId: contact.id,
    ownerUserId: contact.userId,
  });
  if (!conversation) return null;

  const fromMe = Boolean(message.fromMe);
  const isHistory = Boolean(message.isHistory);

  // ---- message ----------------------------------------------------
  const { data: inserted, error: insertError } = await db
    .from("messages")
    .insert({
      conversation_id: conversation.id,
      project_id: projectId,
      sender_type: fromMe ? "agent" : "customer",
      content_type: toContentType(message.kind),
      content_text: message.text ?? message.media?.caption ?? null,
      media_url: message.media?.url ?? null,
      message_id: message.externalId || null,
      status: "delivered",
      created_at: message.timestamp,
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    // A unique violation here means a concurrent delivery of the same
    // message won the race — that is success, not failure.
    if (isUniqueViolation(insertError)) {
      return {
        contactId: contact.id,
        conversationId: conversation.id,
        messageId: "",
        ingested: false,
      };
    }
    console.error("[ingest] message insert failed:", insertError);
    return null;
  }

  // Only update conversation preview if this message is newer than or matches existing
  const isNewer =
    !conversation.lastMessageAt ||
    new Date(message.timestamp) >= new Date(conversation.lastMessageAt);

  if (isNewer) {
    await db
      .from("conversations")
      .update({
        last_message_text: previewText(message),
        last_message_at: message.timestamp,
        unread_count:
          fromMe || isHistory
            ? conversation.unreadCount ?? 0
            : (conversation.unreadCount ?? 0) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", conversation.id)
      .eq("project_id", projectId);
  }

  // ---- downstream fan-out ------------------------------------------
  // Fire-and-forget, exactly as the Meta webhook does: a slow
  // automation must not delay acknowledging the message to the
  // gateway, or it will retry and we will process it twice.
  // Only trigger automations and AI reply for real live incoming customer messages.
  if (!fromMe && !isHistory) {
    void dispatchDownstream({
      db,
      accountId,
      projectId,
      contactId: contact.id,
      conversationId: conversation.id,
      message,
      isFirstInbound: conversation.created,
      ownerUserId: contact.userId,
    });
  }

  return {
    contactId: contact.id,
    conversationId: conversation.id,
    messageId: inserted.id as string,
    ingested: true,
  };
}

// ------------------------------------------------------------
// Contact
// ------------------------------------------------------------

interface ResolveContactArgs {
  accountId: string;
  projectId: string;
  phone: string;
  name: string | null;
}

async function resolveContact(
  db: SupabaseClient,
  args: ResolveContactArgs,
): Promise<{ id: string; userId: string } | null> {
  const { accountId, projectId, phone, name } = args;

  // Project-scoped: the same number in a sibling project is a
  // different customer relationship and must not be reused here.
  const existing = await findExistingContact(db, accountId, phone, projectId);
  if (existing) {
    if (
      name &&
      name.trim() &&
      name !== phone &&
      (!existing.name || existing.name === phone || existing.name.startsWith("+"))
    ) {
      await db
        .from("contacts")
        .update({ name: name.trim(), updated_at: new Date().toISOString() })
        .eq("id", existing.id);
    }
    return {
      id: existing.id,
      userId: (existing.user_id as string) ?? (await accountOwner(db, accountId)),
    };
  }

  const ownerUserId = await accountOwner(db, accountId);
  if (!ownerUserId) {
    console.error("[ingest] no owner to attribute the new contact to:", accountId);
    return null;
  }

  const { data: created, error } = await db
    .from("contacts")
    .insert({
      account_id: accountId,
      project_id: projectId,
      user_id: ownerUserId,
      phone,
      name: name || phone,
    })
    .select("id, user_id")
    .single();

  if (error) {
    // Lost a race with a concurrent inbound for the same number —
    // re-read rather than failing the message.
    if (isUniqueViolation(error)) {
      const raced = await findExistingContact(db, accountId, phone, projectId);
      if (raced) {
        return { id: raced.id, userId: (raced.user_id as string) ?? ownerUserId };
      }
    }
    console.error("[ingest] contact insert failed:", error);
    return null;
  }

  return { id: created.id as string, userId: created.user_id as string };
}

/**
 * Rows need a NOT NULL `user_id` for audit, and there is no logged-in
 * human on an inbound message. Attribute to the account owner, the
 * same stable default the webhook and public API use.
 */
async function accountOwner(
  db: SupabaseClient,
  accountId: string,
): Promise<string> {
  const { data } = await db
    .from("accounts")
    .select("owner_user_id")
    .eq("id", accountId)
    .maybeSingle();
  return (data?.owner_user_id as string) ?? "";
}

// ------------------------------------------------------------
// Conversation
// ------------------------------------------------------------

interface ResolveConversationArgs {
  accountId: string;
  projectId: string;
  contactId: string;
  ownerUserId: string;
}

async function resolveConversation(
  db: SupabaseClient,
  args: ResolveConversationArgs,
): Promise<{ id: string; unreadCount: number; lastMessageAt: string | null; created: boolean } | null> {
  const { accountId, projectId, contactId, ownerUserId } = args;

  const { data: existing } = await db
    .from("conversations")
    .select("id, unread_count, last_message_at")
    .eq("project_id", projectId)
    .eq("contact_id", contactId)
    .maybeSingle();

  if (existing) {
    return {
      id: existing.id as string,
      unreadCount: (existing.unread_count as number) ?? 0,
      lastMessageAt: (existing.last_message_at as string) ?? null,
      created: false,
    };
  }

  const roundRobinAgentId = await getNextRoundRobinAgentId(db, projectId, accountId);

  const { data: created, error } = await db
    .from("conversations")
    .insert({
      account_id: accountId,
      project_id: projectId,
      contact_id: contactId,
      user_id: ownerUserId,
      status: "open",
      assigned_agent_id: roundRobinAgentId,
    })
    .select("id, unread_count, last_message_at")
    .single();

  if (error) {
    // idx_conversations_project_contact caught a concurrent create.
    if (isUniqueViolation(error)) {
      const { data: raced } = await db
        .from("conversations")
        .select("id, unread_count, last_message_at")
        .eq("project_id", projectId)
        .eq("contact_id", contactId)
        .maybeSingle();
      if (raced) {
        return {
          id: raced.id as string,
          unreadCount: (raced.unread_count as number) ?? 0,
          lastMessageAt: (raced.last_message_at as string) ?? null,
          created: false,
        };
      }
    }
    console.error("[ingest] conversation insert failed:", error);
    return null;
  }

  return { id: created.id as string, unreadCount: 0, lastMessageAt: null, created: true };
}

// ------------------------------------------------------------
// Downstream engines
// ------------------------------------------------------------

interface DispatchArgs {
  db: SupabaseClient;
  accountId: string;
  projectId: string;
  contactId: string;
  conversationId: string;
  message: InboundMessage;
  isFirstInbound: boolean;
  ownerUserId: string;
}

async function dispatchDownstream(args: DispatchArgs): Promise<void> {
  const {
    db,
    accountId,
    projectId,
    contactId,
    conversationId,
    message,
    isFirstInbound,
    ownerUserId,
  } = args;

  const text = message.text ?? message.media?.caption ?? "";

  // Flows first, and their verdict gates the AI: a flow that consumed
  // the message is an explicit, user-authored answer, and the LLM must
  // not talk over it. Same ordering as the Meta webhook.
  let consumedByFlow = false;
  try {
    const result = await dispatchInboundToFlows({
      accountId,
      projectId,
      userId: ownerUserId,
      contactId,
      conversationId,
      isFirstInboundMessage: isFirstInbound,
      message: {
        kind: "text",
        text,
        // Named for Meta's wamid, but it is just "the transport's id
        // for this message" — the flows engine only uses it for
        // idempotency, so a Baileys key id serves identically.
        meta_message_id: message.externalId,
      },
    });
    consumedByFlow = Boolean(result?.consumed);
  } catch (err) {
    console.error("[ingest] flow dispatch failed:", err);
  }

  // Same trigger set and ordering the webhook uses, so an automation
  // behaves identically whichever channel the message arrived on.
  const triggers: Array<"first_inbound_message" | "new_message_received"> =
    isFirstInbound
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
          message_text: text,
          conversation_id: conversationId,
        },
      });
    } catch (err) {
      console.error("[ingest] automation dispatch failed:", err);
    }
  }

  // Text only, and only when no flow answered — matching the webhook's
  // eligibility rules. An LLM reply to a bare image would have nothing
  // to work from.
  if (!consumedByFlow && text.trim()) {
    try {
      await dispatchInboundToAiReply({
        accountId,
        projectId,
        conversationId,
        contactId,
        configOwnerUserId: ownerUserId,
      });
    } catch (err) {
      console.error("[ingest] AI reply dispatch failed:", err);
    }
  }

  try {
    await dispatchWebhookEvent(db, accountId, projectId, "message.received", {
      project_id: projectId,
      conversation_id: conversationId,
      contact_id: contactId,
      text,
      channel: "qr",
    });
  } catch (err) {
    console.error("[ingest] webhook dispatch failed:", err);
  }
}
