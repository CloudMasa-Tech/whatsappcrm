// ============================================================
// Meta Graph API & Instagram Login API Client
//
// Supports BOTH Meta token types seamlessly:
//   1. Facebook Page / Graph API Token (EAAB...) -> graph.facebook.com/v21.0
//   2. Instagram API with Instagram Login (IGA...) -> graph.instagram.com/v21.0
//
// Covers the full Instagram app action set:
//   - Credential verification, Page Token resolution & scope discovery
//   - Publishing: Photo Post, Video Reel, Carousel Album, and 24h Stories
//   - Feed Grid, Active Stories, Tags/Mentions, Caption & Comment toggles
//   - Comments: List, Reply, Hide/Unhide, Delete & Private DM Reply (comment_id)
//   - Account & Media Insights
//   - 2-Way Direct Messages, Quoted Replies, Emoji Reactions & Thread History Sync
// ============================================================

import type {
  InstagramCommentItem,
  InstagramInsightMetric,
  InstagramMediaItem,
  InstagramProfileMeta,
  InstagramStoryItem,
  InstagramTokenType,
} from "./types";

const GRAPH_FB_BASE = "https://graph.facebook.com/v21.0";
const GRAPH_IG_BASE = "https://graph.instagram.com/v21.0";

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

export function sanitizeAccessToken(raw: string): string {
  let clean = raw.trim();

  // Strip accidental surrounding quotes from copy-paste
  if (
    (clean.startsWith('"') && clean.endsWith('"')) ||
    (clean.startsWith("'") && clean.endsWith("'"))
  ) {
    clean = clean.slice(1, -1).trim();
  }

  // Strip "Bearer " header prefix if copied from HTTP docs/headers
  clean = clean.replace(/^Bearer\s+/i, "").trim();

  // Extract token if user pasted an entire OAuth redirect URL (#access_token=...)
  const urlMatch = clean.match(/(?:[?#&]|^)access_token=([^&\s#]+)/i);
  if (urlMatch?.[1]) {
    clean = decodeURIComponent(urlMatch[1]).trim();
  }

  // Strip Facebook OAuth trailing fragment and accidental spaces/line-breaks
  // (single-line <input> converts wrapped newlines into spaces on paste).
  clean = clean.replace(/#_=_$/, "").replace(/\s+/g, "").trim();
  return clean;
}

export function validateMetaTokenShape(token: string): void {
  if (!token) {
    throw new InstagramMetaError("Meta Access Token is required.", 400, 190);
  }
  if (/^\d+\|[A-Za-z0-9._-]+$/.test(token)) {
    throw new InstagramMetaError(
      "You pasted an App/Client Token (APP_ID|SECRET). Paste a User/Page/Instagram Access Token (starts with IGAA.../IGA... or EAAB...) instead.",
      400,
      190,
    );
  }
  if (/^[a-f0-9]{32}$/i.test(token)) {
    throw new InstagramMetaError(
      "You pasted a 32-character App Secret in the Access Token field. Paste your Instagram/Meta Access Token here and enter the 32-character secret under Meta App Secret.",
      400,
      190,
    );
  }
  if (/\s/.test(token) || token.length < 20) {
    throw new InstagramMetaError(
      "Invalid Access Token format. Copy the complete generated token from Meta Developers (typically starts with IGAA.../IGA... or EAAB.../EAA...).",
      400,
      190,
    );
  }
}

export function detectTokenType(
  accessToken: string,
  explicit?: InstagramTokenType | null,
): InstagramTokenType {
  const clean = sanitizeAccessToken(accessToken);
  if (explicit === "instagram_login" || explicit === "facebook_page") {
    return explicit;
  }
  if (/^IG[A-Z0-9]/i.test(clean)) {
    return "instagram_login";
  }
  return "facebook_page";
}

export function graphBaseFor(tokenType: InstagramTokenType): string {
  return tokenType === "instagram_login" ? GRAPH_IG_BASE : GRAPH_FB_BASE;
}

interface MetaGraphIgNode {
  id?: string;
  user_id?: string;
  username?: string;
  name?: string;
  profile_picture_url?: string;
  biography?: string;
  website?: string;
  followers_count?: number;
  follows_count?: number;
  media_count?: number;
  instagram_business_account?: MetaGraphIgNode;
  connected_instagram_account?: MetaGraphIgNode;
  accounts?: {
    data?: Array<{
      id?: string;
      name?: string;
      access_token?: string;
      instagram_business_account?: MetaGraphIgNode;
      connected_instagram_account?: MetaGraphIgNode;
    }>;
  };
}

async function metaFetchJson<T = Record<string, unknown>>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      cache: "no-store",
      signal: init?.signal ?? AbortSignal.timeout(15_000),
      ...init,
    });
  } catch (err) {
    const msg =
      err instanceof Error && err.name === "TimeoutError"
        ? "Timed out waiting for Meta API to respond."
        : "Could not reach Meta API (network connection error).";
    throw new InstagramMetaError(msg, 502);
  }
  const data = (await res.json().catch(() => ({}))) as {
    error?: { error_user_msg?: string; message?: string; code?: number };
  };
  if (!res.ok || data?.error) {
    const errMsg =
      data?.error?.error_user_msg ||
      data?.error?.message ||
      `Meta API request failed (HTTP ${res.status})`;
    throw new InstagramMetaError(errMsg, res.status || 400, data?.error?.code);
  }
  return data as T;
}

