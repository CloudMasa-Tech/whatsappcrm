/**
 * POST /api/email/campaigns/[id]/send
 *
 * Sends a draft campaign to its pending recipients.
 *
 * Each recipient gets its own tracked body (unique pixel + rewritten
 * links keyed to that recipient's token), and each send is mirrored
 * into the shared inbox as an outbound message on an `email` channel
 * conversation — so the thread already exists when the person replies.
 *
 * Sending is sequential with a small delay. This mirrors the WhatsApp
 * broadcast path: SMTP providers rate-limit aggressively, and a burst
 * is the fastest way to get a domain throttled or blocked.
 */

import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email/transport';
import { applyMergeFields, prepareTrackedBody } from '@/lib/email/tracking';
import {
  appendEmailMessage,
  ensureContactForEmail,
  ensureEmailConversation,
  logEmailEvent,
} from '@/lib/email/lead-flow';

/** Milliseconds between sends. */
const SEND_DELAY_MS = 250;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let ctx;
  try {
    ctx = await getCurrentAccount();
  } catch (err) {
    return toErrorResponse(err);
  }

  const limit = checkRateLimit(
    `email:campaignSend:${ctx.userId}`,
    RATE_LIMITS.adminAction,
  );
  if (!limit.success) return rateLimitResponse(limit);

  const { id } = await params;
  const db = supabaseAdmin();

  // Scope by account: the service-role client bypasses RLS, so this
  // equality check is the tenant isolation.
  const { data: campaign, error: campErr } = await db
    .from('email_campaigns')
    .select('*')
    .eq('id', id)
    .eq('account_id', ctx.accountId)
    .maybeSingle();

  if (campErr || !campaign) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  }

  if (campaign.status === 'sending') {
    return NextResponse.json(
      { error: 'This campaign is already sending' },
      { status: 409 },
    );
  }
  if (campaign.status === 'sent') {
    return NextResponse.json(
      { error: 'This campaign has already been sent' },
      { status: 409 },
    );
  }

  const { data: recipients, error: recipErr } = await db
    .from('email_campaign_recipients')
    .select('id, email, name, contact_id, tracking_token')
    .eq('campaign_id', id)
    .eq('status', 'pending');

  if (recipErr) {
    return NextResponse.json({ error: 'Failed to load recipients' }, { status: 500 });
  }
  if (!recipients || recipients.length === 0) {
    return NextResponse.json(
      { error: 'This campaign has no pending recipients' },
      { status: 400 },
    );
  }

  await db.from('email_campaigns').update({ status: 'sending' }).eq('id', id);

  let sent = 0;
  let failed = 0;

  for (const recipient of recipients) {
    const mergeFields = {
      name: recipient.name,
      email: recipient.email,
    };

    const subject = applyMergeFields(campaign.subject, mergeFields);
    const html = prepareTrackedBody({
      html: applyMergeFields(campaign.body_html, mergeFields),
      token: recipient.tracking_token,
      trackOpens: campaign.track_opens !== false,
      trackClicks: campaign.track_clicks !== false,
    });

    const result = await sendEmail({
      to: recipient.email,
      subject,
      html,
      text: campaign.body_text
        ? applyMergeFields(campaign.body_text, mergeFields)
        : undefined,
      fromName: campaign.from_name ?? undefined,
      fromEmail: campaign.from_email ?? undefined,
      replyTo: campaign.reply_to ?? undefined,
      projectId: campaign.project_id ?? undefined,
      accountId: campaign.account_id,
    }).catch((err: unknown) => ({
      success: false,
      error: String(err),
      messageId: undefined,
    }));

    if (result.success) {
      sent += 1;
      await db
        .from('email_campaign_recipients')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          message_id: result.messageId ?? null,
        })
        .eq('id', recipient.id);

      // Mirror into the inbox so the thread pre-exists the reply.
      const contact = await ensureContactForEmail({
        accountId: campaign.account_id,
        projectId: campaign.project_id,
        ownerUserId: campaign.user_id,
        email: recipient.email,
        name: recipient.name,
        contactId: recipient.contact_id,
      });

      if (contact) {
        // Backfill the link when the audience came from raw addresses.
        if (!recipient.contact_id) {
          await db
            .from('email_campaign_recipients')
            .update({ contact_id: contact.contactId })
            .eq('id', recipient.id);
        }

        const conversationId = await ensureEmailConversation({
          accountId: campaign.account_id,
          projectId: campaign.project_id,
          ownerUserId: campaign.user_id,
          contactId: contact.contactId,
          subject,
        });

        if (conversationId) {
          await appendEmailMessage({
            conversationId,
            projectId: campaign.project_id,
            senderType: 'agent',
            subject,
            bodyText: campaign.body_text || subject,
            emailMessageId: result.messageId ?? null,
            // Outbound: the agent sent it, so nothing to mark unread.
            incrementUnread: false,
          });
        }
      }

      await logEmailEvent({
        accountId: campaign.account_id,
        projectId: campaign.project_id,
        campaignId: campaign.id,
        recipientId: recipient.id,
        contactId: contact?.contactId ?? recipient.contact_id,
        eventType: 'sent',
      });
    } else {
      failed += 1;
      await db
        .from('email_campaign_recipients')
        .update({
          status: 'failed',
          error_message: (result as { error?: string }).error ?? 'Unknown error',
        })
        .eq('id', recipient.id);
    }

    if (SEND_DELAY_MS > 0) await sleep(SEND_DELAY_MS);
  }

  const { data: updated } = await db
    .from('email_campaigns')
    .update({
      status: failed === recipients.length ? 'failed' : 'sent',
      sent_count: (campaign.sent_count ?? 0) + sent,
      failed_count: (campaign.failed_count ?? 0) + failed,
      sent_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .single();

  return NextResponse.json({
    campaign: updated,
    sent,
    failed,
    total: recipients.length,
  });
}
