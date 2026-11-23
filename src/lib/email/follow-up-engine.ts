import { supabaseAdmin } from '@/lib/supabase/admin';
import { sanitizeSenderName, ensureEmailHtml, htmlToPlainText, resolveSendMergeValues } from './campaign-helpers';
import { sendEmail } from './transport';
import { applyMergeFields, prepareTrackedBody } from './tracking';
import {
  appendEmailMessage,
  ensureContactForEmail,
  ensureEmailConversation,
  logEmailEvent,
} from './lead-flow';
import { randomUUID } from 'node:crypto';

export type FollowUpTargetFilter =
  | 'non_repliers'
  | 'unopened'
  | 'opened_not_replied'
  | 'custom';

export interface FollowUpRecipientSummary {
  id: string;
  email: string;
  name: string | null;
  status: string;
  openCount: number;
  clickCount: number;
  repliedAt: string | null;
  sentAt: string | null;
  messageId?: string | null;
  metadata?: Record<string, string>;
}

export interface FollowUpStatsResult {
  parentCampaign: {
    id: string;
    name: string;
    subject: string;
    sentCount: number;
    repliedCount: number;
    openedCount: number;
    totalRecipients: number;
    fromName?: string | null;
  };
  counts: {
    totalSent: number;
    nonRepliers: number;
    unopened: number;
    openedNotReplied: number;
    replied: number;
  };
  recipients: FollowUpRecipientSummary[];
}

/**
 * Loads follow-up eligibility statistics and recipient list for a campaign.
 */
export async function getCampaignFollowUpStats(
  campaignId: string,
  accountId: string,
): Promise<FollowUpStatsResult | null> {
  const db = supabaseAdmin();

  const { data: campaign, error: campErr } = await db
    .from('email_campaigns')
    .select('*')
    .eq('id', campaignId)
    .eq('account_id', accountId)
    .maybeSingle();

  if (campErr || !campaign) return null;

  // Load sent recipients (fall back without metadata if schema cache lacks it)
  let recips: Array<Record<string, unknown>> | null = null;
  const { data: recipsWithMeta, error: recipMetaErr } = await db
    .from('email_campaign_recipients')
    .select('id, email, name, status, open_count, click_count, replied_at, sent_at, message_id, metadata')
    .eq('campaign_id', campaignId);
  if (!recipMetaErr && recipsWithMeta) {
    recips = recipsWithMeta as Array<Record<string, unknown>>;
  } else {
    const { data: recipsBasic, error: recipErr } = await db
      .from('email_campaign_recipients')
      .select('id, email, name, status, open_count, click_count, replied_at, sent_at, message_id')
      .eq('campaign_id', campaignId);
    if (recipErr || !recipsBasic) return null;
    recips = recipsBasic as Array<Record<string, unknown>>;
  }

  if (!recips) return null;

  const validSentRecips = recips.filter((r) => r.status === 'sent' || r.status === 'delivered');
  const recipientsSummary: FollowUpRecipientSummary[] = validSentRecips.map((r: any) => ({
    id: String(r.id),
    email: String(r.email),
    name: r.name ? String(r.name) : null,
    status: String(r.status),
    openCount: Number(r.open_count) || 0,
    clickCount: Number(r.click_count) || 0,
    repliedAt: r.replied_at,
    sentAt: r.sent_at,
    messageId: r.message_id,
    metadata: (r.metadata as Record<string, string>) || {},
  }));

  let nonRepliers = 0;
  let unopened = 0;
  let openedNotReplied = 0;
  let replied = 0;

  for (const r of recipientsSummary) {
    if (r.repliedAt) {
      replied++;
    } else {
      nonRepliers++;
      if (r.openCount === 0) {
        unopened++;
      } else {
        openedNotReplied++;
      }
    }
  }

  return {
    parentCampaign: {
      id: campaign.id,
      name: campaign.name,
      subject: campaign.subject,
      sentCount: campaign.sent_count ?? 0,
      repliedCount: campaign.replied_count ?? 0,
      openedCount: campaign.opened_count ?? 0,
      totalRecipients: campaign.total_recipients ?? 0,
      fromName: campaign.from_name,
    },
    counts: {
      totalSent: validSentRecips.length,
      nonRepliers,
      unopened,
      openedNotReplied,
      replied,
    },
    recipients: recipientsSummary,
  };
}

export interface CreateFollowUpParams {
  parentCampaignId: string;
  accountId: string;
  userId: string;
  name: string;
  subject: string;
  bodyHtml: string;
  bodyText?: string;
  fromName?: string;
  targetFilter: FollowUpTargetFilter;
  selectedRecipientIds?: string[];
  timing: 'now' | 'scheduled';
  scheduledAt?: string;
  keepThread?: boolean;
}

