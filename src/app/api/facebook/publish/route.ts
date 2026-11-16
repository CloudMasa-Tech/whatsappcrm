import { NextRequest, NextResponse } from 'next/server';
import { requireProjectRole } from '@/lib/auth/project';
import { toErrorResponse } from '@/lib/auth/account';
import { decrypt } from '@/lib/whatsapp/encryption';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  publishFacebookPagePost,
  FacebookPublishMediaItem,
} from '@/lib/facebook/meta-client';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireProjectRole('agent');
    const body = (await request.json().catch(() => null)) as {
      type?: 'feed' | 'photo' | 'carousel' | 'video';
      message?: string;
      linkUrl?: string;
      mediaUrl?: string;
      mediaItems?: Array<{ url: string; kind?: 'image' | 'video' | 'document' }>;
    } | null;

    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { data: config, error: configError } = await supabaseAdmin()
      .from('facebook_config')
      .select('access_token, page_id, status')
      .eq('project_id', ctx.projectId)
      .eq('status', 'connected')
      .maybeSingle();

    if (configError || !config) {
      return NextResponse.json(
        { error: 'Facebook account is not connected for this project.' },
        { status: 400 },
      );
    }

    if (!config.access_token || !config.page_id) {
      return NextResponse.json(
        { error: 'Facebook Page credentials are missing.' },
        { status: 400 },
      );
    }

    const decryptedToken = decrypt(config.access_token);
    const type = body.type || 'feed';
    const message = body.message?.trim() || '';
    const linkUrl = body.linkUrl?.trim() || '';

    let mediaItems: FacebookPublishMediaItem[] = [];

    if (type === 'carousel') {
      const items = Array.isArray(body.mediaItems) ? body.mediaItems : [];
      if (items.length < 2) {
        return NextResponse.json(
          { error: 'Carousel posts require at least 2 photos.' },
          { status: 400 },
        );
      }
      mediaItems = items.map((it) => ({
        url: it.url,
        kind: 'image',
      }));
    } else if (type === 'video') {
      const videoUrl = body.mediaUrl || body.mediaItems?.[0]?.url;
      if (!videoUrl) {
        return NextResponse.json(
          { error: 'A video URL is required to publish a Facebook video post.' },
          { status: 400 },
        );
      }
      mediaItems = [{ url: videoUrl, kind: 'video' }];
    } else if (type === 'photo') {
      const photoUrl = body.mediaUrl || body.mediaItems?.[0]?.url;
      if (!photoUrl) {
        return NextResponse.json(
          { error: 'A photo URL is required to publish a Facebook photo post.' },
          { status: 400 },
        );
      }
      mediaItems = [{ url: photoUrl, kind: 'image' }];
    }

    const result = await publishFacebookPagePost({
      pageAccessToken: decryptedToken,
      pageId: config.page_id,
      message: message || undefined,
      linkUrl: linkUrl || undefined,
      mediaItems: mediaItems.length > 0 ? mediaItems : undefined,
    });

    return NextResponse.json({
      success: true,
      postId: result.postId,
      kind: result.kind,
      permalinkUrl: `https://www.facebook.com/${result.postId}`,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

