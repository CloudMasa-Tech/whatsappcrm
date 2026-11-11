import { NextResponse } from 'next/server';
import { requireProjectRole } from '@/lib/auth/project';
import { ForbiddenError, UnauthorizedError, toErrorResponse } from '@/lib/auth/account';
import { sanitizeAccessToken } from '@/lib/instagram/meta-client';
import { saveFacebookPageConfig } from '@/lib/facebook/config-store';
import {
  fetchUserFacebookPages,
  verifyFacebookPageToken,
} from '@/lib/facebook/meta-client';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const ctx = await requireProjectRole('agent');
    const body = (await request.json().catch(() => null)) as {
      action?: string;
      token?: string;
      page_id?: string;
      page_name?: string;
      access_token?: string;
      profile_picture_url?: string;
      verify_token?: string;
      app_secret?: string;
    } | null;

    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const action = body.action || 'discover';

    // 1. Discover Pages for a given User or Page Access Token
    if (action === 'discover') {
      const userToken = body.token ? sanitizeAccessToken(body.token) : '';
      if (!userToken) {
        return NextResponse.json({ error: 'Access Token is required' }, { status: 400 });
      }

      const pages = await fetchUserFacebookPages(userToken);
      return NextResponse.json({ pages });
    }

    // 2. Connect a selected Page
    if (action === 'connect_page') {
      const accessToken = body.access_token ? sanitizeAccessToken(body.access_token) : '';
      const pageId = body.page_id?.trim() || '';

      if (!accessToken || !pageId) {
        return NextResponse.json(
          { error: 'Page ID and Access Token are required' },
          { status: 400 },
        );
      }

      const profile = await verifyFacebookPageToken(accessToken, pageId);

      const { data: saved, error } = await saveFacebookPageConfig({
        ctx,
        profile,
        fallbackAccessToken: accessToken,
        verifyToken: body.verify_token ?? null,
        appSecret: body.app_secret ?? null,
      });

      if (error) {
        if (
          error.code === 'PGRST205' ||
          error.message?.includes('Could not find the table')
        ) {
          return NextResponse.json(
            {
              error:
                "Database table 'facebook_config' not found. Apply migration 058_facebook_config.sql.",
              table_missing: true,
            },
            { status: 400 },
          );
        }
        console.error('[POST /api/facebook/oauth] DB error:', error);
        return NextResponse.json(
          { error: 'Failed to save Facebook configuration' },
          { status: 500 },
        );
      }

      return NextResponse.json({ success: true, profile, config: saved });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err) {
    if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
      return toErrorResponse(err);
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Facebook connection failed' },
      { status: 400 },
    );
  }
}
