import { NextResponse } from 'next/server';
import { requireProjectRole } from '@/lib/auth/project';
import { toErrorResponse } from '@/lib/auth/account';
import { decrypt } from '@/lib/whatsapp/encryption';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { fetchFacebookPageDetails } from '@/lib/facebook/meta-client';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const ctx = await requireProjectRole('agent');
    const db = supabaseAdmin();

    const { data: config, error: configError } = await db
      .from('facebook_config')
      .select('id, access_token, page_id, page_name, profile_picture_url, status')
      .eq('project_id', ctx.projectId)
      .eq('status', 'connected')
      .maybeSingle();

    if (configError || !config) {
      return NextResponse.json(
        { error: 'Facebook is not connected for this project.' },
        { status: 400 },
      );
    }

    if (!config.access_token) {
      return NextResponse.json(
        { error: 'Facebook Page access token is missing.' },
        { status: 400 },
      );
    }

    const decryptedToken = decrypt(config.access_token);
    const profile = await fetchFacebookPageDetails(
      decryptedToken,
      config.page_id ?? undefined,
    );

    // Update stored page_name and profile_picture_url if changed
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (profile.name && profile.name !== config.page_name) {
      updates.page_name = profile.name;
    }
    if (profile.profilePictureUrl && profile.profilePictureUrl !== config.profile_picture_url) {
      updates.profile_picture_url = profile.profilePictureUrl;
    }

    if (Object.keys(updates).length > 1) {
      await db
        .from('facebook_config')
        .update(updates)
        .eq('project_id', ctx.projectId);
    }

    return NextResponse.json({
      success: true,
      profile: {
        id: profile.id,
        name: profile.name,
        category: profile.category,
        about: profile.about,
        fan_count: profile.fanCount,
        followers_count: profile.followersCount,
        posts_count: profile.postsCount,
        profile_picture_url: profile.profilePictureUrl,
        link: profile.link,
        is_verified: profile.isVerified,
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

