import type { ProjectContext } from '@/lib/auth/project';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { decrypt, encrypt } from '@/lib/whatsapp/encryption';
import { refreshXToken } from './client';
import type { XConfigSafeRow, XConnectionMethod, XProfileMeta } from './types';

export interface DecryptedXConfig {
  id: string;
  accountId: string;
  projectId: string;
  userId: string;
  connectionMethod: XConnectionMethod;
  xUserId: string | null;
  username: string | null;
  displayName: string | null;
  description: string | null;
  profileImageUrl: string | null;
  followersCount: number;
  followingCount: number;
  tweetCount: number;
  verified: boolean;
  grantedScopes: string[];
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAt: string | null;
  clientId: string | null;
  clientSecret: string | null;
}

export function toSafeXConfig(row: Record<string, unknown> | null): XConfigSafeRow {
  if (!row) {
    return {
      connection_method: 'oauth',
      x_user_id: null,
      username: null,
      display_name: null,
      description: null,
      profile_image_url: null,
      followers_count: 0,
      following_count: 0,
      tweet_count: 0,
      verified: false,
      granted_scopes: [],
      client_id: null,
      has_access_token: false,
      has_refresh_token: false,
      has_client_secret: false,
      token_expires_at: null,
      status: 'disconnected',
      last_error: null,
      connected_at: null,
      last_synced_at: null,
    };
  }

  return {
    id: String(row.id),
    connection_method: row.connection_method === 'token' ? 'token' : 'oauth',
    x_user_id: (row.x_user_id as string | null) ?? null,
    username: (row.username as string | null) ?? null,
    display_name: (row.display_name as string | null) ?? null,
    description: (row.description as string | null) ?? null,
    profile_image_url: (row.profile_image_url as string | null) ?? null,
    followers_count: Number(row.followers_count ?? 0),
    following_count: Number(row.following_count ?? 0),
    tweet_count: Number(row.tweet_count ?? 0),
    verified: Boolean(row.verified),
    granted_scopes: Array.isArray(row.granted_scopes)
      ? (row.granted_scopes as string[])
      : [],
    client_id: (row.client_id as string | null) ?? null,
    has_access_token: Boolean(row.access_token),
    has_refresh_token: Boolean(row.refresh_token),
    has_client_secret: Boolean(row.client_secret),
    token_expires_at: (row.token_expires_at as string | null) ?? null,
    status:
      row.status === 'connected' || row.status === 'error' ? row.status : 'disconnected',
    last_error: (row.last_error as string | null) ?? null,
    connected_at: (row.connected_at as string | null) ?? null,
    last_synced_at: (row.last_synced_at as string | null) ?? null,
  };
}

/**
 * Loads the connected X config for a project and transparently refreshes
 * the OAuth 2.0 access token when a refresh_token is available and expiry is near.
 */
