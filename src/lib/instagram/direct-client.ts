// ============================================================
// Direct Instagram Client
//
// Handles direct username & password auth, 2FA verification,
// sessionid cookie validation, authenticated profile fetching,
// DM sending (with real numeric user pk resolution & no fake success),
// and Direct Inbox synchronization.
// ============================================================

import type { InstagramDirectLoginResult } from "./types";

export interface DirectSessionPayload {
  username: string;
  password?: string;
  sessionid?: string;
  ds_user_id?: string;
  csrftoken?: string;
  cookies?: Record<string, string>;
}

export interface InstagramProfileDetails {
  pk?: string;
  username: string;
  name: string;
  profilePictureUrl: string;
  followersCount?: number | null;
  followingCount?: number | null;
  postsCount?: number | null;
  biography?: string;
  isVerified?: boolean;
}

export interface DirectInboxThread {
  threadId: string;
  title: string;
  recipientPk: string;
  recipientUsername: string;
  recipientName: string;
  recipientAvatar?: string;
  lastActivityAt: string;
  messages: Array<{
    itemId: string;
    senderPk: string;
    isFromMe: boolean;
    text: string | null;
    mediaUrl: string | null;
    mediaType: "text" | "image" | "video" | "audio";
    timestamp: string;
  }>;
}

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function parseCookies(cookieHeaders: string[] | string | null): Record<string, string> {
  const parsed: Record<string, string> = {};
  if (!cookieHeaders) return parsed;
  const list = Array.isArray(cookieHeaders) ? cookieHeaders : [cookieHeaders];
  for (const str of list) {
    const firstPart = str.split(";")[0] ?? "";
    const eqIdx = firstPart.indexOf("=");
    if (eqIdx > 0) {
      const key = firstPart.slice(0, eqIdx).trim();
      const val = firstPart.slice(eqIdx + 1).trim();
      if (key && val) {
        parsed[key] = val;
      }
    }
  }
  return parsed;
}

function cookieString(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .filter(([, v]) => Boolean(v))
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

export function normalizeHandle(input: string): string {
  return input
    .trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
    .replace(/\/.*$/, "")
    .replace(/^@+/, "")
    .trim();
}

async function fetchInitialCsrfAndCookies(
  existingCookies: Record<string, string> = {},
): Promise<{ csrfToken: string; cookies: Record<string, string> }> {
  const cookies: Record<string, string> = { ...existingCookies };
  let csrfToken = cookies.csrftoken || "";

  try {
    const res = await fetch("https://www.instagram.com/accounts/login/", {
      headers: {
        "User-Agent": DEFAULT_USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        ...(Object.keys(cookies).length > 0 ? { Cookie: cookieString(cookies) } : {}),
      },
      cache: "no-store",
    });
    const setCookies = parseCookies(res.headers.getSetCookie?.() || res.headers.get("set-cookie"));
    Object.assign(cookies, setCookies);
    if (cookies.csrftoken) {
      csrfToken = cookies.csrftoken;
    } else {
      const html = await res.text().catch(() => "");
      const m = html.match(/"csrf_token":"([^"]+)"/);
      if (m?.[1]) {
        csrfToken = m[1];
        cookies.csrftoken = m[1];
      }
    }
  } catch (err) {
    console.warn("[Instagram direct-client] init cookie fetch failed:", err);
  }

  return { csrfToken, cookies };
}

/**
 * Connect using an active Instagram Session ID cookie (`sessionid`).
 * Validates the session against Instagram's authenticated current_user endpoint
 * and extracts real `csrftoken` and `ds_user_id`.
 */
