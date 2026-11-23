import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import {
  createAndDispatchFollowUp,
  getCampaignFollowUpStats,
  type FollowUpTargetFilter,
} from '@/lib/email/follow-up-engine';

export const maxDuration = 300;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getCurrentAccount();
    const { id } = await params;

    const data = await getCampaignFollowUpStats(id, ctx.accountId);
    if (!data) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    return NextResponse.json(data);
  } catch (err) {
    return toErrorResponse(err);
  }
}

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
    `email:followUp:${ctx.userId}`,
    RATE_LIMITS.adminAction,
  );
  if (!limit.success) return rateLimitResponse(limit);

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as {
    name?: string;
    subject?: string;
    bodyHtml?: string;
    bodyText?: string;
    fromName?: string;
    targetFilter?: FollowUpTargetFilter;
    selectedRecipientIds?: string[];
    timing?: 'now' | 'scheduled';
    scheduledAt?: string;
    keepThread?: boolean;
  } | null;

  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON request body' }, { status: 400 });
  }

  const targetFilter = body.targetFilter || 'non_repliers';
  const timing = body.timing === 'scheduled' ? 'scheduled' : 'now';

  if (!body.subject?.trim()) {
    return NextResponse.json({ error: 'Subject is required for follow-up' }, { status: 400 });
  }

  if (!body.bodyHtml?.trim()) {
    return NextResponse.json({ error: 'Email content is required for follow-up' }, { status: 400 });
  }

  if (timing === 'scheduled' && !body.scheduledAt) {
    return NextResponse.json(
      { error: 'Please choose a valid schedule date and time for reminder' },
      { status: 400 },
    );
  }

  try {
    const result = await createAndDispatchFollowUp({
      parentCampaignId: id,
      accountId: ctx.accountId,
      userId: ctx.userId,
      name: body.name || '',
      subject: body.subject,
      bodyHtml: body.bodyHtml,
      bodyText: body.bodyText,
      fromName: body.fromName,
      targetFilter,
      selectedRecipientIds: body.selectedRecipientIds,
      timing,
      scheduledAt: body.scheduledAt,
      keepThread: body.keepThread !== false,
    });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[POST /api/email/campaigns/[id]/follow-up] error:', err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