export async function loadActiveXConfig(
  projectId: string,
): Promise<DecryptedXConfig | null> {
  const db = supabaseAdmin();
  const { data: row } = await db
    .from('x_config')
    .select('*')
    .eq('project_id', projectId)
    .eq('status', 'connected')
    .maybeSingle();

  if (!row || !row.access_token) return null;

  let accessToken: string;
  try {
    accessToken = decrypt(row.access_token);
  } catch {
    return null;
  }

  let refreshToken: string | null = null;
  if (row.refresh_token) {
    try {
      refreshToken = decrypt(row.refresh_token);
    } catch {
      refreshToken = null;
    }
  }

  let clientSecret: string | null = null;
  if (row.client_secret) {
    try {
      clientSecret = decrypt(row.client_secret);
    } catch {
      clientSecret = null;
    }
  }

  const effectiveClientId = (row.client_id as string | null) || process.env.X_CLIENT_ID || null;
  const effectiveClientSecret = clientSecret || process.env.X_CLIENT_SECRET || null;
  let tokenExpiresAt = (row.token_expires_at as string | null) ?? null;
  let grantedScopes: string[] = Array.isArray(row.granted_scopes) ? row.granted_scopes : [];

  // Auto-refresh when expiring within 2 minutes
  if (
    tokenExpiresAt &&
    refreshToken &&
    effectiveClientId &&
    new Date(tokenExpiresAt).getTime() - Date.now() < 120_000
  ) {
    try {
      const refreshed = await refreshXToken({
        refreshToken,
        clientId: effectiveClientId,
        clientSecret: effectiveClientSecret,
      });
      accessToken = refreshed.accessToken;
      if (refreshed.refreshToken) refreshToken = refreshed.refreshToken;
      if (refreshed.expiresIn) {
        tokenExpiresAt = new Date(Date.now() + refreshed.expiresIn * 1000).toISOString();
      }
      if (refreshed.scopes.length > 0) grantedScopes = refreshed.scopes;

      await db
        .from('x_config')
        .update({
          access_token: encrypt(accessToken),
          refresh_token: refreshToken ? encrypt(refreshToken) : row.refresh_token,
          token_expires_at: tokenExpiresAt,
          granted_scopes: grantedScopes,
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id);
    } catch (err) {
      console.warn('[x/config-store] auto-refresh failed:', err instanceof Error ? err.message : err);
    }
  }

  return {
    id: row.id,
    accountId: row.account_id,
    projectId: row.project_id,
    userId: row.user_id,
    connectionMethod: row.connection_method === 'token' ? 'token' : 'oauth',
    xUserId: row.x_user_id ?? null,
    username: row.username ?? null,
    displayName: row.display_name ?? null,
    description: row.description ?? null,
    profileImageUrl: row.profile_image_url ?? null,
    followersCount: Number(row.followers_count ?? 0),
    followingCount: Number(row.following_count ?? 0),
    tweetCount: Number(row.tweet_count ?? 0),
    verified: Boolean(row.verified),
    grantedScopes,
    accessToken,
    refreshToken,
    tokenExpiresAt,
    clientId: effectiveClientId,
    clientSecret: effectiveClientSecret,
  };
}

export async function saveXConfig(params: {
  ctx: Pick<ProjectContext, 'accountId' | 'projectId' | 'userId'>;
  connectionMethod: XConnectionMethod;
  profile: XProfileMeta;
  accessToken: string;
  refreshToken?: string | null;
  expiresIn?: number | null;
  clientId?: string | null;
  clientSecret?: string | null;
}) {
  const nowIso = new Date().toISOString();
  const db = supabaseAdmin();
  const { data: existing } = await db
    .from('x_config')
    .select('id, client_id, client_secret, refresh_token, connected_at')
    .eq('project_id', params.ctx.projectId)
    .maybeSingle();

  const tokenExpiresAt =
    params.expiresIn && params.expiresIn > 0
      ? new Date(Date.now() + params.expiresIn * 1000).toISOString()
      : null;

  const payload = {
    account_id: params.ctx.accountId,
    project_id: params.ctx.projectId,
    user_id: params.ctx.userId,
    connection_method: params.connectionMethod,
    x_user_id: params.profile.xUserId,
    username: params.profile.username,
    display_name: params.profile.displayName,
    description: params.profile.description,
    profile_image_url: params.profile.profileImageUrl,
    followers_count: params.profile.followersCount,
    following_count: params.profile.followingCount,
    tweet_count: params.profile.tweetCount,
    verified: params.profile.verified,
    granted_scopes: params.profile.grantedScopes,
    access_token: encrypt(params.accessToken),
    refresh_token: params.refreshToken
      ? encrypt(params.refreshToken)
      : existing?.refresh_token ?? null,
    token_expires_at: tokenExpiresAt,
    client_id:
      params.clientId !== undefined
        ? params.clientId?.trim() || null
        : existing?.client_id ?? null,
    client_secret:
      params.clientSecret !== undefined && params.clientSecret?.trim()
        ? encrypt(params.clientSecret.trim())
        : existing?.client_secret ?? null,
    status: 'connected' as const,
    last_error: null,
    connected_at: existing?.connected_at ?? nowIso,
    last_synced_at: nowIso,
    updated_at: nowIso,
  };

  if (existing?.id) {
    return db
      .from('x_config')
      .update(payload)
      .eq('id', existing.id)
      .select('*')
      .single();
  }

  return db.from('x_config').insert(payload).select('*').single();
}

