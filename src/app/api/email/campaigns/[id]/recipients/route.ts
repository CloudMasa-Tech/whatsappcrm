/**
 * POST /api/email/campaigns/[id]/recipients
 *
 * Appends new (or optionally repeated) email recipients as `pending` rows onto
 * an existing campaign so the same campaign template can be sent again cleanly
 * to additional audiences without duplicating prior queued sends.
 */

import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { parseRecipientInput } from '@/lib/email/campaign-helpers';
import {
  insertCampaignRecipients,
  resolveAudienceRecipients,
} from '@/lib/email/campaign-recipients';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';

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
    `email:campaignAddRecipients:${ctx.userId}`,
    RATE_LIMITS.adminAction,
  );
  if (!limit.success) return rateLimitResponse(limit);

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as {
    recipients?: unknown;
    contactIds?: unknown;
    addAllContacts?: unknown;
    allowResendExisting?: unknown;
  } | null;

  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data: campaign, error: campErr } = await db
    .from('email_campaigns')
    .select('id, account_id, project_id, status')
    .eq('id', id)
    .eq('account_id', ctx.accountId)
    .maybeSingle();

  if (campErr || !campaign) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  }

  if (campaign.status === 'sending') {
    return NextResponse.json(
      { error: 'Cannot add recipients while this campaign is actively sending' },
      { status: 409 },
    );
  }

  const parsedRecipients =
    typeof body.recipients === 'string' || Array.isArray(body.recipients)
      ? parseRecipientInput(body.recipients as string | string[])
      : [];
  const contactIds = Array.isArray(body.contactIds)
    ? body.contactIds.filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
    : [];
  const addAllContacts = body.addAllContacts === true;
  const allowResendExisting = body.allowResendExisting === true;

  if (parsedRecipients.length === 0 && contactIds.length === 0 && !addAllContacts) {
    return NextResponse.json(
      { error: 'Enter at least one valid email address or select a CRM contact.' },
      { status: 400 },
    );
  }

  const candidates = await resolveAudienceRecipients(db, {
    accountId: ctx.accountId,
    projectId: campaign.project_id ?? null,
    parsedRecipients,
    contactIds,
    useAllContacts: addAllContacts,
  });

  if (candidates.length === 0) {
    return NextResponse.json(
      { error: 'No valid email addresses or CRM contacts with email found.' },
      { status: 400 },
    );
  }

  const result = await insertCampaignRecipients(db, {
    campaignId: campaign.id,
    candidates,
    allowResendExisting,
  });

  if (result.error) {
    console.error('[POST /api/email/campaigns/[id]/recipients] insert error:', result.error);
    return NextResponse.json(
      { error: 'Failed to queue recipients for campaign' },
      { status: 500 },
    );
  }

  const { count: pendingCount } = await db
    .from('email_campaign_recipients')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaign.id)
    .eq('status', 'pending');

  return NextResponse.json({
    campaignId: campaign.id,
    addedCount: result.addedCount,
    skippedAlreadySent: result.skippedAlreadySent,
    skippedPending: result.skippedPending,
    totalRecipients: result.totalRecipients,
    pendingCount: typeof pendingCount === 'number' ? pendingCount : result.addedCount,
  });
}

