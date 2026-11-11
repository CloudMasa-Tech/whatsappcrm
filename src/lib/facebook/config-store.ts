import { encrypt } from '@/lib/whatsapp/encryption';
import type { ProjectContext } from '@/lib/auth/project';
import type { FacebookPageProfile } from './meta-client';

const PUBLIC_COLUMNS =
  'id, page_id, page_name, profile_picture_url, status, last_error, connected_at, created_at, updated_at';

/**
 * Shared persistence helper for saving verified Facebook Page credentials into
 * `facebook_config` (migration 058), used by both `/api/facebook/config` and
 * `/api/facebook/oauth`.
 */
export async function saveFacebookPageConfig(params: {
  ctx: ProjectContext;
  profile: FacebookPageProfile;
  fallbackAccessToken: string;
  verifyToken?: string | null;
  appSecret?: string | null;
}) {
  const { ctx, profile, fallbackAccessToken } = params;
  const effectiveToken = profile.pageAccessToken || fallbackAccessToken;
  const verifyToken =
    params.verifyToken?.trim() || `masacrm_fb_${ctx.projectId.slice(0, 8)}`;
  const appSecret = params.appSecret?.trim() || null;
  const now = new Date().toISOString();

  const payload: Record<string, unknown> = {
    account_id: ctx.accountId,
    project_id: ctx.projectId,
    user_id: ctx.userId,
    page_id: profile.id,
    page_name: profile.name,
    profile_picture_url: profile.profilePictureUrl,
    access_token: encrypt(effectiveToken),
    verify_token: encrypt(verifyToken),
    status: 'connected',
    last_error: null,
    connected_at: now,
    updated_at: now,
  };

  if (appSecret) {
    payload.app_secret = encrypt(appSecret);
  }

  return ctx.supabase
    .from('facebook_config')
    .upsert(payload, { onConflict: 'project_id' })
    .select(PUBLIC_COLUMNS)
    .single();
}