async function fetchInstagramLoginProfile(cleanToken: string): Promise<InstagramProfileMeta> {
  const fullFields =
    "id,user_id,username,name,account_type,profile_picture_url,biography,website,followers_count,follows_count,media_count";
  const basicFields = "id,user_id,username,name,account_type,profile_picture_url";

  let meData: MetaGraphIgNode;
  try {
    meData = await metaFetchJson<MetaGraphIgNode>(
      `${GRAPH_IG_BASE}/me?fields=${fullFields}&access_token=${encodeURIComponent(cleanToken)}`,
    );
  } catch (err) {
    // Some Instagram Login tokens omit extended metrics/bio fields on /me (code 100), not auth failure (code 190).
    if (err instanceof InstagramMetaError && err.code !== 190) {
      meData = await metaFetchJson<MetaGraphIgNode>(
        `${GRAPH_IG_BASE}/me?fields=${basicFields}&access_token=${encodeURIComponent(cleanToken)}`,
      );
    } else {
      throw err;
    }
  }

  const igId = String(meData.user_id || meData.id || "");
  if (!igId) {
    throw new InstagramMetaError("Could not resolve Instagram account ID from token.", 400);
  }

  return {
    id: igId,
    username: meData.username || meData.name || "instagram_business",
    name: meData.name || meData.username || "Instagram Professional",
    profilePictureUrl: meData.profile_picture_url || "",
    biography: meData.biography ?? null,
    website: meData.website ?? null,
    followersCount: typeof meData.followers_count === "number" ? meData.followers_count : null,
    followingCount: typeof meData.follows_count === "number" ? meData.follows_count : null,
    mediaCount: typeof meData.media_count === "number" ? meData.media_count : null,
    isVerified: false,
    pageId: null,
    pageAccessToken: null,
    tokenType: "instagram_login",
    grantedScopes: [],
  };
}

/**
 * Validates Meta Access Token (auto-detecting EAAB Facebook-linked or IGA Instagram Login),
 * extracts linked Page Access Token when a Facebook User Token is submitted,
 * and returns normalized Instagram Professional profile details.
 */
export async function verifyMetaCredentials(
  accessToken: string,
  instagramBusinessId?: string,
  explicitTokenType?: InstagramTokenType | null,
  preferredPageId?: string | null,
): Promise<InstagramProfileMeta> {
  const cleanToken = sanitizeAccessToken(accessToken);
  validateMetaTokenShape(cleanToken);

  const prefixType: InstagramTokenType | null = /^IG[A-Z0-9]/i.test(cleanToken)
    ? "instagram_login"
    : /^EAA/i.test(cleanToken)
      ? "facebook_page"
      : null;

  const guessedType = detectTokenType(cleanToken, prefixType ?? explicitTokenType);

  if (guessedType === "instagram_login") {
    try {
      return await fetchInstagramLoginProfile(cleanToken);
    } catch (igErr) {
      if (igErr instanceof InstagramMetaError && !prefixType) {
        try {
          return await verifyFacebookGraphCredentials(
            cleanToken,
            instagramBusinessId,
            preferredPageId,
          );
        } catch {
          throw igErr;
        }
      }
      throw igErr;
    }
  }

  return verifyFacebookGraphCredentials(
    cleanToken,
    instagramBusinessId,
    preferredPageId,
    !prefixType,
  );
}