export async function connectWithSessionId(
  sessionIdInput: string,
  usernameInput?: string,
): Promise<InstagramDirectLoginResult> {
  const sessionId = decodeURIComponent(sessionIdInput.trim().replace(/^sessionid=/i, ""));
  if (!sessionId) {
    throw new Error("Instagram Session ID is required.");
  }

  const cleanUsername = usernameInput ? normalizeHandle(usernameInput) : "";
  const dsMatch = sessionId.match(/^(\d+)(:|%3A)/i);
  const dsUserId = dsMatch?.[1] || "";

  const initialCookies: Record<string, string> = {
    sessionid: sessionIdInput.trim().replace(/^sessionid=/i, ""),
    ...(dsUserId ? { ds_user_id: dsUserId } : {}),
  };

  const { csrfToken, cookies } = await fetchInitialCsrfAndCookies(initialCookies);

  // Validate session authenticity with Instagram accounts/current_user
  let verifiedUsername = cleanUsername;
  let verifiedName = cleanUsername;
  let verifiedPk = dsUserId;
  let avatarUrl = "";

  try {
    const meRes = await fetch("https://www.instagram.com/api/v1/accounts/current_user/?edit=true", {
      headers: {
        "User-Agent": DEFAULT_USER_AGENT,
        "X-IG-App-ID": "936619743392459",
        "X-CSRFToken": csrfToken || cookies.csrftoken || "",
        "X-Requested-With": "XMLHttpRequest",
        Cookie: cookieString(cookies),
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (meRes.status === 401 || meRes.status === 403) {
      throw new Error(
        "The provided Instagram Session ID cookie is invalid or expired. Please copy a fresh `sessionid` from a logged-in browser.",
      );
    }

    if (meRes.ok) {
      const meData = await meRes.json().catch(() => null);
      if (meData?.user?.username) {
        verifiedUsername = meData.user.username;
        verifiedName = meData.user.full_name || verifiedUsername;
        verifiedPk = String(meData.user.pk || meData.user.id || verifiedPk);
        avatarUrl = meData.user.profile_pic_url || "";
      } else if (meData?.require_login) {
        throw new Error("Instagram rejected this session cookie (`require_login`). Please refresh your login cookie.");
      }
    }
  } catch (err) {
    if (err instanceof Error && (err.message.includes("Session ID") || err.message.includes("session cookie"))) {
      throw err;
    }
    // Non-fatal network warning; fallback cleanly to web_profile_info if username provided
  }

  if (!verifiedUsername) {
    throw new Error(
      "Could not determine your Instagram username from this session cookie. Please enter your @username alongside the sessionid.",
    );
  }

  const sessionObj: DirectSessionPayload = {
    username: verifiedUsername,
    sessionid: initialCookies.sessionid,
    ds_user_id: verifiedPk || undefined,
    csrftoken: csrfToken || cookies.csrftoken || undefined,
    cookies,
  };

  const profile = await fetchDirectProfile(sessionObj, verifiedUsername);

  return {
    status: "connected",
    username: profile.username || verifiedUsername,
    name: profile.name || verifiedName || verifiedUsername,
    profilePictureUrl: profile.profilePictureUrl || avatarUrl || "",
    sessionData: JSON.stringify({
      ...sessionObj,
      ds_user_id: sessionObj.ds_user_id || profile.pk,
    }),
  };
}

/**
 * Direct login with Instagram Username and Password.
 * Supports 2FA challenge return (`status: '2fa_required'`) so the UI
 * can prompt the user for their SMS / Authenticator code.
 */
export async function loginWithCredentials(
  usernameInput: string,
  passwordInput: string,
): Promise<InstagramDirectLoginResult> {
  const username = normalizeHandle(usernameInput);

  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username)) {
    throw new Error(
      "Please enter your Instagram @handle (e.g. cloudmasa_innovation) instead of your email address.",
    );
  }

  if (!username || !passwordInput) {
    throw new Error("Instagram username and password are required.");
  }

  const { csrfToken: initCsrf, cookies: initialCookies } = await fetchInitialCsrfAndCookies();
  const csrfToken = initCsrf || "csrftoken";

  const encPassword = `#PWD_INSTAGRAM_BROWSER:0:${Math.floor(Date.now() / 1000)}:${passwordInput}`;
  const loginBody = new URLSearchParams({
    enc_password: encPassword,
    username,
    queryParams: "{}",
    optIntoOneTap: "false",
    trustedDeviceRecords: "{}",
  });

  const loginRes = await fetch("https://www.instagram.com/api/v1/web/accounts/login/ajax/", {
    method: "POST",
    headers: {
      "User-Agent": DEFAULT_USER_AGENT,
      "X-IG-App-ID": "936619743392459",
      "X-CSRFToken": csrfToken,
      "X-Requested-With": "XMLHttpRequest",
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: "https://www.instagram.com/accounts/login/",
      Cookie: cookieString(initialCookies),
    },
    body: loginBody.toString(),
  });

  const loginCookies = parseCookies(
    loginRes.headers.getSetCookie?.() || loginRes.headers.get("set-cookie"),
  );
  const sessionCookies: Record<string, string> = { ...initialCookies, ...loginCookies };

  interface DirectLoginResponse {
    authenticated?: boolean;
    two_factor_required?: boolean;
    two_factor_info?: {
      two_factor_identifier?: string;
      totp_two_factor_on?: boolean;
      sms_two_factor_on?: boolean;
      obfuscated_phone_number?: string;
    };
    checkpoint_url?: string;
    message?: string;
    user?: boolean;
    userId?: string | number;
  }

  const loginText = await loginRes.text();
  let loginData: DirectLoginResponse | null = null;
  try {
    loginData = JSON.parse(loginText) as DirectLoginResponse;
  } catch {
    console.warn("[Instagram direct-client] Non-JSON login response:", loginText.slice(0, 250));
  }

  // Handle 2FA challenge cleanly so caller can collect OTP
  if (loginData?.two_factor_required && loginData.two_factor_info?.two_factor_identifier) {
    const info = loginData.two_factor_info;
    const method: "sms" | "totp" | "email" = info.totp_two_factor_on
      ? "totp"
      : info.sms_two_factor_on
      ? "sms"
      : "email";

    const pendingSession: DirectSessionPayload = {
      username,
      password: passwordInput,
      csrftoken: sessionCookies.csrftoken || csrfToken,
      cookies: sessionCookies,
    };

    return {
      status: "2fa_required",
      twoFactorIdentifier: String(info.two_factor_identifier),
      twoFactorType: method,
      obfuscatedPhone: info.obfuscated_phone_number || undefined,
      username,
      sessionData: JSON.stringify(pendingSession),
    };
  }

  if (!loginRes.ok || !loginData || !loginData.authenticated) {
    if (loginData?.checkpoint_url || loginData?.message === "checkpoint_required") {
      throw new Error(
        "Instagram triggered a security checkpoint challenge. Log in once via Web Companion Frame (or paste your Session Cookie) to verify.",
      );
    }
    if (loginData?.user === false || String(loginData?.message || "").toLowerCase().includes("password")) {
      throw new Error("Invalid Instagram username or password.");
    }
    if (loginData?.message) {
      throw new Error(`Instagram authentication failed: ${loginData.message}`);
    }
    throw new Error(
      `Instagram server rejected direct login (HTTP ${loginRes.status}). Try Session Cookie login or connect via Meta Cloud API.`,
    );
  }

  const authenticatedUserId = String(loginData.userId || sessionCookies.ds_user_id || "");
  const sessionObj: DirectSessionPayload = {
    username,
    password: passwordInput,
    csrftoken: sessionCookies.csrftoken || csrfToken,
    sessionid: sessionCookies.sessionid,
    ds_user_id: authenticatedUserId || undefined,
    cookies: sessionCookies,
  };

  const profile = await fetchDirectProfile(sessionObj, username);

  return {
    status: "connected",
    username: profile.username || username,
    name: profile.name || username,
    profilePictureUrl: profile.profilePictureUrl || "",
    sessionData: JSON.stringify({
      ...sessionObj,
      username: profile.username || username,
      ds_user_id: authenticatedUserId || profile.pk,
    }),
  };
}

/**
 * Complete an Instagram 2FA verification challenge using the saved pending session.
 */
export async function completeTwoFactorLogin(
  pendingSessionJson: string,
  twoFactorIdentifier: string,
  verificationCode: string,
  verificationMethod: "sms" | "totp" | "email" = "totp",
): Promise<InstagramDirectLoginResult> {
  const pending = JSON.parse(pendingSessionJson) as DirectSessionPayload;
  const cookies = { ...(pending.cookies || {}) };
  const csrfToken = pending.csrftoken || cookies.csrftoken || "";

  const methodCode =
    verificationMethod === "sms" ? "1" : verificationMethod === "totp" ? "3" : "2";

  const body = new URLSearchParams({
    username: pending.username,
    verificationCode: verificationCode.replace(/\s+/g, ""),
    identifier: twoFactorIdentifier,
    queryParams: '{"next":"/"}',
    trust_signal: "true",
    verification_method: methodCode,
  });

  const res = await fetch(
    "https://www.instagram.com/api/v1/web/accounts/login/ajax/two_factor/",
    {
      method: "POST",
      headers: {
        "User-Agent": DEFAULT_USER_AGENT,
        "X-IG-App-ID": "936619743392459",
        "X-CSRFToken": csrfToken,
        "X-Requested-With": "XMLHttpRequest",
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: "https://www.instagram.com/accounts/login/two_factor",
        Cookie: cookieString(cookies),
      },
      body: body.toString(),
    },
  );

  const newCookies = parseCookies(res.headers.getSetCookie?.() || res.headers.get("set-cookie"));
  const mergedCookies = { ...cookies, ...newCookies };
  const data = await res.json().catch(() => null);

  if (!res.ok || !data?.authenticated) {
    throw new Error(
      data?.message || "Invalid two-factor verification code. Please check the code and retry.",
    );
  }

  const dsUserId = String(data.userId || mergedCookies.ds_user_id || "");
  const sessionObj: DirectSessionPayload = {
    username: pending.username,
    password: pending.password,
    csrftoken: mergedCookies.csrftoken || csrfToken,
    sessionid: mergedCookies.sessionid,
    ds_user_id: dsUserId || undefined,
    cookies: mergedCookies,
  };

  const profile = await fetchDirectProfile(sessionObj, pending.username);

  return {
    status: "connected",
    username: profile.username || pending.username,
    name: profile.name || pending.username,
    profilePictureUrl: profile.profilePictureUrl || "",
    sessionData: JSON.stringify({
      ...sessionObj,
      username: profile.username || pending.username,
      ds_user_id: dsUserId || profile.pk,
    }),
  };
}

/**
 * Fetch profile info and stats for an Instagram user (uses authenticated session cookies when supplied).
 */
export async function fetchDirectProfile(
  session?: DirectSessionPayload,
  fallbackUsername?: string,
): Promise<InstagramProfileDetails> {
  const cleanHandle = normalizeHandle(fallbackUsername || session?.username || "");
  if (!cleanHandle) {
    return { username: "", name: "", profilePictureUrl: "" };
  }

  try {
    const res = await fetch(
      `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(cleanHandle)}`,
      {
        headers: {
          "User-Agent": DEFAULT_USER_AGENT,
          "X-IG-App-ID": "936619743392459",
          "X-CSRFToken": session?.csrftoken || session?.cookies?.csrftoken || "missing",
          ...(session?.cookies && Object.keys(session.cookies).length > 0
            ? { Cookie: cookieString(session.cookies) }
            : {}),
          Accept: "application/json",
        },
        cache: "no-store",
      },
    );

    if (res.ok) {
      const data = await res.json();
      const user = data.data?.user;
      if (user) {
        return {
          pk: user.id ? String(user.id) : undefined,
          username: user.username || cleanHandle,
          name: user.full_name || user.username || cleanHandle,
          profilePictureUrl: user.profile_pic_url_hd || user.profile_pic_url || "",
          followersCount: user.edge_followed_by?.count ?? null,
          followingCount: user.edge_follow?.count ?? null,
          postsCount: user.edge_owner_to_timeline_media?.count ?? null,
          biography: user.biography || "",
          isVerified: !!user.is_verified,
        };
      }
    }
  } catch (err) {
    console.warn("[Instagram direct-client] web_profile_info fetch failed:", err);
  }

  try {
    const oembedRes = await fetch(
      `https://api.instagram.com/oembed/?url=https://www.instagram.com/${encodeURIComponent(cleanHandle)}/`,
      { headers: { "User-Agent": DEFAULT_USER_AGENT }, cache: "no-store" },
    );
    if (oembedRes.ok) {
      const oembedData = await oembedRes.json();
      if (oembedData.author_name) {
        return {
          username: oembedData.author_name || cleanHandle,
          name: oembedData.author_name || cleanHandle,
          profilePictureUrl: oembedData.thumbnail_url || "",
        };
      }
    }
  } catch {
    // Ignore oEmbed failure
  }

  return {
    username: cleanHandle,
    name: cleanHandle,
    profilePictureUrl: "",
  };
}

/**
 * Resolve numeric Instagram User ID (`pk`) from a username when targeting a DM in Direct mode.
 */
async function resolveRecipientPk(
  session: DirectSessionPayload,
  recipientUsernameOrId: string,
): Promise<string | null> {
  const clean = normalizeHandle(recipientUsernameOrId);
  if (/^\d+$/.test(clean)) return clean;

  const profile = await fetchDirectProfile(session, clean);
  if (profile.pk && /^\d+$/.test(profile.pk)) {
    return profile.pk;
  }

  // Fallback search endpoint using authenticated session
  try {
    const res = await fetch(
      `https://www.instagram.com/api/v1/web/search/topsearch/?query=${encodeURIComponent(clean)}`,
      {
        headers: {
          "User-Agent": DEFAULT_USER_AGENT,
          "X-IG-App-ID": "936619743392459",
          "X-CSRFToken": session.csrftoken || session.cookies?.csrftoken || "",
          Cookie: session.cookies ? cookieString(session.cookies) : "",
          Accept: "application/json",
        },
        cache: "no-store",
      },
    );
    if (res.ok) {
      const data = await res.json();
      const match = (data.users ?? []).find(
        (u: { user?: { username?: string; pk?: string | number } }) =>
          u.user?.username?.toLowerCase() === clean.toLowerCase(),
      );
      if (match?.user?.pk) {
        return String(match.user.pk);
      }
    }
  } catch {
    // Ignore search failure
  }

  return null;
}

/**
 * Send a Direct Message over the authenticated Instagram direct session.
 * Never returns fake success — surfaces genuine errors from Instagram.
 */
export async function sendDirectTextMessage(
  sessionDataJson: string,
  recipientUsernameOrId: string,
  text: string,
): Promise<{ success: boolean; messageId?: string; recipientPk?: string; error?: string }> {
  try {
    let session: DirectSessionPayload;
    try {
      session = JSON.parse((sessionDataJson || "").trim());
    } catch {
      return { success: false, error: "Invalid Instagram session payload." };
    }

    const cookies = session?.cookies || (session?.sessionid ? { sessionid: session.sessionid } : {});
    if (!cookies.sessionid) {
      return {
        success: false,
        error: "Instagram direct session cookie is missing. Reconnect in Instagram Settings.",
      };
    }

    const recipientPk = await resolveRecipientPk(session, recipientUsernameOrId);
    if (!recipientPk) {
      return {
        success: false,
        error: `Could not resolve numeric Instagram ID for "${recipientUsernameOrId}". Verify the username or reconnect via Meta Cloud API.`,
      };
    }

    const clientContext = `${Date.now()}${Math.floor(Math.random() * 1000000)}`;
    const body = new URLSearchParams({
      action: "send_item",
      recipient_users: JSON.stringify([[recipientPk]]),
      client_context: clientContext,
      text,
    });

    const csrfToken = session.csrftoken || cookies.csrftoken || "";
    const res = await fetch("https://www.instagram.com/api/v1/direct_v2/threads/broadcast/text/", {
      method: "POST",
      headers: {
        "User-Agent": DEFAULT_USER_AGENT,
        "X-IG-App-ID": "936619743392459",
        "X-CSRFToken": csrfToken,
        "X-Requested-With": "XMLHttpRequest",
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: "https://www.instagram.com/direct/inbox/",
        Cookie: cookieString(cookies),
      },
      body: body.toString(),
    });

    const data = await res.json().catch(() => ({}));
    if (res.ok && data.status === "ok") {
      return {
        success: true,
        messageId: data.payload?.item_id || data.item_id || clientContext,
        recipientPk,
      };
    }

    const errDetail =
      data?.message ||
      (res.status === 401 || res.status === 403
        ? "Instagram Direct session expired or CSRF token invalid. Reconnect your account."
        : `Instagram Direct send failed (HTTP ${res.status}).`);

    return {
      success: false,
      error: errDetail,
    };
  } catch (err: unknown) {
    console.error("[Instagram direct-client] send text error:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Network error sending Direct message.",
    };
  }
}

/**
 * Fetch recent DM conversations & messages using an authenticated Direct session.
 */
export async function fetchDirectInboxThreads(
  sessionDataJson: string,
  limit = 15,
): Promise<DirectInboxThread[]> {
  const session = JSON.parse(sessionDataJson) as DirectSessionPayload;
  const cookies = session.cookies || (session.sessionid ? { sessionid: session.sessionid } : {});
  if (!cookies.sessionid) {
    throw new Error("Instagram Direct session is missing. Please reconnect first.");
  }

  const csrfToken = session.csrftoken || cookies.csrftoken || "";
  const selfPk = String(session.ds_user_id || "");

  const res = await fetch(
    `https://www.instagram.com/api/v1/direct_v2/inbox/?visual_message_return_type=unseen&thread_message_limit=20&limit=${limit}`,
    {
      headers: {
        "User-Agent": DEFAULT_USER_AGENT,
        "X-IG-App-ID": "936619743392459",
        "X-CSRFToken": csrfToken,
        "X-Requested-With": "XMLHttpRequest",
        Referer: "https://www.instagram.com/direct/inbox/",
        Cookie: cookieString(cookies),
        Accept: "application/json",
      },
      cache: "no-store",
    },
  );

  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.inbox) {
    throw new Error(
      data?.message || `Failed to load Instagram Direct inbox (HTTP ${res.status}). Session may have expired.`,
    );
  }

  interface RawDirectItem {
    item_id?: string | number;
    user_id?: string | number;
    text?: string | null;
    item_type?: string;
    timestamp?: string | number;
    media?: {
      media_type?: number;
      video_versions?: Array<{ url?: string }>;
      image_versions2?: { candidates?: Array<{ url?: string }> };
    };
    voice_media?: {
      media?: { audio?: { audio_src?: string } };
    };
  }
  interface RawDirectThread {
    thread_id: string | number;
    thread_title?: string;
    last_activity_at?: string | number;
    users?: Array<{ pk?: string | number; id?: string | number; username?: string; full_name?: string; profile_pic_url?: string }>;
    items?: RawDirectItem[];
  }

  const threads: RawDirectThread[] = (data.inbox.threads ?? []) as RawDirectThread[];
  return threads.map((t) => {
    const otherUser = (t.users ?? [])[0] ?? {};
    const recipientPk = String(otherUser.pk || otherUser.id || t.thread_id);
    const recipientUsername = String(otherUser.username || t.thread_title || recipientPk);
    const recipientName = String(otherUser.full_name || recipientUsername);

    const parsedMsgs = (t.items ?? []).map((item: RawDirectItem) => {
      const senderPk = String(item.user_id || "");
      const isFromMe = selfPk ? senderPk === selfPk : false;
      let text: string | null = item.text ?? null;
      let mediaUrl: string | null = null;
      let mediaType: "text" | "image" | "video" | "audio" = "text";

      if (item.item_type === "media" && item.media) {
        if (item.media.media_type === 2 && item.media.video_versions?.[0]?.url) {
          mediaUrl = item.media.video_versions[0].url;
          mediaType = "video";
        } else if (item.media.image_versions2?.candidates?.[0]?.url) {
          mediaUrl = item.media.image_versions2.candidates[0].url;
          mediaType = "image";
        }
      } else if (item.item_type === "voice_media" && item.voice_media?.media?.audio?.audio_src) {
        mediaUrl = item.voice_media.media.audio.audio_src;
        mediaType = "audio";
      } else if (!text && item.item_type) {
        text = `[${item.item_type}]`;
      }

      const tsMicros = Number(item.timestamp || 0);
      const timestamp =
        tsMicros > 1e14
          ? new Date(Math.floor(tsMicros / 1000)).toISOString()
          : tsMicros > 1e11
          ? new Date(tsMicros).toISOString()
          : new Date().toISOString();

      return {
        itemId: String(item.item_id || `${t.thread_id}_${tsMicros}`),
        senderPk,
        isFromMe,
        text,
        mediaUrl,
        mediaType,
        timestamp,
      };
    });

    const lastMicros = Number(t.last_activity_at || 0);
    const lastActivityAt =
      lastMicros > 1e14
        ? new Date(Math.floor(lastMicros / 1000)).toISOString()
        : new Date().toISOString();

    return {
      threadId: String(t.thread_id),
      title: String(t.thread_title || recipientName),
      recipientPk,
      recipientUsername,
      recipientName,
      recipientAvatar: otherUser.profile_pic_url || undefined,
      lastActivityAt,
      messages: parsedMsgs.reverse(),
    };
  });
}
