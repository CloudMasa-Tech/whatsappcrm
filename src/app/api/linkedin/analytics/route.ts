import { NextResponse } from 'next/server';
import { requireProjectRole } from '@/lib/auth/project';
import { toErrorResponse } from '@/lib/auth/account';
import {
  fetchOrganizationAnalytics,
  LinkedInApiError,
} from '@/lib/linkedin/client';
import { loadActiveLinkedInConfig } from '@/lib/linkedin/config-store';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const ctx = await requireProjectRole('viewer');
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
            'Page Analytics requires a connected LinkedIn Company / Organization Page (Community Management API).',
        },
        { status: 400 },
      );
    }

    const analytics = await fetchOrganizationAnalytics(cfg.accessToken, cfg.organizationId);
    return NextResponse.json({ success: true, analytics });
  } catch (err) {
    if (err instanceof LinkedInApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status || 400 });
    }
    return toErrorResponse(err);
  }
}

