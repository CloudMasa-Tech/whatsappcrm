import { NextRequest, NextResponse } from 'next/server';
import { requireProjectRole } from '@/lib/auth/project';
import { toErrorResponse } from '@/lib/auth/account';
import { decrypt } from '@/lib/whatsapp/encryption';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { fetchFacebookPageFeed } from '@/lib/facebook/meta-client';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireProjectRole('viewer');
    const db = supabaseAdmin();

    const { data: config, error: configError } = await db
      .from('facebook_config')
      .select('access_token, page_id, status')
      .eq('project_id', ctx.projectId)
      .eq('status', 'connected')
      .maybeSingle();

    if (configError || !config) {
      return NextResponse.json(
        { error: 'Facebook is not connected for this project.' },
        { status: 400 },
      );
    }

    if (!config.access_token || !config.page_id) {
      return NextResponse.json(
        { error: 'Facebook credentials or Page ID are missing.' },
        { status: 400 },
      );
    }

    const limit = Math.min(
      Number(request.nextUrl.searchParams.get('limit') || 24),
      50,
    );
    const decryptedToken = decrypt(config.access_token);
    const posts = await fetchFacebookPageFeed(decryptedToken, config.page_id, limit);

    return NextResponse.json({
      success: true,
      posts,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

