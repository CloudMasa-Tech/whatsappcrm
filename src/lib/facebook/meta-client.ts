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

    throw new Error(
      payload.error?.message ?? `Failed to fetch Facebook Pages (${response.status})`,
    );
  }

  const pages = payload.data || [];
  return pages.map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    accessToken: p.access_token || cleanToken,
    profilePictureUrl: p.picture?.data?.url ?? null,
  }));
}
