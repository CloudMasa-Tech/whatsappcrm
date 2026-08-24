// ============================================================
// Meta Graph API Client for Instagram Messaging
// ============================================================

const GRAPH_API_BASE = "https://graph.facebook.com/v21.0";

export class InstagramMetaError extends Error {
  readonly status: number;
  readonly code?: number;

  constructor(message: string, status = 500, code?: number) {
    super(message);
    this.name = "InstagramMetaError";
    this.status = status;
    this.code = code;
  }
}

/**
 * Validates Meta Access Token and retrieves linked Instagram profile info.
 */
export async function verifyMetaCredentials(
  accessToken: string,
  instagramBusinessId?: string,
): Promise<{
  id: string;
  username: string;
  name: string;
  profilePictureUrl: string;
}> {
  try {
    const targetId = instagramBusinessId?.trim() || "me";
    const fields = "id,name,username,profile_picture_url";

    const res = await fetch(
      `${GRAPH_API_BASE}/${targetId}?fields=${fields}&access_token=${encodeURIComponent(accessToken)}`,
      { cache: "no-store" },
    );

    const data = await res.json();

    if (!res.ok || data.error) {
      const errMsg = data.error?.message || "Failed to verify Meta Instagram credentials.";
      throw new InstagramMetaError(errMsg, res.status, data.error?.code);
    }

    return {
      id: data.id,
      username: data.username || data.name || "Instagram Business",
      name: data.name || data.username || "Instagram Account",
      profilePictureUrl: data.profile_picture_url || "",
    };
  } catch (err) {
    if (err instanceof InstagramMetaError) throw err;
    throw new InstagramMetaError(
      err instanceof Error ? err.message : "Failed to connect to Meta Graph API.",
      500,
    );
  }
}

/**
 * Sends a text message to an Instagram user (IGSID) using Meta Graph API.
 */
export async function sendMetaTextMessage(
  accessToken: string,
  recipientIgsid: string,
  text: string,
): Promise<{ messageId: string }> {
  try {
    const res = await fetch(`${GRAPH_API_BASE}/me/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        recipient: { id: recipientIgsid },
        message: { text: text },
      }),
    });

    const data = await res.json();

    if (!res.ok || data.error) {
      const errMsg = data.error?.message || "Failed to send Instagram message.";
      throw new InstagramMetaError(errMsg, res.status, data.error?.code);
    }

    return {
      messageId: data.message_id || `ig_${Date.now()}`,
    };
  } catch (err) {
    if (err instanceof InstagramMetaError) throw err;
    throw new InstagramMetaError(
      err instanceof Error ? err.message : "Network error communicating with Meta API.",
      500,
    );
  }
}

/**
 * Sends media (image, video, audio) to an Instagram user.
 */
export async function sendMetaMediaMessage(
  accessToken: string,
  recipientIgsid: string,
  mediaUrl: string,
  mediaType: "image" | "video" | "audio" = "image",
): Promise<{ messageId: string }> {
  try {
    const res = await fetch(`${GRAPH_API_BASE}/me/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        recipient: { id: recipientIgsid },
        message: {
          attachment: {
            type: mediaType,
            payload: { url: mediaUrl },
          },
        },
      }),
    });

    const data = await res.json();

    if (!res.ok || data.error) {
      const errMsg = data.error?.message || "Failed to send Instagram media.";
      throw new InstagramMetaError(errMsg, res.status, data.error?.code);
    }

    return {
      messageId: data.message_id || `ig_${Date.now()}`,
    };
  } catch (err) {
    if (err instanceof InstagramMetaError) throw err;
    throw new InstagramMetaError(
      err instanceof Error ? err.message : "Network error communicating with Meta API.",
      500,
    );
  }
}

/**
 * Fetches an Instagram user's profile info (name, username, profile_pic) given their IGSID.
 */
export async function getInstagramUserProfile(
  accessToken: string,
  igsid: string,
): Promise<{ name?: string; username?: string; profilePic?: string } | null> {
  try {
    const res = await fetch(
      `${GRAPH_API_BASE}/${igsid}?fields=name,username,profile_pic&access_token=${encodeURIComponent(accessToken)}`,
    );
    if (!res.ok) return null;
    const data = await res.json();
    return {
      name: data.name,
      username: data.username,
      profilePic: data.profile_pic,
    };
  } catch {
    return null;
  }
}
