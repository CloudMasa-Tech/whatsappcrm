/**
 * Meta Graph API calls for the Facebook Page connection.
 *
 * Mirrors src/lib/instagram/meta-client.ts — supports both direct Page
 * Access Tokens and User Access Tokens (automatically resolving linked Pages
 * and Page Access Tokens via /me/accounts) while rejecting raw User profiles
 * so a personal User ID is never saved in place of a Page ID.
 */

import {
  sanitizeAccessToken,
  validateMetaTokenShape,
} from '@/lib/instagram/meta-client';

const GRAPH_VERSION = 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

export interface FacebookPageProfile {
  id: string;
  name: string;
  profilePictureUrl: string | null;
  category?: string | null;
  pageAccessToken?: string | null;
}

interface GraphError {
  error?: { message?: string; type?: string; code?: number };
}

interface GraphPageNode {
  id?: string;
  name?: string;
  category?: string;
  access_token?: string;
  picture?: { data?: { url?: string } };
  error?: GraphError['error'];
}

function validateFacebookTokenInput(rawToken: string): string {
  const cleanToken = sanitizeAccessToken(rawToken);
  try {
    validateMetaTokenShape(cleanToken);
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : 'Invalid Facebook Access Token.');
  }
  if (/^IG[A-Z0-9]/i.test(cleanToken)) {
    throw new Error(
      'You pasted an Instagram Login token (IGAA...). Facebook Messenger requires a Facebook User or Page Access Token (starts with EAA...).',
    );
  }
  return cleanToken;
}

/**
 * Confirm a Page or User access token resolves to a real Facebook Page and
 * return its Page ID, Page name, avatar, and Page Access Token.
 */
