import { NextResponse } from 'next/server';
import { requireProjectRole } from '@/lib/auth/project';
import { toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  fetchLinkedInLeadSubmissions,
  LinkedInApiError,
} from '@/lib/linkedin/client';
import {
  ingestLinkedInLeadToCrm,
  loadActiveLinkedInConfig,
} from '@/lib/linkedin/config-store';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const ctx = await requireProjectRole('viewer');
    const { data: contacts } = await supabaseAdmin()
      .from('contacts')
      .select('id, name, email, phone, company, channel, linkedin_urn, created_at')
      .eq('account_id', ctx.accountId)
      .eq('project_id', ctx.projectId)
      .eq('channel', 'linkedin')
      .order('created_at', { ascending: false })
      .limit(50);

    return NextResponse.json({ success: true, leads: contacts ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST() {
  try {
    const ctx = await requireProjectRole('agent');
    const cfg = await loadActiveLinkedInConfig(ctx.projectId);
    if (!cfg) {
      return NextResponse.json(
        { error: 'LinkedIn is not connected for this project.' },
        { status: 400 },
      );
    }

    if (!cfg.organizationId) {
      return NextResponse.json(
        {
          error:
            'Syncing Lead Gen Forms requires a connected Company / Organization ID and LinkedIn Lead Sync API permission.',
        },
        { status: 400 },
      );
    }

    const submissions = await fetchLinkedInLeadSubmissions(
      cfg.accessToken,
      cfg.organizationId,
      25,
    );

    let createdCount = 0;
    for (const lead of submissions) {
      const res = await ingestLinkedInLeadToCrm({
        accountId: ctx.accountId,
        projectId: ctx.projectId,
        ownerUserId: cfg.userId || ctx.userId,
        lead,
      });
      if (res?.created) createdCount++;
    }

    return NextResponse.json({
      success: true,
      fetched: submissions.length,
      imported: createdCount,
    });
  } catch (err) {
    if (err instanceof LinkedInApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status || 400 });
    }
    return toErrorResponse(err);
  }
}

