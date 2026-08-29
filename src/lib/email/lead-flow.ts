/**
 * Email → lead flow.
 *
 * Makes email engagement behave like an inbound WhatsApp message: the
 * person becomes a contact, their thread becomes a `conversations` row
 * with channel='email' that shows up in the shared inbox, and the event
 * fires automations so pipelines/tags/deals can react.
 *
 * Everything here runs through the service-role client (RLS bypassed),
 * so every function scopes writes by the account/project it was handed.
 * Nothing is caller-supplied except ids already validated upstream.
 */

import { supabaseAdmin } from '@/lib/supabase/admin';
import { runAutomationsForTrigger } from '@/lib/automations/engine';
import type { AutomationTriggerType } from '@/types';

export type EmailEventType =
  | 'sent'
  | 'open'
  | 'click'
  | 'reply'
  | 'bounce'
  | 'complaint';

export interface EmailLeadTarget {
  accountId: string;
  projectId: string | null;
  /** Owning user — `contacts.user_id` and `conversations.user_id` are
   *  NOT NULL. Use the campaign's creator. */
  ownerUserId: string;
  email: string;
  name?: string | null;
  contactId?: string | null;
}

/**
 * Find or create the contact behind an email address.
 *
 * Matching is case-insensitive on email within the project.
 *
 * `contacts.phone` is NOT NULL in this WhatsApp-first schema, so an
 * email-only lead gets a synthetic `email:<address>` value — the same
 * trick the Instagram channel uses with `ig:<igsid>`. The project-level
 * phone dedup index is partial (`WHERE phone_normalized <> ''`), and
 * `phone_normalized` is left null here, so these rows sit outside it
 * and cannot collide with each other.
 */
export async function ensureContactForEmail(
  target: EmailLeadTarget,
): Promise<{ contactId: string; created: boolean } | null> {
  const db = supabaseAdmin();
  const email = target.email.trim().toLowerCase();

  if (target.contactId) {
    return { contactId: target.contactId, created: false };
  }

  let query = db
    .from('contacts')
    .select('id')
    .ilike('email', email)
    .eq('account_id', target.accountId)
    .limit(1);

  // A project-scoped lead must not match a contact from a sibling
  // project — post-042 the project is the isolation boundary.
  if (target.projectId) query = query.eq('project_id', target.projectId);

  const { data: existing, error: findErr } = await query.maybeSingle();

  if (findErr) {
    console.error('[email/lead-flow] contact lookup failed:', findErr);
    return null;
  }
  if (existing?.id) return { contactId: existing.id, created: false };

  const { data: created, error: createErr } = await db
    .from('contacts')
    .insert({
      account_id: target.accountId,
      project_id: target.projectId,
      user_id: target.ownerUserId,
      email,
      phone: `email:${email}`,
      name: target.name?.trim() || email.split('@')[0],
      channel: 'email',
    })
    .select('id')
    .single();

  if (createErr || !created) {
    console.error('[email/lead-flow] contact insert failed:', createErr);
    return null;
  }

  return { contactId: created.id, created: true };
}

/**
 * Find or create the email conversation for a contact.
 *
 * One conversation per (contact, project, channel='email') — the same
 * shape the WhatsApp inbox uses, so an ongoing email thread stays a
 * single row rather than one per campaign.
 */