export async function verifyFacebookPageToken(
  accessToken: string,
  pageId?: string,
): Promise<FacebookPageProfile> {
  const cleanToken = validateFacebookTokenInput(accessToken);
  const requestedPageId = pageId?.trim() || '';

  // 1. Check /me/accounts first so a Facebook User Token (EAA...) automatically
  //    resolves to the managed Page and its Page Access Token instead of reading
  //    the personal User profile on /me.
  let accountsSawUserNode = false;
  try {
    const accountsUrl =
      `${GRAPH_BASE}/me/accounts` +
      `?fields=id,name,category,access_token,picture{url}&access_token=${encodeURIComponent(cleanToken)}`;
    const accRes = await fetch(accountsUrl, { cache: 'no-store' });
    const accPayload = (await accRes.json().catch(() => ({}))) as GraphError & {
      data?: GraphPageNode[];
    };

    if (accRes.ok && !accPayload.error) {
      accountsSawUserNode = true;
      const pages = (accPayload.data ?? []).filter((p) => p.id && p.name);

      if (pages.length > 0) {
        if (requestedPageId) {
          const matched = pages.find((p) => p.id === requestedPageId);
          if (!matched) {
            const list = pages
              .slice(0, 5)
              .map((p) => `${p.name} (${p.id})`)
              .join(', ');
            throw new Error(
              `Page ID ${requestedPageId} was not found under this token. Available Pages: ${list}.`,
            );
          }
          return {
            id: matched.id!,
            name: matched.name!,
            category: matched.category ?? null,
            profilePictureUrl: matched.picture?.data?.url ?? null,
            pageAccessToken: matched.access_token || cleanToken,
          };
        }

        if (pages.length === 1) {
          const only = pages[0];
          return {
            id: only.id!,
            name: only.name!,
            category: only.category ?? null,
            profilePictureUrl: only.picture?.data?.url ?? null,
            pageAccessToken: only.access_token || cleanToken,
          };
        }

        const list = pages
          .slice(0, 5)
          .map((p) => `${p.name} (${p.id})`)
          .join(', ');
        throw new Error(
          `Multiple Facebook Pages found (${list}). Enter the Facebook Page ID or use "1-Click Facebook Page Connect" above to choose one.`,
        );
      }

      if (!requestedPageId) {
        // Before throwing "0 Pages", check if the token itself is directly a Page Access Token
        try {
          const meDirectRes = await fetch(
            `${GRAPH_BASE}/me?fields=id,name,category,picture{url}&access_token=${encodeURIComponent(cleanToken)}`,
            { cache: 'no-store' },
          );
          const meDirect = (await meDirectRes.json().catch(() => ({}))) as GraphPageNode;
          if (meDirectRes.ok && meDirect.id && meDirect.name && meDirect.category) {
            return {
              id: meDirect.id,
              name: meDirect.name,
              category: meDirect.category ?? null,
              profilePictureUrl: meDirect.picture?.data?.url ?? null,
              pageAccessToken: cleanToken,
            };
          }
        } catch {
          // fall through
        }

        throw new Error(
          'This Facebook User token returned 0 Pages. Ensure you selected at least one Facebook Page and granted pages_show_list + pages_messaging permissions, or paste a Page Access Token.',
        );
      }
    } else if (accPayload.error && accPayload.error.code !== 100) {
      throw new Error(
        `Meta rejected the credentials: ${accPayload.error.message ?? `Graph API returned ${accRes.status}`}`,
      );
    }
  } catch (err) {
    if (err instanceof Error && !/Failed to parse|fetch failed/i.test(err.message)) {
      if (/Meta rejected|Page ID|Multiple Facebook Pages|0 Pages/i.test(err.message)) {
        throw err;
      }
    } else if (err instanceof Error) {
      throw new Error(`Could not reach the Meta Graph API: ${err.message}`);
    }
  }

  // 2. Direct Page lookup (/me for a Page Access Token, or /{pageId} if specified).
  //    Request `category` so a User node is rejected instead of saved as a Page.
  const target = requestedPageId || 'me';
  const url =
    `${GRAPH_BASE}/${encodeURIComponent(target)}` +
    `?fields=id,name,category,picture{url}&access_token=${encodeURIComponent(cleanToken)}`;

  let response: Response;
  try {
    response = await fetch(url, { cache: 'no-store' });
  } catch (err) {
    throw new Error(
      `Could not reach the Meta Graph API: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const payload = (await response.json().catch(() => ({}))) as GraphPageNode;

  if (!response.ok || payload.error) {
    if (payload.error?.code === 100 && accountsSawUserNode) {
      throw new Error(
        'That token is a User token and cannot access the requested Facebook Page. Select the Page in Graph API Explorer and grant pages_show_list + pages_messaging.',
      );
    }
    if (payload.error?.code === 100 && !requestedPageId) {
      throw new Error(
        'That token is a Facebook User token rather than a Page token. Grant pages_show_list permission or paste a Page Access Token.',
      );
    }
    const message = payload.error?.message ?? `Graph API returned ${response.status}`;
    throw new Error(`Meta rejected the credentials: ${message}`);
  }

  if (!payload.id || !payload.name) {
    throw new Error(
      'That token does not resolve to a Facebook Page. Use a Page Access Token or User Token with Page permissions.',
    );
  }

  if (requestedPageId && payload.id !== requestedPageId) {
    throw new Error(
      `Token belongs to Page ${payload.id}, which does not match the Page ID you entered.`,
    );
  }

  return {
    id: payload.id,
    name: payload.name,
    category: payload.category ?? null,
    profilePictureUrl: payload.picture?.data?.url ?? null,
    pageAccessToken: cleanToken,
  };
}

export interface FacebookUserProfile {
  name: string | null;
  profilePic: string | null;
}

/**
 * Look up a Messenger sender's profile.
 *
 * Best-effort: returns null on any failure. The webhook falls back to a
 * placeholder name rather than dropping the message — an unnamed
 * contact is far better than a lost one.
 */
export async function getFacebookUserProfile(
  pageAccessToken: string,
  psid: string,
): Promise<FacebookUserProfile | null> {
  try {
    const url =
      `${GRAPH_BASE}/${encodeURIComponent(psid)}` +
      `?fields=name,profile_pic&access_token=${encodeURIComponent(pageAccessToken)}`;

    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) return null;

    const data = (await response.json()) as {
      name?: string;
      profile_pic?: string;
    };

    return {
      name: data.name ?? null,
      profilePic: data.profile_pic ?? null,
    };
  } catch {
    return null;
  }
}

export interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Send a Messenger message from the Page to a user (PSID).
 *
 * `messaging_type: RESPONSE` marks this as a reply to user-initiated
 * contact, which is what keeps sends inside Meta's standard messaging
 * window without a paid message tag.
 */
export async function sendFacebookMessage(params: {
  pageAccessToken: string;
  recipientPsid: string;
  text?: string;
  mediaUrl?: string;
  mediaType?: 'image' | 'video' | 'audio' | 'file';
}): Promise<SendResult> {
  const { pageAccessToken, recipientPsid, text, mediaUrl, mediaType } = params;

  const message = mediaUrl
    ? {
        attachment: {
          type: mediaType ?? 'image',
          payload: { url: mediaUrl, is_reusable: true },
        },
      }
    : { text };

  try {
    const response = await fetch(
      `${GRAPH_BASE}/me/messages?access_token=${encodeURIComponent(pageAccessToken)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({
          recipient: { id: recipientPsid },
          messaging_type: 'RESPONSE',
          message,
        }),
      },
    );

    const payload = (await response.json().catch(() => ({}))) as GraphError & {
      message_id?: string;
    };

    if (!response.ok || payload.error) {
      return {
        success: false,
        error: payload.error?.message ?? `Graph API returned ${response.status}`,
      };
    }

    return { success: true, messageId: payload.message_id };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface FacebookDiscoveredPage {
  id: string;
  name: string;
  category?: string;
  accessToken: string;
  profilePictureUrl: string | null;
}

/**
 * Fetch all Facebook Pages associated with a User Access Token, or fall back
 * cleanly when the user pasted a Page Access Token directly.
 */
export async function fetchUserFacebookPages(
  userAccessToken: string,
): Promise<FacebookDiscoveredPage[]> {
  const cleanToken = validateFacebookTokenInput(userAccessToken);
  const url = `${GRAPH_BASE}/me/accounts?fields=id,name,category,access_token,picture{url}&access_token=${encodeURIComponent(cleanToken)}`;

  let response: Response;
  try {
    response = await fetch(url, { cache: 'no-store' });
  } catch (err) {
    throw new Error(
      `Could not reach the Meta Graph API: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const payload = (await response.json().catch(() => ({}))) as {
    data?: Array<{
      id: string;
      name: string;
      category?: string;
      access_token: string;
      picture?: { data?: { url?: string } };
    }>;
    error?: { message?: string; code?: number };
  };

  if (!response.ok || payload.error) {
    // If the user pasted a Page Access Token directly, /me/accounts throws #100
    // ("Tried accessing nonexisting field (accounts) on node type (Page)").
    if (payload.error?.code === 100) {
      const page = await verifyFacebookPageToken(cleanToken);
      return [
        {
          id: page.id,
          name: page.name,
          category: page.category ?? undefined,
          accessToken: page.pageAccessToken || cleanToken,
          profilePictureUrl: page.profilePictureUrl,
        },
      ];
    }

    // Friendly message if the access token has expired (OAuthException #190)
    if (
      payload.error?.code === 190 ||
      payload.error?.message?.toLowerCase().includes('session has expired') ||
      payload.error?.message?.toLowerCase().includes('error validating access token')
    ) {
      throw new Error(
        'Meta Access Token has expired. Please return to Meta Graph API Explorer, click "Generate Access Token" for a fresh token, and select your Facebook Page in the dropdown.',
      );
    }

    throw new Error(
      payload.error?.message ?? `Failed to fetch Facebook Pages (${response.status})`,
    );
  }

  const pages = payload.data || [];
  if (pages.length > 0) {
    return pages.map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      accessToken: p.access_token || cleanToken,
      profilePictureUrl: p.picture?.data?.url ?? null,
    }));
  }

  // 1. If /me/accounts returned 0 pages, check if this token is directly a Page Access Token
  try {
    const directRes = await fetch(
      `${GRAPH_BASE}/me?fields=id,name,category,picture{url}&access_token=${encodeURIComponent(cleanToken)}`,
      { cache: 'no-store' },
    );
    const directPayload = (await directRes.json().catch(() => ({}))) as GraphPageNode;
    if (directRes.ok && directPayload.id && directPayload.name && directPayload.category) {
      return [
        {
          id: directPayload.id,
          name: directPayload.name,
          category: directPayload.category,
          accessToken: cleanToken,
          profilePictureUrl: directPayload.picture?.data?.url ?? null,
        },
      ];
    }
  } catch {
    // ignore
  }

  // 2. Check /me/permissions to see if 'pages_show_list' is missing so we can provide a pinpoint actionable error
  try {
    const permRes = await fetch(
      `${GRAPH_BASE}/me/permissions?access_token=${encodeURIComponent(cleanToken)}`,
      { cache: 'no-store' },
    );
    const permPayload = (await permRes.json().catch(() => ({}))) as {
      data?: Array<{ permission: string; status: string }>;
    };
    if (Array.isArray(permPayload?.data)) {
      const granted = new Set(
        permPayload.data
          .filter((p) => p.status === 'granted')
          .map((p) => p.permission),
      );

      if (!granted.has('pages_show_list')) {
        throw new Error(
          "Your token is missing the 'pages_show_list' permission. In Graph API Explorer, click 'Add a Permission' -> Permissions -> pages_show_list & pages_messaging, then click 'Generate Access Token'.",
        );
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('pages_show_list')) {
      throw err;
    }
  }

  return [];
}

export interface FacebookPublishMediaItem {
  url: string;
  kind: 'image' | 'video' | 'document';
}

export interface FacebookPublishResult {
  postId: string;
  kind: 'feed' | 'photo' | 'multi_photo' | 'video';
}

function mapFacebookPublishError(
  payload: GraphError | undefined,
  status: number,
  fallback: string,
): Error {
  const code = payload?.error?.code;
  const rawMessage = payload?.error?.message ?? `${fallback} (HTTP ${status})`;
  if (
    code === 200 ||
    code === 10 ||
    /pages_manage_posts|permission|requires.*capability/i.test(rawMessage)
  ) {
    return new Error(
      `${rawMessage} — Ensure your Facebook Page token includes the "pages_manage_posts" and "pages_read_engagement" permissions.`,
    );
  }
  return new Error(rawMessage);
}

/**
 * Publishes a post, photo, multi-photo album, or video to a connected Facebook Page.
 */
export async function publishFacebookPagePost(params: {
  pageAccessToken: string;
  pageId: string;
  message?: string;
  linkUrl?: string;
  mediaItems?: FacebookPublishMediaItem[];
}): Promise<FacebookPublishResult> {
  const cleanToken = validateFacebookTokenInput(params.pageAccessToken);
  const pageId = params.pageId.trim();
  if (!pageId) {
    throw new Error('Facebook Page ID is required to publish a post.');
  }

  const caption = params.message?.trim() || '';
  const linkUrl = params.linkUrl?.trim() || '';
  const mediaItems = (params.mediaItems ?? []).filter((m) => m.url?.trim());

  const videoItem = mediaItems.find((m) => m.kind === 'video');
  const imageItems = mediaItems.filter((m) => m.kind === 'image');

  if (videoItem) {
    const res = await fetch(`${GRAPH_BASE}/${encodeURIComponent(pageId)}/videos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({
        file_url: videoItem.url.trim(),
        ...(caption ? { description: caption } : {}),
        access_token: cleanToken,
      }),
    });
    const payload = (await res.json().catch(() => ({}))) as GraphError & { id?: string };
    if (!res.ok || payload.error || !payload.id) {
      throw mapFacebookPublishError(payload, res.status, 'Facebook Video publish failed');
    }
    return { postId: String(payload.id), kind: 'video' };
  }

  if (imageItems.length === 1) {
    const res = await fetch(`${GRAPH_BASE}/${encodeURIComponent(pageId)}/photos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({
        url: imageItems[0].url.trim(),
        ...(caption ? { caption } : {}),
        published: true,
        access_token: cleanToken,
      }),
    });
    const payload = (await res.json().catch(() => ({}))) as GraphError & {
      id?: string;
      post_id?: string;
    };
    const postId = payload.post_id || payload.id;
    if (!res.ok || payload.error || !postId) {
      throw mapFacebookPublishError(payload, res.status, 'Facebook Photo publish failed');
    }
    return { postId: String(postId), kind: 'photo' };
  }

  if (imageItems.length >= 2) {
    const photoIds: string[] = [];
    for (const img of imageItems.slice(0, 10)) {
      const uploadRes = await fetch(
        `${GRAPH_BASE}/${encodeURIComponent(pageId)}/photos`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          cache: 'no-store',
          body: JSON.stringify({
            url: img.url.trim(),
            published: false,
            access_token: cleanToken,
          }),
        },
      );
      const uploadPayload = (await uploadRes.json().catch(() => ({}))) as GraphError & {
        id?: string;
      };
      if (!uploadRes.ok || uploadPayload.error || !uploadPayload.id) {
        throw mapFacebookPublishError(
          uploadPayload,
          uploadRes.status,
          'Facebook multi-photo staging failed',
        );
      }
      photoIds.push(String(uploadPayload.id));
    }

    const feedRes = await fetch(`${GRAPH_BASE}/${encodeURIComponent(pageId)}/feed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({
        ...(caption ? { message: caption } : {}),
        attached_media: photoIds.map((id) => ({ media_fbid: id })),
        access_token: cleanToken,
      }),
    });
    const feedPayload = (await feedRes.json().catch(() => ({}))) as GraphError & {
      id?: string;
    };
    if (!feedRes.ok || feedPayload.error || !feedPayload.id) {
      throw mapFacebookPublishError(
        feedPayload,
        feedRes.status,
        'Facebook multi-photo publish failed',
      );
    }
    return { postId: String(feedPayload.id), kind: 'multi_photo' };
  }

  if (!caption && !linkUrl) {
    throw new Error('Provide text, a link URL, or media to post on Facebook.');
  }

  const res = await fetch(`${GRAPH_BASE}/${encodeURIComponent(pageId)}/feed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({
      ...(caption ? { message: caption } : {}),
      ...(linkUrl ? { link: linkUrl } : {}),
      access_token: cleanToken,
    }),
  });
  const payload = (await res.json().catch(() => ({}))) as GraphError & { id?: string };
  if (!res.ok || payload.error || !payload.id) {
    throw mapFacebookPublishError(payload, res.status, 'Facebook Feed publish failed');
  }
  return { postId: String(payload.id), kind: 'feed' };
}
