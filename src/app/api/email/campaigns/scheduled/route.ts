import { NextResponse } from 'next/server';
import { getCurrentAccount } from '@/lib/auth/account';
import { processDueScheduledCampaigns } from '@/lib/email/follow-up-engine';

export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    let accountId: string | undefined;
    try {
      const ctx = await getCurrentAccount();
      accountId = ctx.accountId;
    } catch {
      // If no session, allow cron trigger if header or internal call
      const cronSecret = request.headers.get('x-cron-secret');
      if (process.env.AUTOMATION_CRON_SECRET && cronSecret !== process.env.AUTOMATION_CRON_SECRET) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    const result = await processDueScheduledCampaigns(accountId);
    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[POST /api/email/campaigns/scheduled] error:', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return POST(request);
}
