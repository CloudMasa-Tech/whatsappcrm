/**
 * POST /api/email/inbound
 *
 * Automated Inbound Reply Webhook.
 * Mail providers (Gmail Auto-Forwarding, Mailgun, SendGrid Inbound Parse,
 * Postmark, Cloudflare Email Routing, Zapier, etc.) forward incoming replies here.
 *
 * When an email arrives:
 *   1. It is authenticated via secret token or Mailgun signature.
 *   2. The sender is matched to a campaign recipient (or existing CRM contact).
 *   3. If matched to a campaign recipient:
 *      - Recipient status is updated to 'replied' (Lead).
 *      - Campaign replied_count is incremented (Leads count on campaign card).
 *      - An engagement audit event is logged.
 *   4. A contact is ensured in MasaCRM (channel: 'email').
 *   5. A conversation thread is ensured and the reply is placed in the
 *      CRM Unified Inbox (/inbox) with incremented unread count.
 *   6. The 'email_replied' automation trigger is fired for workflows.
 */

import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  appendEmailMessage,
  ensureContactForEmail,
  ensureEmailConversation,
  fireEmailTrigger,
  logEmailEvent,
} from '@/lib/email/lead-flow';

const MAX_BODY_CHARS = 50_000;
const MAILGUN_MAX_SKEW_SECONDS = 300;
export const DEFAULT_INBOUND_SECRET = 'masacrm_inbound_sec_4d8e9f2a7b1c3e5a';

function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function verifyMailgunSignature(fields: Record<string, string>): boolean {
  const key = process.env.MAILGUN_SIGNING_KEY;
  if (!key) return false;

  const { timestamp, token, signature } = fields;
  if (!timestamp || !token || !signature) return false;

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > MAILGUN_MAX_SKEW_SECONDS) return false;

  const expected = crypto
    .createHmac('sha256', key)
    .update(timestamp + token)
    .digest('hex');

  return timingSafeEqual(expected, signature);
}

function isAuthorized(request: Request, fields: Record<string, string>): boolean {
  const secret = process.env.EMAIL_INBOUND_SECRET || DEFAULT_INBOUND_SECRET;

  if (secret) {
    const presented =
      new URL(request.url).searchParams.get('secret') ??
      request.headers.get('x-inbound-secret') ??
      fields.secret ??
      '';
    if (presented && timingSafeEqual(presented, secret)) return true;
  }

  if (verifyMailgunSignature(fields)) return true;

  return false;
}

/** Pull the bare address out of `Display Name <a@b.com>`. */
function parseAddress(raw: string): string {
  const match = raw.match(/<([^>]+)>/);
  const address = (match ? match[1] : raw).trim().toLowerCase();
  return address;
}

function parseDisplayName(raw: string): string | null {
  const match = raw.match(/^\s*"?([^"<]+?)"?\s*</);
  return match ? match[1].trim() || null : null;
}

/**
 * Strip the quoted history from a reply so the inbox preview shows what
 * the person actually wrote, not the entire thread.
 */
function stripQuotedReply(text: string): string {
  if (!text) return '';
  const markers = [
    /^\s*On .+ wrote:\s*$/m,
    /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/im,
    /^\s*_{5,}\s*$/m,
    /^\s*From:\s.+$/m,
  ];

  let cut = text.length;
  for (const marker of markers) {
    const found = text.match(marker);
    if (found?.index !== undefined && found.index < cut) cut = found.index;
  }

  const body = text.slice(0, cut);
  return body
    .split('\n')
    .filter((line) => !/^\s*>/.test(line))
    .join('\n')
    .trim();
}

/**
 * Normalise provider payloads (JSON or FormData) into a unified shape.
 */