/**
 * Creates and optionally sends a follow-up / reminder email campaign.
 */
export async function createAndDispatchFollowUp(params: CreateFollowUpParams) {
  const db = supabaseAdmin();

  const { data: parent, error: pErr } = await db
    .from('email_campaigns')
    .select('*')
    .eq('id', params.parentCampaignId)
    .eq('account_id', params.accountId)
    .maybeSingle();

  if (pErr || !parent) {
    throw new Error('Parent campaign not found');
  }

  // Load recipients from parent (fall back without metadata if schema cache lacks it)
  let allRecips: Array<Record<string, unknown>> | null = null;
  const { data: recipsWithMeta, error: rMetaErr } = await db
    .from('email_campaign_recipients')
    .select('id, email, name, status, contact_id, open_count, replied_at, message_id, metadata')
    .eq('campaign_id', params.parentCampaignId);
  if (!rMetaErr && recipsWithMeta) {
    allRecips = recipsWithMeta as Array<Record<string, unknown>>;
  } else {
    const { data: recipsBasic, error: rErr } = await db
      .from('email_campaign_recipients')
      .select('id, email, name, status, contact_id, open_count, replied_at, message_id')
      .eq('campaign_id', params.parentCampaignId);
    if (rErr || !recipsBasic) {
      throw new Error('Could not load parent campaign recipients');
    }
    allRecips = recipsBasic as Array<Record<string, unknown>>;
  }

  const selectedSet = params.selectedRecipientIds?.length
    ? new Set(params.selectedRecipientIds)
    : null;

  // Filter based on requested target
  const eligibleRecips = allRecips.filter((r: any) => {
    if (r.status !== 'sent' && r.status !== 'delivered') return false;
    if (selectedSet) return selectedSet.has(r.id);

    if (params.targetFilter === 'unopened') {
      return (Number(r.open_count) || 0) === 0 && !r.replied_at;
    }
    if (params.targetFilter === 'opened_not_replied') {
      return (Number(r.open_count) || 0) > 0 && !r.replied_at;
    }
    // Default 'non_repliers'
    return !r.replied_at;
  });

  if (eligibleRecips.length === 0) {
    throw new Error('No recipients match the selected follow-up audience.');
  }

  const campaignName = params.name.trim() || `${parent.name} (Follow-Up)`;
  const campaignSubject = params.subject.trim() || `Re: ${parent.subject}`;
  const isScheduled = params.timing === 'scheduled' && Boolean(params.scheduledAt);
  const initialStatus = isScheduled ? 'scheduled' : 'draft';

  const audienceFilter = {
    parent_campaign_id: parent.id,
    parent_name: parent.name,
    is_followup: true,
    followup_type: params.targetFilter,
    keep_thread: params.keepThread !== false,
    scheduled_at: isScheduled ? params.scheduledAt : null,
  };

  // Build insert payload with graceful fallback
  const insertPayload: Record<string, unknown> = {
    account_id: params.accountId,
    project_id: parent.project_id,
    user_id: params.userId,
    name: campaignName,
    subject: campaignSubject,
    body_html: params.bodyHtml,
    body_text: params.bodyText || null,
    from_name: params.fromName ? sanitizeSenderName(params.fromName) : parent.from_name,
    from_email: parent.from_email,
    reply_to: parent.reply_to,
    status: initialStatus,
    scheduled_at: isScheduled ? params.scheduledAt : null,
    track_opens: parent.track_opens !== false,
    track_clicks: parent.track_clicks !== false,
    total_recipients: eligibleRecips.length,
    audience_filter: audienceFilter,
    parent_campaign_id: parent.id,
    is_followup: true,
    followup_type: params.targetFilter,
  };

  let newCampaign = null;
  const { data: created, error: createErr } = await db
    .from('email_campaigns')
    .insert(insertPayload)
    .select('*')
    .single();

  if (createErr) {
    // If migration columns (parent_campaign_id, is_followup) are not yet loaded in schema cache, fall back
    console.warn('[createAndDispatchFollowUp] Retrying without new columns:', createErr.message);
    const fallbackPayload = {
      account_id: params.accountId,
      project_id: parent.project_id,
      user_id: params.userId,
      name: campaignName,
      subject: campaignSubject,
      body_html: params.bodyHtml,
      body_text: params.bodyText || null,
      from_name: params.fromName ? sanitizeSenderName(params.fromName) : parent.from_name,
      from_email: parent.from_email,
      reply_to: parent.reply_to,
      status: initialStatus,
      scheduled_at: isScheduled ? params.scheduledAt : null,
      track_opens: parent.track_opens !== false,
      track_clicks: parent.track_clicks !== false,
      total_recipients: eligibleRecips.length,
      audience_filter: audienceFilter,
    };
    const { data: retryCreated, error: retryErr } = await db
      .from('email_campaigns')
      .insert(fallbackPayload)
      .select('*')
      .single();

    if (retryErr || !retryCreated) {
      throw new Error(`Failed to create follow-up campaign: ${retryErr?.message || createErr.message}`);
    }
    newCampaign = retryCreated;
  } else {
    newCampaign = created;
  }

  // Insert cloned recipients
  const rowsToInsert = eligibleRecips.map((r: any) => {
    const parentMsgId = params.keepThread !== false ? r.message_id : null;
    const existingMeta = (r.metadata as Record<string, string>) || {};
    const mergedMetadata = {
      ...existingMeta,
      ...(parentMsgId ? { parent_message_id: parentMsgId } : {}),
      followup_from_campaign_id: parent.id,
    };

    return {
      campaign_id: newCampaign.id,
      email: r.email,
      name: r.name,
      contact_id: r.contact_id,
      status: 'pending',
      tracking_token: randomUUID().replace(/-/g, ''),
      metadata: mergedMetadata,
      ...(parentMsgId ? { parent_message_id: parentMsgId } : {}),
    };
  });

  const tryInsertRecips = async (rows: Array<Record<string, unknown>>) => {
    return db.from('email_campaign_recipients').insert(rows);
  };

  let recipInsertErr: { message?: string } | null = null;
  ({ error: recipInsertErr } = await tryInsertRecips(rowsToInsert as Array<Record<string, unknown>>));

  if (recipInsertErr) {
    console.warn('[createAndDispatchFollowUp] Recipient insert fallback (drop parent_message_id):', recipInsertErr.message);
    let rows = rowsToInsert.map(({ parent_message_id, ...rest }) => rest) as Array<Record<string, unknown>>;
    let { error } = await tryInsertRecips(rows);
    if (error) {
      console.warn('[createAndDispatchFollowUp] Recipient insert fallback (drop metadata):', error.message);
      rows = rows.map(({ metadata, ...rest }) => rest) as Array<Record<string, unknown>>;
      ({ error } = await tryInsertRecips(rows));
    }
    if (error) {
      throw new Error(`Failed to copy recipients for follow-up: ${error.message}`);
    }
  }

  // If immediate send requested
  if (params.timing === 'now') {
    const sendResult = await executeCampaignSend(newCampaign.id, params.accountId);
    return {
      campaign: sendResult.campaign,
      timing: 'now',
      sent: sendResult.sent,
      failed: sendResult.failed,
      total: eligibleRecips.length,
    };
  }

  return {
    campaign: newCampaign,
    timing: 'scheduled',
    scheduledAt: params.scheduledAt,
    total: eligibleRecips.length,
  };
}