async function verifyFacebookGraphCredentials(
  cleanToken: string,
  instagramBusinessId?: string,
  preferredPageId?: string | null,
  allowIgFallback = false,
): Promise<InstagramProfileMeta> {
  try {
    const fullIgFields =
      "id,name,username,profile_picture_url,biography,website,followers_count,follows_count,media_count";
    const safeIgFields = "id,name,username,profile_picture_url";

    // Best-effort permissions list (User tokens expose /me/permissions; Page tokens may not)
    let grantedScopes: string[] = [];
    try {
      const perms = await metaFetchJson<{ data?: Array<{ permission: string; status: string }> }>(
        `${GRAPH_FB_BASE}/me/permissions?access_token=${encodeURIComponent(cleanToken)}`,
      );
      grantedScopes = (perms.data ?? [])
        .filter((p) => p.status === "granted")
        .map((p) => p.permission);
    } catch {
      // Non-fatal for Page Access Tokens
    }

    // 1. Probe /me with universal fields (id, name only — Facebook User and Page nodes
    //    do NOT expose username or profile_picture_url directly on /me).
    let meBasic: { id?: string; name?: string } | null = null;
    try {
      meBasic = await metaFetchJson<{ id?: string; name?: string }>(
        `${GRAPH_FB_BASE}/me?fields=id,name&access_token=${encodeURIComponent(cleanToken)}`,
      );
    } catch (meErr) {
      if (allowIgFallback && meErr instanceof InstagramMetaError) {
        try {
          return await fetchInstagramLoginProfile(cleanToken);
        } catch {
          throw meErr;
        }
      }
      throw meErr;
    }

    let resolvedPageId: string | null = preferredPageId?.trim() || null;
    let resolvedPageToken: string | null = null;
    let resolvedIg: MetaGraphIgNode | null = null;

    type PageEdgeItem = {
      id?: string;
      name?: string;
      access_token?: string;
      instagram_business_account?: MetaGraphIgNode;
      connected_instagram_account?: MetaGraphIgNode;
    };

    const pickIgFromPage = (page: PageEdgeItem): MetaGraphIgNode | null => {
      const ig = page.instagram_business_account ?? page.connected_instagram_account;
      if (!ig?.id) return null;
      if (instagramBusinessId?.trim() && ig.id !== instagramBusinessId.trim()) return null;
      if (preferredPageId?.trim() && page.id !== preferredPageId.trim()) return null;
      return ig;
    };

    // 2. Case A: Facebook User / System User Token -> query /me/accounts (Pages + IG links)
    let pages: PageEdgeItem[] = [];
    try {
      let accRes: { data?: PageEdgeItem[] };
      try {
        accRes = await metaFetchJson<{ data?: PageEdgeItem[] }>(
          `${GRAPH_FB_BASE}/me/accounts?fields=id,name,access_token,instagram_business_account{${fullIgFields}},connected_instagram_account{${safeIgFields}}&access_token=${encodeURIComponent(cleanToken)}`,
        );
      } catch (err) {
        if (err instanceof InstagramMetaError && err.code === 100) {
          accRes = await metaFetchJson<{ data?: PageEdgeItem[] }>(
            `${GRAPH_FB_BASE}/me/accounts?fields=id,name,access_token,instagram_business_account{${safeIgFields}},connected_instagram_account{${safeIgFields}}&access_token=${encodeURIComponent(cleanToken)}`,
          );
        } else {
          throw err;
        }
      }
      pages = accRes.data ?? [];
      for (const page of pages) {
        const ig = pickIgFromPage(page);
        if (ig) {
          resolvedIg = ig;
          resolvedPageId = page.id || resolvedPageId;
          resolvedPageToken = page.access_token || null;
          break;
        }
      }

      // If Pages exist but inline expansion missed IG fields, query each Page directly using its Page token
      if (!resolvedIg && pages.length > 0) {
        for (const page of pages) {
          if (!page.id) continue;
          if (preferredPageId?.trim() && page.id !== preferredPageId.trim()) continue;
          const pageToken = page.access_token || cleanToken;
          try {
            const pageNode = await metaFetchJson<MetaGraphIgNode>(
              `${GRAPH_FB_BASE}/${page.id}?fields=id,name,instagram_business_account{${safeIgFields}},connected_instagram_account{${safeIgFields}}&access_token=${encodeURIComponent(pageToken)}`,
            );
            const ig =
              pageNode.instagram_business_account ?? pageNode.connected_instagram_account;
            if (ig?.id && (!instagramBusinessId?.trim() || ig.id === instagramBusinessId.trim())) {
              resolvedIg = ig;
              resolvedPageId = page.id;
              resolvedPageToken = page.access_token || null;
              break;
            }
          } catch {
            // Try next Page
          }
        }
      }
    } catch {
      // Expected on Page Access Tokens (/me is a Page node, which has no /accounts edge)
    }

    // 3. Case B: Already a Page Access Token (/me returns the Page with linked IG account)
    if (!resolvedIg && pages.length === 0) {
      try {
        let pageMe: MetaGraphIgNode;
        try {
          pageMe = await metaFetchJson<MetaGraphIgNode>(
            `${GRAPH_FB_BASE}/me?fields=id,name,instagram_business_account{${fullIgFields}},connected_instagram_account{${safeIgFields}}&access_token=${encodeURIComponent(cleanToken)}`,
          );
        } catch (err) {
          if (err instanceof InstagramMetaError && err.code === 100) {
            pageMe = await metaFetchJson<MetaGraphIgNode>(
              `${GRAPH_FB_BASE}/me?fields=id,name,instagram_business_account{${safeIgFields}},connected_instagram_account{${safeIgFields}}&access_token=${encodeURIComponent(cleanToken)}`,
            );
          } else {
            throw err;
          }
        }
        const ig = pageMe.instagram_business_account ?? pageMe.connected_instagram_account;
        if (ig?.id) {
          resolvedIg = ig;
          resolvedPageId = pageMe.id || meBasic?.id || resolvedPageId;
          resolvedPageToken = cleanToken;
        }
      } catch {
        // Not a Page node or no linked IG edge; fall through to IG ID / IGUser fallback
      }
    }

    // 4. Case C: Explicit Instagram Business ID override
    if (!resolvedIg && instagramBusinessId?.trim()) {
      try {
        resolvedIg = await metaFetchJson<MetaGraphIgNode>(
          `${GRAPH_FB_BASE}/${instagramBusinessId.trim()}?fields=${fullIgFields}&access_token=${encodeURIComponent(cleanToken)}`,
        );
      } catch (err) {
        if (err instanceof InstagramMetaError && err.code === 100) {
          resolvedIg = await metaFetchJson<MetaGraphIgNode>(
            `${GRAPH_FB_BASE}/${instagramBusinessId.trim()}?fields=${safeIgFields}&access_token=${encodeURIComponent(cleanToken)}`,
          );
        } else {
          throw err;
        }
      }
    }

    // 5. Fallback when token itself scopes an IGUser directly or has a non-empty connected IG profile
    if (!resolvedIg && pages.length === 0 && !instagramBusinessId?.trim()) {
      try {
        const directIgNode = await metaFetchJson<MetaGraphIgNode>(
          `${GRAPH_FB_BASE}/me?fields=${safeIgFields}&access_token=${encodeURIComponent(cleanToken)}`,
        );
        if (directIgNode.username && directIgNode.id) {
          resolvedIg = directIgNode;
        }
      } catch {
        // Ignore (#100) when /me is a User/Page node without username/profile_picture_url
      }
    }

    if (resolvedIg) {
      return {
        id: String(resolvedIg.id),
        username: resolvedIg.username || resolvedIg.name || "instagram_business",
        name: resolvedIg.name || resolvedIg.username || "Instagram Business",
        profilePictureUrl: resolvedIg.profile_picture_url || "",
        biography: resolvedIg.biography ?? null,
        website: resolvedIg.website ?? null,
        followersCount: typeof resolvedIg.followers_count === "number" ? resolvedIg.followers_count : null,
        followingCount: typeof resolvedIg.follows_count === "number" ? resolvedIg.follows_count : null,
        mediaCount: typeof resolvedIg.media_count === "number" ? resolvedIg.media_count : null,
        pageId: resolvedPageId,
        pageAccessToken: resolvedPageToken,
        tokenType: "facebook_page",
        grantedScopes,
      };
    }

    if (pages.length > 0) {
      const pageNames = pages.map((p) => p.name || p.id).filter(Boolean).slice(0, 5).join(", ");
      throw new InstagramMetaError(
        `Found Facebook Page(s) (${pageNames}), but none have a linked Instagram Professional/Business account visible to this token. Link your Instagram account to the Facebook Page in Meta Business Suite, or ensure instagram_basic & pages_read_engagement permissions are granted.`,
        400,
      );
    }

    throw new InstagramMetaError(
      "No Instagram Professional / Business account linked to this Meta token. Ensure pages_show_list, instagram_basic, and pages_read_engagement permissions are granted and your Instagram account is linked to your Facebook Page, or use an Instagram Login token (IGAA...).",
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

// ============================================================
// Media Container Polling Helper (Reels / Videos / Stories)
// ============================================================

async function waitForContainerReady(
  base: string,
  creationId: string,
  accessToken: string,
  maxAttempts = 20,
): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const statusData = await metaFetchJson<{ status_code?: string; status?: string }>(
      `${base}/${creationId}?fields=status_code,status&access_token=${encodeURIComponent(accessToken)}`,
    );
    if (statusData.status_code === "FINISHED" || statusData.status_code === "PUBLISHED") {
      return;
    }
    if (statusData.status_code === "ERROR" || statusData.status_code === "EXPIRED") {
      throw new InstagramMetaError(
        `Instagram media processing failed (${statusData.status || statusData.status_code}). Ensure media meets Meta aspect ratio & codec rules.`,
        400,
      );
    }
  }
  throw new InstagramMetaError(
    "Instagram media processing timed out before publishing. Please retry with a smaller/H.264 MP4 file.",
    504,
  );
}

// ============================================================
// Publishing: Post, Reel, Carousel & Story
// ============================================================

export async function publishInstagramPost(
  accessToken: string,
  instagramBusinessId: string,
  imageUrl: string,
  caption?: string,
  tokenType?: InstagramTokenType | null,
): Promise<{ mediaId: string }> {
  const type = detectTokenType(accessToken, tokenType);
  const base = graphBaseFor(type);
  const targetId = instagramBusinessId.trim() || "me";

  const createUrl = new URL(`${base}/${targetId}/media`);
  createUrl.searchParams.set("image_url", imageUrl);
  if (caption) createUrl.searchParams.set("caption", caption);
  createUrl.searchParams.set("access_token", accessToken);

  const createData = await metaFetchJson<{ id: string }>(createUrl.toString(), { method: "POST" });

  const publishUrl = new URL(`${base}/${targetId}/media_publish`);
  publishUrl.searchParams.set("creation_id", createData.id);
  publishUrl.searchParams.set("access_token", accessToken);

  const publishData = await metaFetchJson<{ id: string }>(publishUrl.toString(), { method: "POST" });
  return { mediaId: publishData.id };
}

export async function publishInstagramReel(
  accessToken: string,
  instagramBusinessId: string,
  videoUrl: string,
  caption?: string,
  shareToFeed = true,
  tokenType?: InstagramTokenType | null,
): Promise<{ mediaId: string }> {
  const type = detectTokenType(accessToken, tokenType);
  const base = graphBaseFor(type);
  const targetId = instagramBusinessId.trim() || "me";

  const createUrl = new URL(`${base}/${targetId}/media`);
  createUrl.searchParams.set("media_type", "REELS");
  createUrl.searchParams.set("video_url", videoUrl);
  if (caption) createUrl.searchParams.set("caption", caption);
  createUrl.searchParams.set("share_to_feed", shareToFeed ? "true" : "false");
  createUrl.searchParams.set("access_token", accessToken);

  const createData = await metaFetchJson<{ id: string }>(createUrl.toString(), { method: "POST" });
  await waitForContainerReady(base, createData.id, accessToken);

  const publishUrl = new URL(`${base}/${targetId}/media_publish`);
  publishUrl.searchParams.set("creation_id", createData.id);
  publishUrl.searchParams.set("access_token", accessToken);

  const publishData = await metaFetchJson<{ id: string }>(publishUrl.toString(), { method: "POST" });
  return { mediaId: publishData.id };
}

export async function publishInstagramCarousel(
  accessToken: string,
  instagramBusinessId: string,
  items: Array<{ url: string; mediaType: "IMAGE" | "VIDEO" }>,
  caption?: string,
  tokenType?: InstagramTokenType | null,
): Promise<{ mediaId: string }> {
  if (items.length < 2 || items.length > 10) {
    throw new InstagramMetaError("Instagram Carousels require between 2 and 10 media items.", 400);
  }

  const type = detectTokenType(accessToken, tokenType);
  const base = graphBaseFor(type);
  const targetId = instagramBusinessId.trim() || "me";

  const childIds: string[] = [];
  for (const item of items) {
    const childUrl = new URL(`${base}/${targetId}/media`);
    childUrl.searchParams.set("is_carousel_item", "true");
    if (item.mediaType === "VIDEO") {
      childUrl.searchParams.set("media_type", "VIDEO");
      childUrl.searchParams.set("video_url", item.url);
    } else {
      childUrl.searchParams.set("image_url", item.url);
    }
    childUrl.searchParams.set("access_token", accessToken);

    const childData = await metaFetchJson<{ id: string }>(childUrl.toString(), { method: "POST" });
    if (item.mediaType === "VIDEO") {
      await waitForContainerReady(base, childData.id, accessToken);
    }
    childIds.push(childData.id);
  }

  const parentUrl = new URL(`${base}/${targetId}/media`);
  parentUrl.searchParams.set("media_type", "CAROUSEL");
  parentUrl.searchParams.set("children", childIds.join(","));
  if (caption) parentUrl.searchParams.set("caption", caption);
  parentUrl.searchParams.set("access_token", accessToken);

  const parentData = await metaFetchJson<{ id: string }>(parentUrl.toString(), { method: "POST" });
  await waitForContainerReady(base, parentData.id, accessToken, 10);

  const publishUrl = new URL(`${base}/${targetId}/media_publish`);
  publishUrl.searchParams.set("creation_id", parentData.id);
  publishUrl.searchParams.set("access_token", accessToken);

  const publishData = await metaFetchJson<{ id: string }>(publishUrl.toString(), { method: "POST" });
  return { mediaId: publishData.id };
}

export async function publishInstagramStory(
  accessToken: string,
  instagramBusinessId: string,
  mediaUrl: string,
  isVideo: boolean,
  tokenType?: InstagramTokenType | null,
): Promise<{ mediaId: string }> {
  const type = detectTokenType(accessToken, tokenType);
  const base = graphBaseFor(type);
  const targetId = instagramBusinessId.trim() || "me";

  const createUrl = new URL(`${base}/${targetId}/media`);
  createUrl.searchParams.set("media_type", "STORIES");
  createUrl.searchParams.set(isVideo ? "video_url" : "image_url", mediaUrl);
  createUrl.searchParams.set("access_token", accessToken);

  const createData = await metaFetchJson<{ id: string }>(createUrl.toString(), { method: "POST" });
  if (isVideo) {
    await waitForContainerReady(base, createData.id, accessToken);
  }

  const publishUrl = new URL(`${base}/${targetId}/media_publish`);
  publishUrl.searchParams.set("creation_id", createData.id);
  publishUrl.searchParams.set("access_token", accessToken);

  const publishData = await metaFetchJson<{ id: string }>(publishUrl.toString(), { method: "POST" });
  return { mediaId: publishData.id };
}

// ============================================================
// Feed Media, Stories, Tags & Post Editing
// ============================================================

export async function fetchInstagramMediaGrid(
  accessToken: string,
  instagramBusinessId: string,
  tokenType?: InstagramTokenType | null,
  limit = 24,
): Promise<InstagramMediaItem[]> {
  const type = detectTokenType(accessToken, tokenType);
  const base = graphBaseFor(type);
  const targetId = instagramBusinessId.trim() || "me";
  const fields =
    "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count,is_comment_enabled,children{id,media_type,media_url,thumbnail_url}";

  const data = await metaFetchJson<{
    data?: Array<
      Omit<InstagramMediaItem, "children"> & {
        children?: { data?: InstagramMediaItem["children"] };
      }
    >;
  }>(
    `${base}/${targetId}/media?fields=${encodeURIComponent(fields)}&limit=${limit}&access_token=${encodeURIComponent(accessToken)}`,
  );

  return (data.data ?? []).map((item) => ({
    id: String(item.id),
    caption: item.caption ?? "",
    media_type: item.media_type,
    media_product_type: item.media_product_type,
    media_url: item.media_url,
    thumbnail_url: item.thumbnail_url,
    permalink: item.permalink,
    timestamp: item.timestamp,
    like_count: typeof item.like_count === "number" ? item.like_count : 0,
    comments_count: typeof item.comments_count === "number" ? item.comments_count : 0,
    is_comment_enabled: item.is_comment_enabled !== false,
    children: item.children?.data ?? undefined,
  }));
}

export async function fetchInstagramStories(
  accessToken: string,
  instagramBusinessId: string,
  tokenType?: InstagramTokenType | null,
): Promise<InstagramStoryItem[]> {
  const type = detectTokenType(accessToken, tokenType);
  const base = graphBaseFor(type);
  const targetId = instagramBusinessId.trim() || "me";
  const fields = "id,media_type,media_url,thumbnail_url,timestamp,caption";

  const data = await metaFetchJson<{ data?: InstagramStoryItem[] }>(
    `${base}/${targetId}/stories?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(accessToken)}`,
  );
  return data.data ?? [];
}

export async function fetchMentionedMedia(
  accessToken: string,
  instagramBusinessId: string,
  tokenType?: InstagramTokenType | null,
  limit = 15,
): Promise<InstagramMediaItem[]> {
  const type = detectTokenType(accessToken, tokenType);
  const base = graphBaseFor(type);
  const targetId = instagramBusinessId.trim() || "me";
  const fields = "id,caption,media_type,media_url,permalink,timestamp,like_count,comments_count";

  const data = await metaFetchJson<{ data?: InstagramMediaItem[] }>(
    `${base}/${targetId}/tags?fields=${encodeURIComponent(fields)}&limit=${limit}&access_token=${encodeURIComponent(accessToken)}`,
  );
  return data.data ?? [];
}

export async function updateInstagramMedia(
  accessToken: string,
  mediaId: string,
  updates: { comment_enabled?: boolean; caption?: string },
  tokenType?: InstagramTokenType | null,
): Promise<{ success: boolean }> {
  const type = detectTokenType(accessToken, tokenType);
  const base = graphBaseFor(type);
  const url = new URL(`${base}/${mediaId}`);
  if (typeof updates.comment_enabled === "boolean") {
    url.searchParams.set("comment_enabled", updates.comment_enabled ? "true" : "false");
  }
  if (typeof updates.caption === "string") {
    url.searchParams.set("caption", updates.caption);
  }
  url.searchParams.set("access_token", accessToken);

  await metaFetchJson(url.toString(), { method: "POST" });
  return { success: true };
}

// ============================================================
// Comments & Comment-to-DM Actions
// ============================================================

export async function fetchMediaComments(
  accessToken: string,
  mediaId: string,
  tokenType?: InstagramTokenType | null,
  limit = 50,
): Promise<InstagramCommentItem[]> {
  const type = detectTokenType(accessToken, tokenType);
  const base = graphBaseFor(type);
  const fields =
    "id,text,username,from,timestamp,like_count,hidden,replies{id,text,username,from,timestamp,like_count,hidden}";

  interface RawMetaComment {
    id: string;
    text?: string;
    username?: string;
    from?: { id: string; username?: string };
    timestamp?: string;
    like_count?: number;
    hidden?: boolean;
    replies?: { data?: RawMetaComment[] };
  }

  const data = await metaFetchJson<{ data?: RawMetaComment[] }>(
    `${base}/${mediaId}/comments?fields=${encodeURIComponent(fields)}&limit=${limit}&access_token=${encodeURIComponent(accessToken)}`,
  );

  return (data.data ?? []).map((c) => ({
    id: String(c.id),
    text: String(c.text ?? ""),
    username: c.username || c.from?.username,
    from: c.from,
    timestamp: c.timestamp,
    like_count: typeof c.like_count === "number" ? c.like_count : 0,
    hidden: Boolean(c.hidden),
    replies: (c.replies?.data ?? []).map((r) => ({
      id: String(r.id),
      text: String(r.text ?? ""),
      username: r.username || r.from?.username,
      from: r.from,
      timestamp: r.timestamp,
      like_count: typeof r.like_count === "number" ? r.like_count : 0,
      hidden: Boolean(r.hidden),
    })),
  }));
}

export async function replyToComment(
  accessToken: string,
  commentId: string,
  message: string,
  tokenType?: InstagramTokenType | null,
): Promise<{ id: string }> {
  const type = detectTokenType(accessToken, tokenType);
  const base = graphBaseFor(type);
  const url = new URL(`${base}/${commentId}/replies`);
  url.searchParams.set("message", message);
  url.searchParams.set("access_token", accessToken);

  const data = await metaFetchJson<{ id: string }>(url.toString(), { method: "POST" });
  return { id: data.id };
}

export async function setCommentHidden(
  accessToken: string,
  commentId: string,
  hide: boolean,
  tokenType?: InstagramTokenType | null,
): Promise<{ success: boolean }> {
  const type = detectTokenType(accessToken, tokenType);
  const base = graphBaseFor(type);
  const url = new URL(`${base}/${commentId}`);
  url.searchParams.set("hide", hide ? "true" : "false");
  url.searchParams.set("access_token", accessToken);

  await metaFetchJson(url.toString(), { method: "POST" });
  return { success: true };
}

export async function deleteInstagramComment(
  accessToken: string,
  commentId: string,
  tokenType?: InstagramTokenType | null,
): Promise<{ success: boolean }> {
  const type = detectTokenType(accessToken, tokenType);
  const base = graphBaseFor(type);
  const url = new URL(`${base}/${commentId}`);
  url.searchParams.set("access_token", accessToken);

  await metaFetchJson(url.toString(), { method: "DELETE" });
  return { success: true };
}

export async function sendPrivateCommentReply(
  accessToken: string,
  commentId: string,
  text: string,
  options?: {
    tokenType?: InstagramTokenType | null;
    igId?: string | null;
    pageId?: string | null;
  },
): Promise<{ messageId: string }> {
  const type = detectTokenType(accessToken, options?.tokenType);
  const base = graphBaseFor(type);
  const senderPath =
    type === "instagram_login"
      ? `${options?.igId || "me"}/messages`
      : `${options?.pageId || "me"}/messages`;

  const data = await metaFetchJson<{ message_id?: string }>(`${base}/${senderPath}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      recipient: { comment_id: commentId },
      message: { text },
    }),
  });

  return { messageId: data.message_id || `ig_dm_${Date.now()}` };
}

// ============================================================
// Account & Media Insights
// ============================================================

export async function fetchAccountInsights(
  accessToken: string,
  instagramBusinessId: string,
  period: "day" | "week" | "days_28" = "days_28",
  tokenType?: InstagramTokenType | null,
): Promise<InstagramInsightMetric[]> {
  const type = detectTokenType(accessToken, tokenType);
  const base = graphBaseFor(type);
  const targetId = instagramBusinessId.trim() || "me";
  const metrics = ["reach", "profile_views", "accounts_engaged", "total_interactions", "views"];
  const results: InstagramInsightMetric[] = [];

  for (const metric of metrics) {
    try {
      const data = await metaFetchJson<{
        data?: Array<{
          name: string;
          title?: string;
          description?: string;
          period?: string;
          total_value?: { value?: number };
          values?: Array<{ value?: number }>;
        }>;
      }>(
        `${base}/${targetId}/insights?metric=${metric}&period=${period}&metric_type=total_value&access_token=${encodeURIComponent(accessToken)}`,
      );
      const entry = data.data?.[0];
      if (!entry) continue;
      const val =
        typeof entry.total_value?.value === "number"
          ? entry.total_value.value
          : (entry.values ?? []).reduce((sum, v) => sum + (Number(v.value) || 0), 0);
      results.push({
        name: entry.name,
        title: entry.title,
        description: entry.description,
        value: val,
        period: entry.period || period,
      });
    } catch {
      // Fallback without metric_type=total_value for older/standard metrics like reach/follower_count
      try {
        const data = await metaFetchJson<{
          data?: Array<{
            name: string;
            title?: string;
            description?: string;
            period?: string;
            values?: Array<{ value?: number }>;
          }>;
        }>(
          `${base}/${targetId}/insights?metric=${metric}&period=${period}&access_token=${encodeURIComponent(accessToken)}`,
        );
        const entry = data.data?.[0];
        if (!entry) continue;
        const val = (entry.values ?? []).reduce((sum, v) => sum + (Number(v.value) || 0), 0);
        results.push({
          name: entry.name,
          title: entry.title,
          description: entry.description,
          value: val,
          period: entry.period || period,
        });
      } catch {
        // Ignore metric unsupported for this account tier
      }
    }
  }

  return results;
}

export async function fetchMediaInsights(
  accessToken: string,
  mediaId: string,
  mediaType?: string,
  tokenType?: InstagramTokenType | null,
): Promise<InstagramInsightMetric[]> {
  const type = detectTokenType(accessToken, tokenType);
  const base = graphBaseFor(type);
  const candidates =
    mediaType === "REELS" || mediaType === "VIDEO"
      ? ["reach", "saved", "likes", "comments", "shares", "total_interactions", "views"]
      : ["reach", "saved", "likes", "comments", "shares", "total_interactions", "views"];

  const results: InstagramInsightMetric[] = [];
  for (const metric of candidates) {
    try {
      const data = await metaFetchJson<{
        data?: Array<{ name: string; title?: string; values?: Array<{ value?: number }> }>;
      }>(
        `${base}/${mediaId}/insights?metric=${metric}&access_token=${encodeURIComponent(accessToken)}`,
      );
      const entry = data.data?.[0];
      if (!entry) continue;
      const val = Number(entry.values?.[0]?.value ?? 0);
      results.push({
        name: entry.name,
        title: entry.title,
        value: val,
      });
    } catch {
      // Metric may not be available on this media type
    }
  }

  return results;
}

// ============================================================
// Direct Messaging, Reactions, Profiles & Thread Sync
// ============================================================

export interface MetaMessagingOptions {
  replyToMid?: string | null;
  tokenType?: InstagramTokenType | null;
  igId?: string | null;
  pageId?: string | null;
}

function messagingEndpoint(
  accessToken: string,
  options?: MetaMessagingOptions,
): string {
  const type = detectTokenType(accessToken, options?.tokenType);
  const base = graphBaseFor(type);
  if (type === "instagram_login") {
    return `${base}/${options?.igId?.trim() || "me"}/messages`;
  }
  return `${base}/${options?.pageId?.trim() || "me"}/messages`;
}

export async function sendMetaTextMessage(
  accessToken: string,
  recipientIgsid: string,
  text: string,
  options?: MetaMessagingOptions,
): Promise<{ messageId: string }> {
  const payload: Record<string, unknown> = {
    recipient: { id: recipientIgsid },
    message: { text },
  };
  if (options?.replyToMid) {
    payload.reply_to = { mid: options.replyToMid };
  }

  const data = await metaFetchJson<{ message_id?: string }>(
    messagingEndpoint(accessToken, options),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(payload),
    },
  );

  return { messageId: data.message_id || `ig_${Date.now()}` };
}

export async function sendMetaMediaMessage(
  accessToken: string,
  recipientIgsid: string,
  mediaUrl: string,
  mediaType: "image" | "video" | "audio" = "image",
  options?: MetaMessagingOptions,
): Promise<{ messageId: string }> {
  const payload: Record<string, unknown> = {
    recipient: { id: recipientIgsid },
    message: {
      attachment: {
        type: mediaType,
        payload: { url: mediaUrl },
      },
    },
  };
  if (options?.replyToMid) {
    payload.reply_to = { mid: options.replyToMid };
  }

  const data = await metaFetchJson<{ message_id?: string }>(
    messagingEndpoint(accessToken, options),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(payload),
    },
  );

  return { messageId: data.message_id || `ig_${Date.now()}` };
}

export async function sendMetaReaction(
  accessToken: string,
  recipientIgsid: string,
  targetMessageId: string,
  emoji: string,
  options?: MetaMessagingOptions,
): Promise<void> {
  const payload =
    emoji === ""
      ? {
          recipient: { id: recipientIgsid },
          sender_action: "unreact",
          payload: { message_id: targetMessageId },
        }
      : {
          recipient: { id: recipientIgsid },
          sender_action: "react",
          payload: {
            message_id: targetMessageId,
            reaction: "other",
            emoji,
          },
        };

  await metaFetchJson(messagingEndpoint(accessToken, options), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });
}

export async function getInstagramUserProfile(
  accessToken: string,
  igsid: string,
  tokenType?: InstagramTokenType | null,
): Promise<{ name?: string; username?: string; profilePic?: string } | null> {
  try {
    const type = detectTokenType(accessToken, tokenType);
    const base = graphBaseFor(type);
    const data = await metaFetchJson<{ name?: string; username?: string; profile_pic?: string }>(
      `${base}/${igsid}?fields=name,username,profile_pic&access_token=${encodeURIComponent(accessToken)}`,
    );
    return {
      name: data.name,
      username: data.username,
      profilePic: data.profile_pic,
    };
  } catch {
    return null;
  }
}

export interface MetaConversationThread {
  id: string;
  updated_time?: string;
  participants: Array<{ id: string; username?: string; name?: string }>;
  messages: Array<{
    id: string;
    message?: string;
    created_time: string;
    from?: { id: string; username?: string; name?: string };
    attachments?: Array<{
      id?: string;
      mime_type?: string;
      image_data?: { url?: string };
      video_data?: { url?: string };
      audio_data?: { url?: string };
      file_url?: string;
    }>;
  }>;
}

export async function fetchInstagramConversations(
  accessToken: string,
  options: {
    tokenType?: InstagramTokenType | null;
    igId?: string | null;
    pageId?: string | null;
    limit?: number;
  },
): Promise<MetaConversationThread[]> {
  const type = detectTokenType(accessToken, options.tokenType);
  const base = graphBaseFor(type);
  const targetId =
    type === "instagram_login"
      ? options.igId?.trim() || "me"
      : options.pageId?.trim() || "me";
  const limit = options.limit ?? 20;

  const fields =
    "id,updated_time,participants{id,username,name},messages.limit(20){id,message,created_time,from,attachments{id,mime_type,image_data,video_data,audio_data,file_url}}";

  interface RawMetaConversation {
    id: string;
    updated_time?: string;
    participants?: { data?: MetaConversationThread["participants"] };
    messages?: { data?: MetaConversationThread["messages"] };
  }

  const data = await metaFetchJson<{ data?: RawMetaConversation[] }>(
    `${base}/${targetId}/conversations?platform=instagram&fields=${encodeURIComponent(fields)}&limit=${limit}&access_token=${encodeURIComponent(accessToken)}`,
  );

  return (data.data ?? []).map((conv) => ({
    id: String(conv.id),
    updated_time: conv.updated_time,
    participants: conv.participants?.data ?? [],
    messages: conv.messages?.data ?? [],
  }));
}

export async function getInstagramMessageMediaUrl(
  accessToken: string,
  messageId: string,
  tokenType?: InstagramTokenType | null,
): Promise<string | null> {
  const type = detectTokenType(accessToken, tokenType);
  const base = graphBaseFor(type);
  const data = await metaFetchJson<{
    attachments?: {
      data?: Array<{
        image_data?: { url?: string };
        video_data?: { url?: string };
        audio_data?: { url?: string };
        file_url?: string;
      }>;
    };
  }>(
    `${base}/${encodeURIComponent(messageId)}?fields=attachments%7Bid,mime_type,image_data,video_data,audio_data,file_url%7D&access_token=${encodeURIComponent(accessToken)}`,
  );
  const att = data.attachments?.data?.[0];
  if (!att) return null;
  return (
    att.video_data?.url ||
    att.audio_data?.url ||
    att.image_data?.url ||
    att.file_url ||
    null
  );
}
