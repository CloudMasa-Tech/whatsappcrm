// ============================================================
// Meta Graph API Client for Instagram Messaging & Publishing
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
    const cleanToken = accessToken.trim();

    // If specific Instagram Business ID was provided
    if (instagramBusinessId?.trim()) {
      const igId = instagramBusinessId.trim();
      const res = await fetch(
        `${GRAPH_API_BASE}/${igId}?fields=id,name,username,profile_picture_url&access_token=${encodeURIComponent(cleanToken)}`,
        { cache: "no-store" },
      );
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new InstagramMetaError(data.error?.message || "Failed to verify Instagram Business ID.", res.status, data.error?.code);
      }
      return {
        id: data.id,
        username: data.username || data.name || "instagram_business",
        name: data.name || data.username || "Instagram Business",
        profilePictureUrl: data.profile_picture_url || "",
      };
    }

    // Otherwise check /me
    const meRes = await fetch(
      `${GRAPH_API_BASE}/me?fields=id,name,username,profile_picture_url,accounts{id,name,access_token,instagram_business_account{id,name,username,profile_picture_url}}&access_token=${encodeURIComponent(cleanToken)}`,
      { cache: "no-store" },
    );
    const meData = await meRes.json();

    if (!meRes.ok || meData.error) {
      const errMsg = meData.error?.message || "Invalid Meta Access Token.";
      throw new InstagramMetaError(errMsg, meRes.status, meData.error?.code);
    }

    // Check if me has direct instagram_business_account or linked in pages
    if (meData.accounts?.data?.length > 0) {
      for (const page of meData.accounts.data) {
        if (page.instagram_business_account) {
          const ig = page.instagram_business_account;
          return {
            id: ig.id,
            username: ig.username || ig.name || "instagram_business",
            name: ig.name || ig.username || page.name,
            profilePictureUrl: ig.profile_picture_url || "",
          };
        }
      }
    }

    if (meData.username || meData.name) {
      return {
        id: meData.id,
        username: meData.username || meData.name || "Instagram Account",
        name: meData.name || meData.username || "Instagram Account",
        profilePictureUrl: meData.profile_picture_url || "",
      };
    }

    throw new InstagramMetaError(
      "No Instagram Professional / Business account linked to this Meta token. Please ensure your Instagram account is converted to Business and linked to your Facebook Page.",
      400,
    );
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

/**
 * Publishes a Photo or Video Post to Instagram using Meta Graph API.
 */
export async function publishInstagramPost(
  accessToken: string,
  instagramBusinessId: string,
  imageUrl: string,
  caption?: string,
): Promise<{ mediaId: string }> {
  const targetId = instagramBusinessId.trim() || "me";

  // Step 1: Create media container
  const createUrl = new URL(`${GRAPH_API_BASE}/${targetId}/media`);
  createUrl.searchParams.set("image_url", imageUrl);
  if (caption) createUrl.searchParams.set("caption", caption);
  createUrl.searchParams.set("access_token", accessToken);

  const createRes = await fetch(createUrl.toString(), { method: "POST" });
  const createData = await createRes.json();

  if (!createRes.ok || createData.error) {
    throw new InstagramMetaError(
      createData.error?.message || "Failed to create Instagram photo container.",
      createRes.status,
      createData.error?.code,
    );
  }

  const creationId = createData.id;

  // Step 2: Publish media container
  const publishUrl = new URL(`${GRAPH_API_BASE}/${targetId}/media_publish`);
  publishUrl.searchParams.set("creation_id", creationId);
  publishUrl.searchParams.set("access_token", accessToken);

  const publishRes = await fetch(publishUrl.toString(), { method: "POST" });
  const publishData = await publishRes.json();

  if (!publishRes.ok || publishData.error) {
    throw new InstagramMetaError(
      publishData.error?.message || "Failed to publish Instagram post.",
      publishRes.status,
      publishData.error?.code,
    );
  }

  return { mediaId: publishData.id };
}

/**
 * Publishes a Reel to Instagram using Meta Graph API.
 */
export async function publishInstagramReel(
  accessToken: string,
  instagramBusinessId: string,
  videoUrl: string,
  caption?: string,
  shareToFeed = true,
): Promise<{ mediaId: string }> {
  const targetId = instagramBusinessId.trim() || "me";

  // Step 1: Create reel container
  const createUrl = new URL(`${GRAPH_API_BASE}/${targetId}/media`);
  createUrl.searchParams.set("media_type", "REELS");
  createUrl.searchParams.set("video_url", videoUrl);
  if (caption) createUrl.searchParams.set("caption", caption);
  if (shareToFeed) createUrl.searchParams.set("share_to_feed", "true");
  createUrl.searchParams.set("access_token", accessToken);

  const createRes = await fetch(createUrl.toString(), { method: "POST" });
  const createData = await createRes.json();

  if (!createRes.ok || createData.error) {
    throw new InstagramMetaError(
      createData.error?.message || "Failed to create Instagram Reel container.",
      createRes.status,
      createData.error?.code,
    );
  }

  const creationId = createData.id;

  // Step 2: Poll container status until ready
  let isReady = false;
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const statusUrl = `${GRAPH_API_BASE}/${creationId}?fields=status_code&access_token=${encodeURIComponent(accessToken)}`;
    const statusRes = await fetch(statusUrl);
    const statusData = await statusRes.json();

    if (statusData.status_code === "FINISHED") {
      isReady = true;
      break;
    } else if (statusData.status_code === "ERROR") {
      throw new InstagramMetaError(
        "Instagram Reel processing encountered an error during transcoding.",
        400,
      );
    }
  }

  if (!isReady) {
    // Attempt publish even if polling timed out
  }

  // Step 3: Publish Reel
  const publishUrl = new URL(`${GRAPH_API_BASE}/${targetId}/media_publish`);
  publishUrl.searchParams.set("creation_id", creationId);
  publishUrl.searchParams.set("access_token", accessToken);

  const publishRes = await fetch(publishUrl.toString(), { method: "POST" });
  const publishData = await publishRes.json();

  if (!publishRes.ok || publishData.error) {
    throw new InstagramMetaError(
      publishData.error?.message || "Failed to publish Instagram Reel.",
      publishRes.status,
      publishData.error?.code,
    );
  }

  return { mediaId: publishData.id };
}