/**
 * Standalone executor to send a campaign's pending recipients.
 */
export async function executeCampaignSend(campaignId: string, accountId: string) {
  const db = supabaseAdmin();

  const { data: campaign, error: campErr } = await db
    .from('email_campaigns')
    .select('*')
    .eq('id', campaignId)
    .eq('account_id', accountId)
    .maybeSingle();

  if (campErr || !campaign) {
    throw new Error('Campaign not found');
  }

  await db.from('email_campaigns').update({ status: 'sending' }).eq('id', campaignId);

  // Try selecting with parent_message_id first; fall back if schema cache lacks it.
  let recips: Array<{
    id: string;
    email: string;
    name: string | null;
    contact_id: string | null;
    tracking_token: string | null;
    metadata: Record<string, unknown> | null;
    parent_message_id?: string | null;
  }> | null = null;

  const { data: recipsWithParent, error: recipParentErr } = await db
    .from('email_campaign_recipients')
    .select('id, email, name, contact_id, tracking_token, metadata, parent_message_id')
    .eq('campaign_id', campaignId)
    .eq('status', 'pending');

  if (!recipParentErr && recipsWithParent) {
    recips = recipsWithParent as Array<{
      id: string;
      email: string;
      name: string | null;
      contact_id: string | null;
      tracking_token: string | null;
      metadata: Record<string, unknown> | null;
      parent_message_id?: string | null;
    }>;
  } else {
    const { data: recipsBasic, error: recipErr } = await db
      .from('email_campaign_recipients')
      .select('id, email, name, contact_id, tracking_token, metadata')
      .eq('campaign_id', campaignId)
      .eq('status', 'pending');
    if (recipErr) {
      await db.from('email_campaigns').update({ status: 'sent' }).eq('id', campaignId);
      return { campaign, sent: 0, failed: 0, total: 0 };
    }
    recips = recipsBasic as Array<{
      id: string;
      email: string;
      name: string | null;
      contact_id: string | null;
      tracking_token: string | null;
      metadata: Record<string, unknown> | null;
      parent_message_id?: string | null;
    }>;
  }

  if (!recips || recips.length === 0) {
    await db.from('email_campaigns').update({ status: 'sent' }).eq('id', campaignId);
    return { campaign, sent: 0, failed: 0, total: 0 };
  }

  let sent = 0;
  let failed = 0;

  for (const recipient of recips) {
    const { subjectFields, bodyFields } = resolveSendMergeValues(recipient as any);
    const trackingToken = recipient.tracking_token || '';

    const subject = applyMergeFields(campaign.subject, subjectFields);
    const renderedBodyHtml = applyMergeFields(
      ensureEmailHtml(campaign.body_html),
      bodyFields,
    );
    const html = prepareTrackedBody({
      html: renderedBodyHtml,
      token: trackingToken,
      trackOpens: Boolean(trackingToken) && campaign.track_opens !== false,
      trackClicks: Boolean(trackingToken) && campaign.track_clicks !== false,
    });
    const textBody = campaign.body_text
      ? applyMergeFields(campaign.body_text, bodyFields)
      : htmlToPlainText(renderedBodyHtml);

    const parentMsgId =
      recipient.parent_message_id ||
      ((recipient.metadata as Record<string, unknown> | null | undefined)?.parent_message_id as string | undefined);

    const result = await sendEmail({
      to: recipient.email,
      subject,
      html,
      text: textBody || undefined,
      fromName: campaign.from_name ?? undefined,
      fromEmail: campaign.from_email ?? undefined,
      replyTo: campaign.reply_to ?? undefined,
      projectId: campaign.project_id ?? undefined,
      accountId: campaign.account_id,
      inReplyTo: parentMsgId || undefined,
      references: parentMsgId || undefined,
    }).catch((err: unknown) => ({
      success: false,
      error: String(err),
      messageId: undefined,
    }));

    if (result.success) {
      sent++;
      await db
        .from('email_campaign_recipients')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          message_id: result.messageId ?? null,
        })
        .eq('id', recipient.id);

      const contact = await ensureContactForEmail({
        accountId: campaign.account_id,
        projectId: campaign.project_id,
        ownerUserId: campaign.user_id,
        email: recipient.email,
        name: recipient.name,
        contactId: recipient.contact_id,
      });

      if (contact) {
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
            bodyText: textBody || subject,
            emailMessageId: result.messageId ?? null,
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
      failed++;
      await db
        .from('email_campaign_recipients')
        .update({
          status: 'failed',
          error_message: (result as { error?: string }).error ?? 'Unknown error',
        })
        .eq('id', recipient.id);
    }

    // Small delay between sends to prevent SMTP throttling
    await new Promise((res) => setTimeout(res, 250));
  }

  const totalSent = (campaign.sent_count ?? 0) + sent;
  const totalFailed = (campaign.failed_count ?? 0) + failed;
  const nextStatus = totalSent > 0 ? 'sent' : failed === recips.length ? 'failed' : 'sent';

  const { data: updated } = await db
    .from('email_campaigns')
    .update({
      status: nextStatus,
      sent_count: totalSent,
      failed_count: totalFailed,
      sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', campaignId)
    .select('*')
    .single();

  return { campaign: updated, sent, failed, total: recips.length };
}

/**
 * Scans and executes any due scheduled campaigns across the system.
 */
export async function processDueScheduledCampaigns(optionalAccountId?: string) {
  const db = supabaseAdmin();
  const now = new Date().toISOString();

  let query = db
    .from('email_campaigns')
    .select('id, account_id, name, scheduled_at')
    .eq('status', 'scheduled')
    .lte('scheduled_at', now)
    .limit(20);

  if (optionalAccountId) {
    query = query.eq('account_id', optionalAccountId);
  }

  const { data: due, error } = await query;
  if (error || !due || due.length === 0) return { processed: 0, results: [] };

  const results: Array<{ id: string; name: string; sent: number; failed: number }> = [];

  for (const c of due) {
    try {
      const outcome = await executeCampaignSend(c.id, c.account_id);
      results.push({
        id: c.id,
        name: c.name,
        sent: outcome.sent,
        failed: outcome.failed,
      });
    } catch (err) {
      console.error(`[processDueScheduledCampaigns] Error sending ${c.id}:`, err);
    }
  }

  return { processed: results.length, results };
}
