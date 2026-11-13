import crypto from 'node:crypto';
import type {
  XDmMessageItem,
  XMentionItem,
  XProfileMeta,
  XTweetItem,
} from './types';

const X_API_BASE = 'https://api.x.com/2';
const X_OAUTH_AUTHORIZE_URL = 'https://twitter.com/i/oauth2/authorize';

export const X_DEFAULT_SCOPES = [
  'tweet.read',
  'tweet.write',
  'users.read',
  'media.write',
  'dm.read',
  'dm.write',
  'offline.access',
];

const CHUNK_SIZE_BYTES = 4 * 1024 * 1024; // 4 MB per APPEND request

export class XApiError extends Error {
  status: number;
  code?: string | number;
  details?: unknown;

  constructor(
    message: string,
    status = 400,
    code?: string | number,
    details?: unknown,
  ) {
    super(message);
    this.name = 'XApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function sanitizeXToken(raw: string): string {
  return raw
    .trim()
    .replace(/^Bearer\s+/i, '')
    .replace(/[\r\n\t\s]+/g, '');
}

export function buildXCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

export function buildXAuthUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scopes?: string[];
}): string {
  const url = new URL(X_OAUTH_AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set(
    'scope',
    (params.scopes && params.scopes.length > 0 ? params.scopes : X_DEFAULT_SCOPES).join(' '),
  );
  url.searchParams.set('state', params.state);
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

function parseXErrorMessage(
  status: number,
  body: Record<string, unknown> | null,
  rawText: string,
): string {
  const title = typeof body?.title === 'string' ? body.title : '';
  const detail =
    typeof body?.detail === 'string'
      ? body.detail
      : typeof body?.error_description === 'string'
        ? body.error_description
        : typeof body?.error === 'string'
          ? body.error
          : '';

  const errorsArr = Array.isArray(body?.errors)
    ? (body.errors as Array<Record<string, unknown>>)
    : [];
  const firstErrMsg =
    typeof errorsArr[0]?.message === 'string' ? errorsArr[0].message : '';

  const combined = [title, detail, firstErrMsg].filter(Boolean).join(': ');
  if (status === 401) {
    return (
      combined ||
      'X Access Token expired or is invalid. Reconnect via OAuth 2.0 or paste a fresh User Access Token.'
    );
  }
  if (status === 403) {
    return combined
      ? `X permission denied (${combined}). Check that your X App has Read & Write permissions and tweet.write / media.write scopes.`
      : 'X permission denied (403). Ensure your X App has Read and Write permissions and the required scopes (tweet.read, tweet.write, users.read, media.write).';
  }
  if (status === 429) {
    return 'X API rate limit reached for your app/plan. Please wait and try again shortly.';
  }
  return combined || rawText.slice(0, 240) || `X API request failed (HTTP ${status})`;
}

async function xFetchJson<T>(
  url: string,
  accessToken: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${sanitizeXToken(accessToken)}`);
  if (init.body && !headers.has('Content-Type') && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, {
    ...init,
    headers,
    cache: 'no-store',
  });

  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    json = null;
  }

  if (!res.ok) {
    throw new XApiError(
      parseXErrorMessage(res.status, json, text),
      res.status,
      typeof json?.status === 'number' ? json.status : res.status,
      json ?? text,
    );
  }

  return (json ?? {}) as T;
}

function buildOAuthTokenHeaders(
  clientId: string,
  clientSecret?: string | null,
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  if (clientSecret && clientSecret.trim()) {
    const basic = Buffer.from(`${clientId.trim()}:${clientSecret.trim()}`, 'utf8').toString(
      'base64',
    );
    headers.Authorization = `Basic ${basic}`;
  }
  return headers;
}

export async function exchangeXCode(params: {
  code: string;
  redirectUri: string;
  clientId: string;
  clientSecret?: string | null;
  codeVerifier: string;
}): Promise<{
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number | null;
  scopes: string[];
}> {
  const form = new URLSearchParams({
    code: params.code,
    grant_type: 'authorization_code',
    client_id: params.clientId.trim(),
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier,
  });

  const res = await fetch(`${X_API_BASE}/oauth2/token`, {
    method: 'POST',
    headers: buildOAuthTokenHeaders(params.clientId, params.clientSecret),
    body: form.toString(),
    cache: 'no-store',
  });

  const text = await res.text();
  const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!res.ok || typeof json.access_token !== 'string') {
    throw new XApiError(
      parseXErrorMessage(res.status, json, text) || 'Failed to exchange X OAuth authorization code.',
      res.status || 400,
    );
  }

  return {
    accessToken: json.access_token,
    refreshToken: typeof json.refresh_token === 'string' ? json.refresh_token : null,
    expiresIn: typeof json.expires_in === 'number' ? json.expires_in : null,
    scopes:
      typeof json.scope === 'string'
        ? json.scope.split(/[\s,]+/).filter(Boolean)
        : [],
  };
}

export async function refreshXToken(params: {
  refreshToken: string;
  clientId: string;
  clientSecret?: string | null;
}): Promise<{
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number | null;
  scopes: string[];
}> {
  const form = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: params.refreshToken,
    client_id: params.clientId.trim(),
  });

  const res = await fetch(`${X_API_BASE}/oauth2/token`, {
    method: 'POST',
    headers: buildOAuthTokenHeaders(params.clientId, params.clientSecret),
    body: form.toString(),
    cache: 'no-store',
  });

  const text = await res.text();
  const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!res.ok || typeof json.access_token !== 'string') {
    throw new XApiError(
      parseXErrorMessage(res.status, json, text) || 'Failed to refresh X OAuth access token.',
      res.status || 401,
    );
  }

  return {
    accessToken: json.access_token,
    refreshToken: typeof json.refresh_token === 'string' ? json.refresh_token : null,
    expiresIn: typeof json.expires_in === 'number' ? json.expires_in : null,
    scopes:
      typeof json.scope === 'string'
        ? json.scope.split(/[\s,]+/).filter(Boolean)
        : [],
  };
}

export async function verifyXToken(
  accessToken: string,
  grantedScopes: string[] = [],
): Promise<XProfileMeta> {
  const res = await xFetchJson<{
    data?: {
      id?: string;
      name?: string;
      username?: string;
      description?: string;
      profile_image_url?: string;
      verified?: boolean;
      public_metrics?: {
        followers_count?: number;
        following_count?: number;
        tweet_count?: number;
      };
    };
  }>(
    `${X_API_BASE}/users/me?user.fields=id,name,username,description,profile_image_url,public_metrics,verified`,
    accessToken,
  );

  const user = res.data;
  if (!user?.id || !user?.username) {
    throw new XApiError(
      'Unable to resolve X user profile from /2/users/me. Check that users.read scope is enabled.',
      400,
    );
  }

  return {
    xUserId: user.id,
    username: user.username,
    displayName: user.name || `@${user.username}`,
    description: user.description ?? null,
    profileImageUrl: user.profile_image_url ?? null,
    followersCount: user.public_metrics?.followers_count ?? 0,
    followingCount: user.public_metrics?.following_count ?? 0,
    tweetCount: user.public_metrics?.tweet_count ?? 0,
    verified: Boolean(user.verified),
    grantedScopes,
  };
}

function resolveXMediaCategory(mimeType: string): {
  mediaCategory: 'tweet_image' | 'tweet_gif' | 'tweet_video';
  normalizedMime: string;
} {
  const clean = mimeType.toLowerCase().split(';')[0].trim();
  if (clean === 'image/gif') {
    return { mediaCategory: 'tweet_gif', normalizedMime: 'image/gif' };
  }
  if (clean.startsWith('video/')) {
    return { mediaCategory: 'tweet_video', normalizedMime: clean || 'video/mp4' };
  }
  return {
    mediaCategory: 'tweet_image',
    normalizedMime: clean.startsWith('image/') ? clean : 'image/jpeg',
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Downloads media from a public URL and uploads it via X API v2 chunked media endpoints.
 * Requires `media.write` scope on the OAuth 2.0 user access token.
 */
export async function uploadXMediaFromUrl(params: {
  accessToken: string;
  mediaUrl: string;
  mimeType?: string;
}): Promise<{ mediaId: string; mediaCategory: string }> {
  const download = await fetch(params.mediaUrl, { cache: 'no-store' });
  if (!download.ok) {
    throw new XApiError(
      `Failed to download media URL for X upload (HTTP ${download.status}). Ensure the URL is publicly accessible.`,
      400,
    );
  }

  const headerType = download.headers.get('content-type') || '';
  const { mediaCategory, normalizedMime } = resolveXMediaCategory(
    params.mimeType || headerType || params.mediaUrl,
  );

  const bytes = Buffer.from(await download.arrayBuffer());
  if (bytes.byteLength === 0) {
    throw new XApiError('Downloaded media file is empty.', 400);
  }
  if (mediaCategory === 'tweet_image' && bytes.byteLength > 5 * 1024 * 1024) {
    throw new XApiError('X image uploads cannot exceed 5 MB.', 400);
  }

  // 1. INITIALIZE
  const initRes = await xFetchJson<{ data?: { id?: string }; media_id_string?: string }>(
    `${X_API_BASE}/media/upload/initialize`,
    params.accessToken,
    {
      method: 'POST',
      body: JSON.stringify({
        media_type: normalizedMime,
        total_bytes: bytes.byteLength,
        media_category: mediaCategory,
      }),
    },
  );

  const mediaId = initRes.data?.id || initRes.media_id_string;
  if (!mediaId) {
    throw new XApiError('X media initialize did not return a media_id.', 502);
  }

  // 2. APPEND chunks
  let segmentIndex = 0;
  for (let offset = 0; offset < bytes.byteLength; offset += CHUNK_SIZE_BYTES) {
    const chunk = bytes.subarray(offset, Math.min(offset + CHUNK_SIZE_BYTES, bytes.byteLength));
    const form = new FormData();
    form.append('segment_index', String(segmentIndex));
    form.append('media', new Blob([chunk], { type: normalizedMime }), `chunk-${segmentIndex}`);

    await xFetchJson(
      `${X_API_BASE}/media/upload/${encodeURIComponent(mediaId)}/append`,
      params.accessToken,
      {
        method: 'POST',
        body: form,
      },
    );
    segmentIndex++;
  }

  // 3. FINALIZE
  const finalizeRes = await xFetchJson<{
    data?: {
      id?: string;
      processing_info?: {
        state?: 'pending' | 'in_progress' | 'succeeded' | 'failed';
        check_after_secs?: number;
        error?: { message?: string };
      };
    };
    processing_info?: {
      state?: 'pending' | 'in_progress' | 'succeeded' | 'failed';
      check_after_secs?: number;
      error?: { message?: string };
    };
  }>(
    `${X_API_BASE}/media/upload/${encodeURIComponent(mediaId)}/finalize`,
    params.accessToken,
    {
      method: 'POST',
    },
  );

  let processing = finalizeRes.data?.processing_info ?? finalizeRes.processing_info;
  let attempts = 0;
  while (
    processing &&
    (processing.state === 'pending' || processing.state === 'in_progress') &&
    attempts < 15
  ) {
    attempts++;
    const waitMs = Math.min(Math.max((processing.check_after_secs ?? 2) * 1000, 1000), 8000);
    await sleep(waitMs);

    const statusRes = await xFetchJson<{
      data?: {
        processing_info?: {
          state?: 'pending' | 'in_progress' | 'succeeded' | 'failed';
          check_after_secs?: number;
          error?: { message?: string };
        };
      };
      processing_info?: {
        state?: 'pending' | 'in_progress' | 'succeeded' | 'failed';
        check_after_secs?: number;
        error?: { message?: string };
      };
    }>(
      `${X_API_BASE}/media/upload?command=STATUS&media_id=${encodeURIComponent(mediaId)}`,
      params.accessToken,
    );
    processing = statusRes.data?.processing_info ?? statusRes.processing_info;
  }

  if (processing?.state === 'failed') {
    throw new XApiError(
      processing.error?.message || 'X media processing failed.',
      400,
    );
  }

  return { mediaId, mediaCategory };
}

export async function publishXPost(params: {
  accessToken: string;
  text: string;
  mediaIds?: string[];
  replyToTweetId?: string;
}): Promise<{ id: string; text: string }> {
  const payload: Record<string, unknown> = {
    text: params.text,
  };

  if (params.mediaIds && params.mediaIds.length > 0) {
    payload.media = {
      media_ids: params.mediaIds.slice(0, 4),
    };
  }

  if (params.replyToTweetId?.trim()) {
    payload.reply = {
      in_reply_to_tweet_id: params.replyToTweetId.trim(),
    };
  }

  const res = await xFetchJson<{ data?: { id?: string; text?: string } }>(
    `${X_API_BASE}/tweets`,
    params.accessToken,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  );

  if (!res.data?.id) {
    throw new XApiError('X /2/tweets did not return a post ID.', 502);
  }

  return {
    id: res.data.id,
    text: res.data.text ?? params.text,
  };
}

export async function deleteXPost(params: {
  accessToken: string;
  tweetId: string;
}): Promise<boolean> {
  const res = await xFetchJson<{ data?: { deleted?: boolean } }>(
    `${X_API_BASE}/tweets/${encodeURIComponent(params.tweetId)}`,
    params.accessToken,
    { method: 'DELETE' },
  );
  return Boolean(res.data?.deleted);
}

export async function fetchXTweets(params: {
  accessToken: string;
  xUserId: string;
  username?: string | null;
  displayName?: string | null;
  limit?: number;
}): Promise<XTweetItem[]> {
  const maxResults = Math.min(Math.max(params.limit ?? 15, 5), 50);
  const url = `${X_API_BASE}/users/${encodeURIComponent(params.xUserId)}/tweets?tweet.fields=created_at,public_metrics&max_results=${maxResults}`;
  const res = await xFetchJson<{
    data?: Array<{
      id: string;
      text: string;
      created_at?: string;
      public_metrics?: {
        like_count?: number;
        retweet_count?: number;
        reply_count?: number;
        impression_count?: number;
      };
    }>;
  }>(url, params.accessToken);

  return (res.data ?? []).map((t) => ({
    id: t.id,
    text: t.text,
    createdAt: t.created_at ?? null,
    permalink: params.username
      ? `https://x.com/${params.username}/status/${t.id}`
      : `https://x.com/i/web/status/${t.id}`,
    likeCount: t.public_metrics?.like_count ?? 0,
    retweetCount: t.public_metrics?.retweet_count ?? 0,
    replyCount: t.public_metrics?.reply_count ?? 0,
    impressionCount: t.public_metrics?.impression_count ?? 0,
    authorUsername: params.username ?? null,
    authorName: params.displayName ?? null,
  }));
}

