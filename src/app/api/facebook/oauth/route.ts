import { NextResponse } from 'next/server';
import { requireProjectRole } from '@/lib/auth/project';
import { toErrorResponse } from '@/lib/auth/account';
import { encrypt } from '@/lib/whatsapp/encryption';
import { fetchUserFacebookPages, verifyFacebookPageToken } from '@/lib/facebook/meta-client';

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
      app_secret?: string;
    } | null;

    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const action = body.action || 'discover';

    // 1. Discover Pages for a given User Access Token
    if (action === 'discover') {
      const userToken = body.token?.trim() || '';
      if (!userToken) {
        return NextResponse.json({ error: 'User Access Token is required' }, { status: 400 });
      }

      const pages = await fetchUserFacebookPages(userToken);
      return NextResponse.json({ pages });
    }

    // 2. Connect a selected Page
    if (action === 'connect_page') {
      const accessToken = body.access_token?.trim() || '';
      const pageId = body.page_id?.trim() || '';

      if (!accessToken || !pageId) {
        return NextResponse.json({ error: 'Page ID and Access Token are required' }, { status: 400 });
      }

      // Verify the page token
      const profile = await verifyFacebookPageToken(accessToken, pageId);

      const encryptedToken = encrypt(accessToken);
      const encryptedSecret = body.app_secret?.trim() ? encrypt(body.app_secret.trim()) : null;

      const { data: saved, error } = await ctx.supabase
        .from('facebook_config')
        .upsert(
          {
            project_id: ctx.projectId,
            page_id: profile.id,
            page_name: profile.name,
            profile_picture_url: profile.profilePictureUrl,
            encrypted_access_token: encryptedToken,
            encrypted_app_secret: encryptedSecret,
            verify_token: `masacrm_fb_${ctx.projectId.slice(0, 8)}`,
            status: 'connected',
            last_error: null,
            connected_at: new Date().toISOString(),
          },
          { onConflict: 'project_id' },
        )
        .select('id, page_id, page_name, profile_picture_url, status, connected_at')
        .single();

      if (error) {
        console.error('[POST /api/facebook/oauth] DB error:', error);
        return NextResponse.json({ error: 'Failed to save Facebook configuration' }, { status: 500 });
      }

      return NextResponse.json({ success: true, config: saved });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err) {
    console.error('[POST /api/facebook/oauth] error:', err);
    return toErrorResponse(err);
  }
}