export async function ensureEmailConversation(params: {
  accountId: string;
  projectId: string | null;
  /** `conversations.user_id` is NOT NULL. */
  ownerUserId: string;
  contactId: string;
  subject?: string | null;
}): Promise<string | null> {
  const db = supabaseAdmin();

  let query = db
    .from('conversations')
    .select('id')
    .eq('contact_id', params.contactId)
    .eq('channel', 'email')
    .limit(1);

  if (params.projectId) query = query.eq('project_id', params.projectId);

  const { data: existing, error: findErr } = await query.maybeSingle();

  if (findErr) {
    console.error('[email/lead-flow] conversation lookup failed:', findErr);
    return null;
  }
  if (existing?.id) return existing.id;

  const { data: created, error: createErr } = await db
    .from('conversations')
    .insert({
      account_id: params.accountId,
      project_id: params.projectId,
      user_id: params.ownerUserId,
      contact_id: params.contactId,
      channel: 'email',
      status: 'open',
      last_message_text: params.subject ?? null,
      last_message_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (createErr || !created) {
    console.error('[email/lead-flow] conversation insert failed:', createErr);
    return null;
  }

  return created.id;
}

/**
 * Append a message to an email conversation and refresh the
 * conversation preview, mirroring the WhatsApp inbound path.
 *
 * `senderType` is 'customer' for a reply and 'agent' for an outbound
 * campaign send, so threads read correctly in the inbox.
 */
export async function appendEmailMessage(params: {
  conversationId: string;
  projectId: string | null;
  senderType: 'customer' | 'agent';
  subject?: string | null;
  bodyText: string;
  emailMessageId?: string | null;
  inReplyTo?: string | null;
  incrementUnread: boolean;
}): Promise<string | null> {
  const db = supabaseAdmin();

  const { data: message, error: msgErr } = await db
    .from('messages')
    .insert({
      conversation_id: params.conversationId,
      project_id: params.projectId,
      channel: 'email',
      sender_type: params.senderType,
      content_type: 'text',
      content_text: params.bodyText,
      status: params.senderType === 'agent' ? 'sent' : 'delivered',
      email_subject: params.subject ?? null,
      email_message_id: params.emailMessageId ?? null,
      email_in_reply_to: params.inReplyTo ?? null,
    })
    .select('id')
    .single();

  if (msgErr || !message) {
    console.error('[email/lead-flow] message insert failed:', msgErr);
    return null;
  }

  // Preview text for the inbox list. Kept short — the column feeds a
  // single-line row, and full bodies are read from `messages`.
  const preview = params.bodyText.replace(/\s+/g, ' ').trim().slice(0, 200);

  const update: Record<string, unknown> = {
    last_message_text: preview || (params.subject ?? ''),
    last_message_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  if (params.incrementUnread) {
    // Read-modify-write is acceptable here: inbound email arrives far
    // slower than the WhatsApp path, and an occasional lost increment
    // only affects a badge count.
    const { data: convo } = await db
      .from('conversations')
      .select('unread_count')
      .eq('id', params.conversationId)
      .maybeSingle();
    update.unread_count = (convo?.unread_count ?? 0) + 1;
    update.status = 'open';
  }

  const { error: convoErr } = await db
    .from('conversations')
    .update(update)
    .eq('id', params.conversationId);

  if (convoErr) {
    console.error('[email/lead-flow] conversation update failed:', convoErr);
  }

  return message.id;
}

/** Write one row to the append-only engagement log. Never throws. */
export async function logEmailEvent(params: {
  accountId: string;
  projectId?: string | null;
  campaignId?: string | null;
  recipientId?: string | null;
  contactId?: string | null;
  eventType: EmailEventType;
  url?: string | null;
  userAgent?: string | null;
  ipAddress?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    const { error } = await supabaseAdmin()
      .from('email_events')
      .insert({
        account_id: params.accountId,
        project_id: params.projectId ?? null,
        campaign_id: params.campaignId ?? null,
        recipient_id: params.recipientId ?? null,
        contact_id: params.contactId ?? null,
        event_type: params.eventType,
        url: params.url ?? null,
        user_agent: params.userAgent ?? null,
        ip_address: params.ipAddress ?? null,
        metadata: params.metadata ?? {},
      });
    if (error) console.error('[email/lead-flow] event log failed:', error);
  } catch (err) {
    console.error('[email/lead-flow] event log threw:', err);
  }
}

/**
 * Fire an email automation trigger.
 *
 * Fire-and-forget by contract: `runAutomationsForTrigger` never throws,
 * and tracking endpoints must return their pixel/redirect regardless of
 * automation outcome. Requires a projectId — automations are dispatched
 * per project post-042.
 */
export async function fireEmailTrigger(params: {
  accountId: string;
  projectId: string | null;
  contactId: string | null;
  triggerType: Extract<
    AutomationTriggerType,
    'email_opened' | 'email_clicked' | 'email_replied'
  >;
  conversationId?: string | null;
  messageText?: string | null;
}): Promise<void> {
  if (!params.projectId) return;

  await runAutomationsForTrigger({
    accountId: params.accountId,
    projectId: params.projectId,
    triggerType: params.triggerType,
    contactId: params.contactId,
    context: {
      conversation_id: params.conversationId ?? undefined,
      message_text: params.messageText ?? undefined,
    },
  });
}
