/**
 * /api/email/campaigns
 *
 * GET  — list campaigns for the caller's account (optionally by project)
 * POST — create a draft campaign and resolve its audience
 */

import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';

const MAX_NAME_LEN = 120;
const MAX_SUBJECT_LEN = 200;
const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const projectId = new URL(request.url).searchParams.get('projectId')?.trim();

    let query = ctx.supabase
      .from('email_campaigns')
      .select('*')
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false });

    if (projectId && projectId !== 'all') query = query.eq('project_id', projectId);

    const { data, error } = await query;

    if (error) {
      if (
        error.code === 'PGRST205' ||
        error.message?.includes('Could not find the table') ||
        error.message?.includes('does not exist')
      ) {
        return NextResponse.json({ campaigns: [], table_missing: true });
      }
      console.error('[GET /api/email/campaigns] error:', error);
      return NextResponse.json({ error: 'Failed to load campaigns' }, { status: 500 });
    }

    return NextResponse.json({ campaigns: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
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
    /** Explicit addresses, or omit to mail every contact with an email. */
    recipients?: unknown;
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

  const projectId =
    typeof body.projectId === 'string' && body.projectId.trim()
      ? body.projectId.trim()
      : null;

  // A project-scoped campaign must belong to the caller's account.
  if (projectId) {
    const { data: project } = await ctx.supabase
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .maybeSingle();
    if (!project) {
      return NextResponse.json(
        { error: 'Project not found or not accessible' },
        { status: 400 },
      );
    }
  }

  const db = supabaseAdmin();

  const { data: campaign, error: createErr } = await db
    .from('email_campaigns')
    .insert({
      account_id: ctx.accountId,
      project_id: projectId,
      user_id: ctx.userId,
      name,
      subject,
      body_html: bodyHtml,
      body_text: typeof body.bodyText === 'string' ? body.bodyText : null,
      from_name: typeof body.fromName === 'string' ? body.fromName.trim() : null,
      from_email: typeof body.fromEmail === 'string' ? body.fromEmail.trim() : null,
      reply_to: typeof body.replyTo === 'string' ? body.replyTo.trim() : null,
      track_opens: body.trackOpens !== false,
      track_clicks: body.trackClicks !== false,
      status: 'draft',
    })
    .select('*')
    .single();

  if (createErr || !campaign) {
    console.error('[POST /api/email/campaigns] insert error:', createErr);
    return NextResponse.json({ error: 'Failed to create campaign' }, { status: 500 });
  }

  // Resolve the audience now, so the draft shows a recipient count
  // before it is sent.
  let audience: { email: string; name: string | null; contact_id: string | null }[] = [];

  if (Array.isArray(body.recipients) && body.recipients.length > 0) {
    audience = body.recipients
      .filter((r): r is string => typeof r === 'string')
      .map((r) => r.trim().toLowerCase())
      .filter((r) => EMAIL_RE.test(r))
      .map((email) => ({ email, name: null, contact_id: null }));
  } else {
    let contactQuery = db
      .from('contacts')
      .select('id, name, email')
      .eq('account_id', ctx.accountId)
      .not('email', 'is', null);

    if (projectId) contactQuery = contactQuery.eq('project_id', projectId);

    const { data: contacts } = await contactQuery;

    audience = (contacts ?? [])
      .filter((c) => typeof c.email === 'string' && EMAIL_RE.test(c.email))
      .map((c) => ({
        email: (c.email as string).toLowerCase(),
        name: c.name ?? null,
        contact_id: c.id,
      }));
  }

  // De-duplicate by address — mailing the same person twice in one
  // campaign is always a bug.
  const seen = new Set<string>();
  const unique = audience.filter((a) => {
    if (seen.has(a.email)) return false;
    seen.add(a.email);
    return true;
  });

  if (unique.length > 0) {
    const { error: recipErr } = await db.from('email_campaign_recipients').insert(
      unique.map((a) => ({
        campaign_id: campaign.id,
        contact_id: a.contact_id,
        email: a.email,
        name: a.name,
        status: 'pending',
      })),
    );

    if (recipErr) {
      console.error('[POST /api/email/campaigns] recipients insert error:', recipErr);
      return NextResponse.json(
        { error: 'Campaign created but the audience could not be saved' },
        { status: 500 },
      );
    }

    await db
      .from('email_campaigns')
      .update({ total_recipients: unique.length })
      .eq('id', campaign.id);
  }

  return NextResponse.json(
    { campaign: { ...campaign, total_recipients: unique.length } },
    { status: 201 },
  );
}
