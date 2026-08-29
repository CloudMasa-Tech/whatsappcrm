/**
 * POST /api/email/inbound
 *
 * Inbound reply webhook. Providers (Mailgun / SendGrid Inbound Parse /
 * Postmark) POST a parsed reply here; the reply becomes a message on an
 * `email` channel conversation in the shared inbox and fires the
 * `email_replied` automation trigger.
 *
 * AUTHENTICATION — this endpoint is public, so it must prove the caller
 * is the provider. Two independent mechanisms, either sufficient:
 *
 *   1. `EMAIL_INBOUND_SECRET` presented as `?secret=` or the
 *      `x-inbound-secret` header, compared in constant time.
 *   2. Mailgun HMAC (`timestamp`/`token`/`signature`) verified against
 *      `MAILGUN_SIGNING_KEY`, with a 5-minute freshness window so a
 *      captured payload cannot be replayed indefinitely.
 *
 * If neither secret is configured the route refuses every request
 * rather than running open — failing closed is the only safe default
 * for an endpoint that writes into the inbox.
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
  const secret = process.env.EMAIL_INBOUND_SECRET;

  if (secret) {
    const presented =
      new URL(request.url).searchParams.get('secret') ??
      request.headers.get('x-inbound-secret') ??
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
 * the person actually wrote, not the entire thread. Best-effort: covers
 * the common client markers, leaves anything unrecognised intact.
 */
function stripQuotedReply(text: string): string {
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
  // Drop trailing '>' quoted lines the markers missed.
  return body
    .split('\n')
    .filter((line) => !/^\s*>/.test(line))
    .join('\n')
    .trim();
}

/**
 * Normalise the three providers' payloads into one shape. Mailgun and
 * SendGrid post multipart/form-data; Postmark posts JSON.
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
    const json = (await request.json()) as Record<string, unknown>;
    for (const [k, v] of Object.entries(json)) {
      if (typeof v === 'string') fields[k] = v;
    }

    // Postmark casing, with Mailgun/SendGrid JSON fallbacks.
    const headers = Array.isArray((json as { Headers?: unknown }).Headers)
      ? ((json as { Headers: { Name: string; Value: string }[] }).Headers ?? [])
      : [];
    const header = (name: string) =>
      headers.find((h) => h.Name?.toLowerCase() === name)?.Value ?? null;

    return {
      fields,
      from: String(json.From ?? json.from ?? json.sender ?? ''),
      to: String(json.To ?? json.to ?? json.recipient ?? ''),
      subject: String(json.Subject ?? json.subject ?? ''),
      text: String(json.TextBody ?? json.text ?? json['body-plain'] ?? ''),
      messageId: String(json.MessageID ?? json['Message-Id'] ?? '') || header('message-id'),
      inReplyTo: String(json.InReplyTo ?? '') || header('in-reply-to'),
    };
  }

  const form = await request.formData();
  for (const [k, v] of form.entries()) {
    if (typeof v === 'string') fields[k] = v;
  }

  return {
    fields,
    from: fields.from ?? fields.sender ?? fields.From ?? '',
    to: fields.recipient ?? fields.to ?? fields.To ?? '',
    subject: fields.subject ?? fields.Subject ?? '',
    text: fields['body-plain'] ?? fields['stripped-text'] ?? fields.text ?? '',
    messageId: fields['Message-Id'] ?? fields['message-id'] ?? null,
    inReplyTo: fields['In-Reply-To'] ?? fields['in-reply-to'] ?? null,
  };
}

export async function POST(request: Request) {
  let payload;
  try {
    payload = await readPayload(request);
  } catch (err) {
    console.error('[email/inbound] unparseable payload:', err);
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  if (!isAuthorized(request, payload.fields)) {
    // Deliberately terse — never reveal which check failed.
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const fromEmail = parseAddress(payload.from);
  if (!fromEmail || !fromEmail.includes('@')) {
    return NextResponse.json({ error: 'Missing sender' }, { status: 400 });
  }

  const bodyText = stripQuotedReply(payload.text).slice(0, MAX_BODY_CHARS);
  const db = supabaseAdmin();

  // Attribute the reply to the most recent campaign that mailed this
  // address. That yields the account/project tenancy, and lets the
  // campaign's reply counter move.
  const { data: recipient } = await db
    .from('email_campaign_recipients')
    .select(
      'id, campaign_id, contact_id, campaign:email_campaigns(id, account_id, project_id, user_id)',
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

  if (!campaign?.account_id) {
    // A reply from someone we never mailed. Accept it so the provider
    // does not retry, but there is no tenant to file it under.
    console.warn('[email/inbound] no matching campaign recipient for', fromEmail);
    return NextResponse.json({ ok: true, matched: false });
  }

  const accountId = campaign.account_id as string;
  const projectId = (campaign.project_id as string | null) ?? null;
  const ownerUserId = campaign.user_id as string;

  const contact = await ensureContactForEmail({
    accountId,
    projectId,
    ownerUserId,
    email: fromEmail,
    name: parseDisplayName(payload.from),
    contactId: recipient?.contact_id ?? null,
  });

  if (!contact) {
    return NextResponse.json({ error: 'Contact resolution failed' }, { status: 500 });
  }

  const conversationId = await ensureEmailConversation({
    accountId,
    projectId,
    ownerUserId,
    contactId: contact.contactId,
    subject: payload.subject,
  });

  if (!conversationId) {
    return NextResponse.json({ error: 'Conversation creation failed' }, { status: 500 });
  }

  await appendEmailMessage({
    conversationId,
    projectId,
    senderType: 'customer',
    subject: payload.subject,
    bodyText: bodyText || '(empty reply)',
    emailMessageId: payload.messageId,
    inReplyTo: payload.inReplyTo,
    incrementUnread: true,
  });

  if (recipient?.id) {
    await db.rpc('record_email_reply', {
      p_recipient_id: recipient.id,
      p_conversation_id: conversationId,
    });
  }

  await logEmailEvent({
    accountId,
    projectId,
    campaignId: campaign.id as string,
    recipientId: recipient?.id ?? null,
    contactId: contact.contactId,
    eventType: 'reply',
    metadata: { subject: payload.subject },
  });

  await fireEmailTrigger({
    accountId,
    projectId,
    contactId: contact.contactId,
    triggerType: 'email_replied',
    conversationId,
    messageText: bodyText,
  });

  return NextResponse.json({ ok: true, matched: true, conversationId });
}