async function readPayload(request: Request): Promise<{
  fields: Record<string, string>;
  from: string;
  to: string;
  subject: string;
  text: string;
  messageId: string | null;
  inReplyTo: string | null;
}> {
  const contentType = request.headers.get('content-type') ?? '';
  const fields: Record<string, string> = {};

  if (contentType.includes('application/json')) {
    const json = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    for (const [k, v] of Object.entries(json)) {
      if (typeof v === 'string') fields[k] = v;
    }

    const headers = Array.isArray((json as { Headers?: unknown }).Headers)
      ? ((json as { Headers: { Name: string; Value: string }[] }).Headers ?? [])
      : [];
    const header = (name: string) =>
      headers.find((h) => h.Name?.toLowerCase() === name)?.Value ?? null;

    const fromVal = String(
      json.From ??
        json.from ??
        json.fromEmail ??
        json.sender ??
        json.senderEmail ??
        json.replyTo ??
        json['reply-to'] ??
        '',
    );
    const toVal = String(json.To ?? json.to ?? json.toEmail ?? json.recipient ?? '');
    const subjectVal = String(json.Subject ?? json.subject ?? '');
    const textVal = String(
      json.TextBody ??
        json.text ??
        json.body ??
        json.message ??
        json.content ??
        json['body-plain'] ??
        json['stripped-text'] ??
        '',
    );
    const messageId =
      String(json.MessageID ?? json['Message-Id'] ?? json.messageId ?? '') || header('message-id');
    const inReplyTo =
      String(json.InReplyTo ?? json['In-Reply-To'] ?? json.inReplyTo ?? '') || header('in-reply-to');

    return {
      fields,
      from: fromVal,
      to: toVal,
      subject: subjectVal,
      text: textVal,
      messageId: messageId || null,
      inReplyTo: inReplyTo || null,
    };
  }

  const form = await request.formData();
  for (const [k, v] of form.entries()) {
    if (typeof v === 'string') fields[k] = v;
  }

  return {
    fields,
    from: fields.from ?? fields.sender ?? fields.From ?? fields.fromEmail ?? '',
    to: fields.recipient ?? fields.to ?? fields.To ?? fields.toEmail ?? '',
    subject: fields.subject ?? fields.Subject ?? '',
    text: fields['body-plain'] ?? fields['stripped-text'] ?? fields.text ?? fields.body ?? '',
    messageId: fields['Message-Id'] ?? fields['message-id'] ?? null,
    inReplyTo: fields['In-Reply-To'] ?? fields['in-reply-to'] ?? null,
  };
}

/**
 * GET /api/email/inbound
 * Status & verification endpoint for testing and webhook health checks.
 */
export async function GET(request: Request) {
  const secret = process.env.EMAIL_INBOUND_SECRET || DEFAULT_INBOUND_SECRET;
  const presented =
    new URL(request.url).searchParams.get('secret') ??
    request.headers.get('x-inbound-secret') ??
    '';

  const valid = Boolean(presented && timingSafeEqual(presented, secret));
  return NextResponse.json({
    status: 'active',
    endpoint: '/api/email/inbound',
    authenticated: valid,
    secretConfigured: Boolean(process.env.EMAIL_INBOUND_SECRET),
    message: valid
      ? 'Inbound email webhook is authenticated and ready to capture replies as Leads.'
      : 'Inbound email webhook is online. Add ?secret=... parameter to authenticate.',
  });
}

/**
 * POST /api/email/inbound
 * Processes an incoming email reply and records it as a Lead.
 */
