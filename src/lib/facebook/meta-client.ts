/**
 * Meta Graph API calls for the Facebook Page connection.
 *
 * Mirrors src/lib/instagram/meta-client.ts — Facebook Messenger and
 * Instagram DM are the same Messenger Platform, so the credential shape
 * and failure modes are identical.
 */

const GRAPH_VERSION = 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

export interface FacebookPageProfile {
  id: string;
  name: string;
  profilePictureUrl: string | null;
}

interface GraphError {
  error?: { message?: string; type?: string; code?: number };
}

/**
 * Confirm a Page access token works and return the Page it belongs to.
 *
 * A **Page** access token is required, not a User token. Calling `/me`
 * with a User token returns the person, not the Page, and messaging
 * calls would later fail with a confusing permission error — so the
 * token's own identity is what gets read here.
 *
 * Throws with a human-readable message; the caller turns that into a
 * 400 so the operator sees what Meta actually said.
 */
export async function verifyFacebookPageToken(
  accessToken: string,
  pageId?: string,
): Promise<FacebookPageProfile> {
  // Reading the token's identity avoids trusting a caller-supplied id.
  const target = pageId?.trim() || 'me';
  const url =
    `${GRAPH_BASE}/${encodeURIComponent(target)}` +
    `?fields=id,name,picture{url}&access_token=${encodeURIComponent(accessToken)}`;

  let response: Response;
  try {
    response = await fetch(url, {
      // Never cache a credential check.
      cache: 'no-store',
    });
  } catch (err) {
    throw new Error(
      `Could not reach the Meta Graph API: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const payload = (await response.json().catch(() => ({}))) as GraphError & {
    id?: string;
    name?: string;
    picture?: { data?: { url?: string } };
  };

  if (!response.ok || payload.error) {
    const message = payload.error?.message ?? `Graph API returned ${response.status}`;
    throw new Error(`Meta rejected the credentials: ${message}`);
  }

  if (!payload.id) {
    throw new Error('Meta did not return a Page id for this token.');
  }

  // A User token answers /me with a person. Catch it here rather than
  // letting the first send fail hours later.
  if (!payload.name) {
    throw new Error(
      'That token does not resolve to a Facebook Page. Use a Page access token, not a User token.',
    );
  }

  if (pageId?.trim() && payload.id !== pageId.trim()) {
    throw new Error(
      `Token belongs to Page ${payload.id}, which does not match the Page ID you entered.`,
    );
  }

  return {
    id: payload.id,
    name: payload.name,
    profilePictureUrl: payload.picture?.data?.url ?? null,
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
 * Fetch all Facebook Pages associated with a User Access Token.
 */
export async function fetchUserFacebookPages(
  userAccessToken: string,
): Promise<FacebookDiscoveredPage[]> {
  const cleanToken = userAccessToken.trim();
  const url = `${GRAPH_BASE}/me/accounts?fields=id,name,category,access_token,picture{url}&access_token=${encodeURIComponent(cleanToken)}`;

  const response = await fetch(url, { cache: 'no-store' });
  const payload = (await response.json().catch(() => ({}))) as {
    data?: Array<{
      id: string;
      name: string;
      category?: string;
      access_token: string;
      picture?: { data?: { url?: string } };
    }>;
    error?: { message?: string };
  };

  if (!response.ok || payload.error) {
    throw new Error(
      payload.error?.message ?? `Failed to fetch Facebook Pages (${response.status})`,
    );
  }

  const pages = payload.data || [];
  return pages.map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    accessToken: p.access_token,
    profilePictureUrl: p.picture?.data?.url ?? null,
  }));
}