export async function fetchXMentions(params: {
  accessToken: string;
  xUserId: string;
  limit?: number;
}): Promise<XMentionItem[]> {
  const maxResults = Math.min(Math.max(params.limit ?? 20, 5), 50);
  const url = `${X_API_BASE}/users/${encodeURIComponent(params.xUserId)}/mentions?tweet.fields=created_at,author_id,public_metrics&expansions=author_id&user.fields=id,name,username,profile_image_url&max_results=${maxResults}`;
  const res = await xFetchJson<{
    data?: Array<{
      id: string;
      text: string;
      author_id?: string;
      created_at?: string;
      public_metrics?: {
        reply_count?: number;
        like_count?: number;
      };
    }>;
    includes?: {
      users?: Array<{
        id: string;
        name?: string;
        username?: string;
        profile_image_url?: string;
      }>;
    };
  }>(url, params.accessToken);

  const userMap = new Map(
    (res.includes?.users ?? []).map((u) => [u.id, u]),
  );

  return (res.data ?? []).map((m) => {
    const author = m.author_id ? userMap.get(m.author_id) : undefined;
    return {
      id: m.id,
      text: m.text,
      createdAt: m.created_at ?? null,
      authorId: m.author_id ?? '',
      authorName: author?.name ?? null,
      authorUsername: author?.username ?? null,
      authorProfileImageUrl: author?.profile_image_url ?? null,
      permalink: author?.username
        ? `https://x.com/${author.username}/status/${m.id}`
        : `https://x.com/i/web/status/${m.id}`,
      replyCount: m.public_metrics?.reply_count ?? 0,
      likeCount: m.public_metrics?.like_count ?? 0,
    };
  });
}

