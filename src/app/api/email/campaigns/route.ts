/**
 * /api/email/campaigns
 *
 * GET  — list campaigns for the caller's account
 * POST — create a draft campaign and resolve its audience
 */

import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse, UnauthorizedError } from '@/lib/auth/account';
import { getCurrentProject } from '@/lib/auth/project';
import { parseRecipientInput, sanitizeSenderName } from '@/lib/email/campaign-helpers';
import {
  insertCampaignRecipients,
  resolveAudienceRecipients,
} from '@/lib/email/campaign-recipients';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';

const MAX_NAME_LEN = 120;
const MAX_SUBJECT_LEN = 200;

export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const projectCtx = await getCurrentProject().catch(() => null);
    const paramProjectId = new URL(request.url).searchParams.get('projectId')?.trim();
    const activeProjectId = paramProjectId || projectCtx?.projectId;

    const db = supabaseAdmin();
    let query = db
      .from('email_campaigns')
      .select('*')
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false });

    if (activeProjectId && activeProjectId !== 'all') {
      query = query.eq('project_id', activeProjectId);
    }

    const { data, error } = await query;

    if (error) {
      if (
        error.code === 'PGRST205' ||
        error.code === '42P01' ||
        error.message?.includes('Could not find the table') ||
        error.message?.includes('does not exist')
      ) {
        return NextResponse.json({ campaigns: [], table_missing: true });
      }
      console.warn('[GET /api/email/campaigns] query warning:', error);
      return NextResponse.json({ campaigns: [] });
    }

    return NextResponse.json({ campaigns: data ?? [], table_missing: false });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.warn('[GET /api/email/campaigns] catch fallback:', err);
    return NextResponse.json({ campaigns: [], table_missing: false });
  }
}

export async function POST(request: Request) {
  let ctx;
  try {
    ctx = await getCurrentAccount();
  } catch (err) {
    return toErrorResponse(err);
  }

  const limit = checkRateLimit(
    `email:campaignCreate:${ctx.userId}`,
    RATE_LIMITS.adminAction,
  );
  if (!limit.success) return rateLimitResponse(limit);

  const body = (await request.json().catch(() => null)) as {
    name?: unknown;
    subject?: unknown;
    bodyHtml?: unknown;
    bodyText?: unknown;
    projectId?: unknown;
    fromName?: unknown;
    fromEmail?: unknown;
    replyTo?: unknown;
    trackOpens?: unknown;
    trackClicks?: unknown;
    recipients?: unknown;
    contactIds?: unknown;
  } | null;

  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
  const bodyHtml = typeof body.bodyHtml === 'string' ? body.bodyHtml : '';

  if (!name || name.length > MAX_NAME_LEN) {
    return NextResponse.json(
      { error: `Campaign name is required (max ${MAX_NAME_LEN} characters)` },
      { status: 400 },
    );
  }
  if (!subject || subject.length > MAX_SUBJECT_LEN) {
    return NextResponse.json(
      { error: `Subject is required (max ${MAX_SUBJECT_LEN} characters)` },
      { status: 400 },
    );
  }
  if (!bodyHtml.trim()) {
    return NextResponse.json({ error: 'Email body is required' }, { status: 400 });
  }

  const projectCtx = await getCurrentProject().catch(() => null);
  let resolvedProjectId =
    typeof body.projectId === 'string' && body.projectId.trim()
      ? body.projectId.trim()
      : projectCtx?.projectId ?? null;

  const db = supabaseAdmin();

  // If still no projectId, look up first project for account
  if (!resolvedProjectId) {
    const { data: defaultProject } = await db
      .from('projects')
      .select('id')
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (defaultProject?.id) {
      resolvedProjectId = defaultProject.id;
    }
  } else {
    const { data: project } = await db
      .from('projects')
      .select('id')
      .eq('id', resolvedProjectId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (!project) {
      return NextResponse.json(
        { error: 'Project not found or not accessible' },
        { status: 400 },
      );
    }
  }

  // Full insert payload with all migration 056+057 columns
  const fullPayload: Record<string, unknown> = {
    account_id: ctx.accountId,
    project_id: resolvedProjectId,
    user_id: ctx.userId,
    name,
    subject,
    body_html: bodyHtml,
    body_text: typeof body.bodyText === 'string' ? body.bodyText : null,
    from_name: typeof body.fromName === 'string' ? sanitizeSenderName(body.fromName) || null : null,
    from_email: typeof body.fromEmail === 'string' ? body.fromEmail.trim() || null : null,
    reply_to: typeof body.replyTo === 'string' ? body.replyTo.trim() || null : null,
    track_opens: body.trackOpens !== false,
    track_clicks: body.trackClicks !== false,
    status: 'draft',
  };

  let { data: campaign, error: createErr } = await db
    .from('email_campaigns')
    .insert(fullPayload)
    .select('*')
    .single();

  // If a column like reply_to or track_opens is missing from schema cache, fall back to core schema
  if (createErr && createErr.message?.includes("Could not find the '")) {
    console.warn('[POST /api/email/campaigns] schema cache column mismatch, retrying with core columns:', createErr.message);
    const corePayload: Record<string, unknown> = {
      account_id: ctx.accountId,
      project_id: resolvedProjectId,
      user_id: ctx.userId,
      name,
      subject,
      body_html: bodyHtml,
      status: 'draft',
    };
    const retry = await db
      .from('email_campaigns')
      .insert(corePayload)
      .select('*')
      .single();
    campaign = retry.data;
    createErr = retry.error;
  }

  if (createErr || !campaign) {
    console.error('[POST /api/email/campaigns] insert error:', createErr);
    if (
      createErr?.code === 'PGRST205' ||
      createErr?.code === '42P01' ||
      createErr?.message?.includes('Could not find the table') ||
      createErr?.message?.includes('does not exist')
    ) {
      return NextResponse.json(
        {
          error:
            'Database tables for Email Campaigns are not installed yet. Please run migration 056 and 057 in your Supabase SQL Editor.',
          table_missing: true,
        },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: createErr?.message || 'Failed to create campaign' },
      { status: 400 },
    );
  }

  // Resolve the audience now, so the draft shows a recipient count
  // before it is sent.
  const hasExplicitRecipients =
    (typeof body.recipients === 'string' && body.recipients.trim().length > 0) ||
    (Array.isArray(body.recipients) && body.recipients.length > 0);
  const parsedRecipients = hasExplicitRecipients
    ? parseRecipientInput(body.recipients as string | string[])
    : [];
  const contactIds = Array.isArray(body.contactIds)
    ? body.contactIds.filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
    : [];

  const unique = await resolveAudienceRecipients(db, {
    accountId: ctx.accountId,
    projectId: resolvedProjectId,
    parsedRecipients,
    contactIds,
    useAllContacts: !hasExplicitRecipients && contactIds.length === 0,
  });

  let totalRecipients = 0;
  if (unique.length > 0) {
    const insertResult = await insertCampaignRecipients(db, {
      campaignId: campaign.id,
      candidates: unique,
      allowResendExisting: false,
    });

    if (insertResult.error) {
      console.error('[POST /api/email/campaigns] recipients insert error:', insertResult.error);
      return NextResponse.json(
        { error: 'Campaign created but the audience could not be saved' },
        { status: 500 },
      );
    }

    totalRecipients = insertResult.totalRecipients;
  }

  return NextResponse.json(
    { campaign: { ...campaign, total_recipients: totalRecipients } },
    { status: 201 },
  );
}