export async function POST(request: Request) {
  let payload;
  try {
    payload = await readPayload(request);
  } catch (err) {
    console.error('[email/inbound] unparseable payload:', err);
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  if (!isAuthorized(request, payload.fields)) {
    return NextResponse.json({ error: 'Unauthorized: Invalid inbound webhook secret' }, { status: 401 });
  }

  const fromEmail = parseAddress(payload.from);
  if (!fromEmail || !fromEmail.includes('@')) {
    return NextResponse.json({ error: 'Missing or invalid sender email' }, { status: 400 });
  }

  const bodyText = stripQuotedReply(payload.text).slice(0, MAX_BODY_CHARS) || '(empty email body)';
  const subjectText = payload.subject?.trim() || 'Inbound Email Reply';
  const db = supabaseAdmin();

  // 1. Match the recipient to the most recent email campaign
  const { data: recipient } = await db
    .from('email_campaign_recipients')
    .select(
      'id, campaign_id, contact_id, email, name, campaign:email_campaigns(id, account_id, project_id, user_id, replied_count, subject, name)',
    )
    .ilike('email', fromEmail)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const campaign = recipient
    ? Array.isArray(recipient.campaign)
      ? recipient.campaign[0]
      : recipient.campaign
    : null;

  let accountId: string | null = (campaign?.account_id as string) ?? null;
  let projectId: string | null = (campaign?.project_id as string | null) ?? null;
  let ownerUserId: string | null = (campaign?.user_id as string) ?? null;
  let contactId: string | null = (recipient?.contact_id as string | null) ?? null;

  // 2. If no campaign recipient found, check for an existing contact
  if (!accountId) {
    const { data: contact } = await db
      .from('contacts')
      .select('id, account_id, project_id, user_id, name')
      .ilike('email', fromEmail)
      .limit(1)
      .maybeSingle();

    if (contact) {
      accountId = contact.account_id;
      projectId = contact.project_id ?? null;
      ownerUserId = contact.user_id;
      contactId = contact.id;
    }
  }

  // 3. Fallback to primary account so no incoming reply is lost
  if (!accountId) {
    const { data: primaryAccount } = await db
      .from('accounts')
      .select('id, owner_id')
      .limit(1)
      .maybeSingle();

    if (primaryAccount) {
      accountId = primaryAccount.id;
      ownerUserId = primaryAccount.owner_id;
    }
  }

  if (!accountId || !ownerUserId) {
    console.warn('[email/inbound] could not attribute email to any tenant account:', fromEmail);
    return NextResponse.json({ ok: true, matched: false, reason: 'No tenant account found' });
  }

  // 4. Ensure Contact exists in CRM
  const contact = await ensureContactForEmail({
    accountId,
    projectId,
    ownerUserId,
    email: fromEmail,
    name: parseDisplayName(payload.from) || recipient?.name || fromEmail.split('@')[0],
    contactId,
  });

  if (!contact) {
    return NextResponse.json({ error: 'Contact resolution failed' }, { status: 500 });
  }

  // 5. Ensure Conversation exists in Unified Inbox (/inbox)
  const conversationId = await ensureEmailConversation({
    accountId,
    projectId,
    ownerUserId,
    contactId: contact.contactId,
    subject: subjectText,
  });

  if (!conversationId) {
    return NextResponse.json({ error: 'Conversation creation failed' }, { status: 500 });
  }

  // 6. Append incoming customer message
  await appendEmailMessage({
    conversationId,
    projectId,
    senderType: 'customer',
    subject: subjectText,
    bodyText,
    emailMessageId: payload.messageId,
    inReplyTo: payload.inReplyTo,
    incrementUnread: true,
  });

  // 7. If this reply corresponds to a campaign recipient, convert to Lead!
  let leadRecorded = false;
  if (recipient?.id && campaign?.id) {
    leadRecorded = true;
    const { error: rpcErr } = await db.rpc('record_email_reply', {
      p_recipient_id: recipient.id,
      p_conversation_id: conversationId,
    });

    if (rpcErr) {
      // Fallback update if RPC is missing
      await db
        .from('email_campaign_recipients')
        .update({
          replied_at: new Date().toISOString(),
          conversation_id: conversationId,
          status: 'replied',
        })
        .eq('id', recipient.id);

      await db
        .from('email_campaigns')
        .update({
          replied_count: ((campaign as { replied_count?: number }).replied_count || 0) + 1,
        })
        .eq('id', campaign.id);
    }

    await logEmailEvent({
      accountId,
      projectId,
      campaignId: campaign.id as string,
      recipientId: recipient.id,
      contactId: contact.contactId,
      eventType: 'reply',
      metadata: { subject: subjectText, source: 'inbound_webhook' },
    });
  }

  // 8. Fire automation trigger for workflows
  await fireEmailTrigger({
    accountId,
    projectId,
    contactId: contact.contactId,
    triggerType: 'email_replied',
    conversationId,
    messageText: bodyText,
  });

  return NextResponse.json({
    ok: true,
    matched: true,
    leadRecorded,
    campaignId: campaign?.id ?? null,
    campaignName: campaign?.name ?? null,
    recipientId: recipient?.id ?? null,
    contactId: contact.contactId,
    conversationId,
    from: fromEmail,
    message: leadRecorded
      ? `Inbound reply recorded as Lead for ${fromEmail}! Placed in Unified Inbox.`
      : `Inbound reply from ${fromEmail} placed in Unified Inbox.`,
  });
}