export function normalizeXHandle(raw: string): string {
  return raw
    .trim()
    .replace(/^@+/, '')
    .replace(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\//i, '')
    .split(/[/?#]/)[0]
    .trim();
}

export async function lookupXUserByUsername(
  accessToken: string,
  username: string,
): Promise<{
  id: string;
  name: string;
  username: string;
  profileImageUrl?: string | null;
} | null> {
  const clean = normalizeXHandle(username);
  if (!clean) return null;

  try {
    const res = await xFetchJson<{
      data?: {
        id: string;
        name: string;
        username: string;
        profile_image_url?: string;
      };
    }>(
      `${X_API_BASE}/users/by/username/${encodeURIComponent(clean)}?user.fields=id,name,username,profile_image_url`,
      accessToken,
    );

    if (!res.data?.id) return null;
    return {
      id: res.data.id,
      name: res.data.name,
      username: res.data.username,
      profileImageUrl: res.data.profile_image_url ?? null,
    };
  } catch (err) {
    if (err instanceof XApiError && (err.status === 404 || err.status === 400)) {
      return null;
    }
    throw err;
  }
}

export async function sendXDirectMessage(params: {
  accessToken: string;
  participantId: string;
  text: string;
}): Promise<{
  dmConversationId: string;
  dmEventId: string;
}> {
  const cleanText = params.text.trim();
  if (!cleanText) {
    throw new XApiError('Direct message text is required.', 400);
  }

  const res = await xFetchJson<{
    data?: {
      dm_conversation_id?: string;
      dm_event_id?: string;
    };
  }>(
    `${X_API_BASE}/dm_conversations/with/${encodeURIComponent(params.participantId)}/messages`,
    params.accessToken,
    {
      method: 'POST',
      body: JSON.stringify({ text: cleanText }),
    },
  );

  const eventId = res.data?.dm_event_id;
  const convId = res.data?.dm_conversation_id || params.participantId;
  if (!eventId) {
    throw new XApiError('X API did not return a message event ID for DM.', 502);
  }

  return {
    dmConversationId: convId,
    dmEventId: eventId,
  };
}

export async function fetchXDirectMessages(params: {
  accessToken: string;
  maxResults?: number;
}): Promise<XDmMessageItem[]> {
  const limit = Math.min(Math.max(params.maxResults ?? 50, 10), 100);
  const url = `${X_API_BASE}/dm_events?event_types=MessageCreate&max_results=${limit}&dm_event.fields=id,text,created_at,sender_id,dm_conversation_id&expansions=sender_id&user.fields=id,name,username,profile_image_url`;

  const res = await xFetchJson<{
    data?: Array<{
      id: string;
      text?: string;
      created_at?: string;
      sender_id?: string;
      dm_conversation_id?: string;
    }>;
    includes?: {
      users?: Array<{
        id: string;
        name?: string;
        username?: string;
        profile_image_url?: string;
      }>;
    };
  }>(url, params.accessToken);

  const userMap = new Map((res.includes?.users ?? []).map((u) => [u.id, u]));

  return (res.data ?? []).map((ev) => {
    const sender = ev.sender_id ? userMap.get(ev.sender_id) : undefined;
    return {
      id: ev.id,
      conversationId: ev.dm_conversation_id || ev.sender_id || '',
      senderId: ev.sender_id || '',
      text: ev.text ?? '',
      createdAt: ev.created_at ?? null,
      senderUsername: sender?.username ?? null,
      senderName: sender?.name ?? null,
    };
  });
}

