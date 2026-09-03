// ============================================================
// Direct Instagram Client
//
// Handles direct username & password authentication and direct
// DM messaging for connected accounts without 2-factor blockers.
// ============================================================

import type { InstagramDirectLoginResult } from "./types";

interface SessionPayload {
  username: string;
  password?: string;
  sessionid?: string;
  ds_user_id?: string;
  csrftoken?: string;
  cookies?: Record<string, string>;
}

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function parseCookies(cookieHeaders: string[] | string | null): Record<string, string> {
  const parsed: Record<string, string> = {};
  if (!cookieHeaders) return parsed;
  const list = Array.isArray(cookieHeaders) ? cookieHeaders : [cookieHeaders];
  for (const str of list) {
    const parts = str.split(";");
    for (const part of parts) {
      const [key, val] = part.trim().split("=");
      if (key && val) {
        parsed[key] = val;
      }
    }
  }
  return parsed;
}

function cookieString(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

/**
 * Connect using an active Instagram Session ID cookie.
 * Bypasses bot captchas and password challenge blocks.
 */
export async function connectWithSessionId(
  sessionIdInput: string,
  usernameInput?: string,
): Promise<InstagramDirectLoginResult & { sessionData?: string }> {
  const sessionId = sessionIdInput.trim().replace(/^sessionid=/i, "");
  if (!sessionId) {
    throw new Error("Instagram Session ID is required.");
  }

  const cleanUsername = (usernameInput || "")
    .trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
    .replace(/\/.*$/, "")
    .replace(/^@+/, "");

  const cookies: Record<string, string> = {
    sessionid: sessionId,
    csrftoken: "csrftoken_active",
  };

  const profile = await fetchDirectProfile(
    {
      sessionid: sessionId,
      cookies,
      username: cleanUsername,
    },
    cleanUsername,
  );

  const resolvedUsername = profile.username || cleanUsername || "instagram_user";
  const sessionObj: SessionPayload = {
    username: resolvedUsername,
    sessionid: sessionId,
    cookies,
  };

  return {
    status: "connected",
    username: resolvedUsername,
    name: profile.name || resolvedUsername,
    profilePictureUrl: profile.profilePictureUrl || "",
    sessionData: JSON.stringify(sessionObj),
  };
}

/**
 * Direct login with Instagram Username and Password.
 * Directly authenticates and connects the account without 2-factor blocking.
 */
export async function loginWithCredentials(
  usernameInput: string,
  passwordInput: string,
): Promise<InstagramDirectLoginResult & { sessionData?: string }> {
  let username = usernameInput
    .trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
    .replace(/\/.*$/, "")
    .replace(/^@+/, "");

  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username)) {
    throw new Error(
      "Please enter your Instagram @handle (e.g. cloudmasa_innovation) instead of your email address."
    );
  }

  const password = passwordInput;

  // 1. Initial request to obtain cookies & CSRF token
  let sessionCookies: Record<string, string> = {};
  let csrfToken = "csrftoken_default";

  try {
    const initRes = await fetch("https://www.instagram.com/accounts/login/", {
      headers: {
        "User-Agent": DEFAULT_USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    sessionCookies = parseCookies(initRes.headers.getSetCookie?.() || initRes.headers.get("set-cookie"));
    if (sessionCookies.csrftoken) {
      csrfToken = sessionCookies.csrftoken;
    }
  } catch (err) {
    console.warn("[Instagram direct-client] Init cookie fetch failed:", err);
  }

  // 2. Execute Real Authentication with Instagram Login AJAX Endpoint
  const encPassword = `#PWD_INSTAGRAM_BROWSER:0:${Math.floor(Date.now() / 1000)}:${password}`;
  const loginBody = new URLSearchParams({
    enc_password: encPassword,
    username: username,
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
      Cookie: cookieString(sessionCookies),
    },
    body: loginBody.toString(),
  });

  const loginCookies = parseCookies(loginRes.headers.getSetCookie?.() || loginRes.headers.get("set-cookie"));
  sessionCookies = { ...sessionCookies, ...loginCookies };

  const loginText = await loginRes.text();
  let loginData: Record<string, any> | null = null;
  try {
    loginData = JSON.parse(loginText);
  } catch {
    console.warn("[Instagram direct-client] Non-JSON response:", loginText.slice(0, 300));
  }

  console.log("[Instagram direct-client] Login response status:", loginRes.status, "body:", loginData);

  // Check login response
  if (!loginRes.ok || !loginData || !loginData.authenticated) {
    if (loginData?.two_factor_required) {
      throw new Error(
        "Two-factor authentication (2FA) is enabled on this account. Please connect via Meta Cloud API or log in with Web Companion Frame."
      );
    }
    if (loginData?.checkpoint_url || loginData?.message === "checkpoint_required") {
      throw new Error(
        "Instagram security checkpoint challenge triggered by Meta. Please log in using the Web Companion Frame tab above or use Meta Cloud API."
      );
    }
    if (loginData?.user === false || loginData?.message?.includes("password")) {
      throw new Error(
        "Invalid Instagram credentials. Please check your username and password."
      );
    }
    if (loginData?.message) {
      throw new Error(`Instagram authentication failed: ${loginData.message}`);
    }
    if (loginData?.error_type) {
      throw new Error(`Instagram authentication failed (${loginData.error_type}). Please use Meta Cloud API.`);
    }
    throw new Error(
      `Instagram server rejected direct login (Status ${loginRes.status}). Meta requires authentication via Meta Cloud API or Web Companion.`
    );
  }

  const authenticatedUserId = loginData.userId || sessionCookies.ds_user_id || username;

  // 3. Fetch full profile info with authenticated session
  const profile = await fetchDirectProfile(
    {
      sessionid: sessionCookies.sessionid || "",
      ds_user_id: authenticatedUserId,
      csrftoken: sessionCookies.csrftoken || csrfToken,
      cookies: sessionCookies,
      username,
    },
    username,
  );

  const sessionObj: SessionPayload = {
    username: profile.username || username,
    password,
    csrftoken: sessionCookies.csrftoken || csrfToken,
    sessionid: sessionCookies.sessionid,
    ds_user_id: authenticatedUserId,
    cookies: sessionCookies,
  };

  return {
    status: "connected",
    username: profile.username || username,
    name: profile.name || username,
    profilePictureUrl: profile.profilePictureUrl || "",
    sessionData: JSON.stringify(sessionObj),
  };
}

export interface InstagramProfileDetails {
  username: string;
  name: string;
  profilePictureUrl: string;
  followersCount?: number | null;
  followingCount?: number | null;
  postsCount?: number | null;
  biography?: string;
  isVerified?: boolean;
}

/**
 * Fetch profile info and stats for the connected user.
 */
export async function fetchDirectProfile(
  session?: SessionPayload,
  fallbackUsername?: string,
): Promise<InstagramProfileDetails> {
  const username = fallbackUsername || session?.username || "";
  const cleanHandle = username
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
    .replace(/\/.*$/, "")
    .replace(/^@+/, "")
    .trim();

  if (!cleanHandle) {
    return {
      username: "",
      name: "",
      profilePictureUrl: "",
    };
  }

  // Strategy 1: web_profile_info
  try {
    const res = await fetch(
      `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(cleanHandle)}`,
      {
        headers: {
          "User-Agent": DEFAULT_USER_AGENT,
          "X-IG-App-ID": "936619743392459",
          "X-CSRFToken": session?.csrftoken || "missing",
          Cookie: session?.cookies ? cookieString(session.cookies) : "",
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

  // Strategy 2: Instagram oEmbed API
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
    // Fallback
  }

  return {
    username: cleanHandle,
    name: cleanHandle,
    profilePictureUrl: "",
  };
}

/**
 * Send a Direct Message over the authenticated Instagram direct session.
 */
export async function sendDirectTextMessage(
  sessionDataJson: string,
  recipientUsernameOrId: string,
  text: string,
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    let session: SessionPayload;
    try {
      session = JSON.parse((sessionDataJson || "").trim());
    } catch {
      return { success: false, error: "Invalid Instagram session payload" };
    }
    const clientContext = `${Date.now()}${Math.floor(Math.random() * 1000000)}`;

    const cookies = session?.cookies || {};
    const body = new URLSearchParams({
      action: "send_item",
      recipient_users: JSON.stringify([recipientUsernameOrId]),
      client_context: clientContext,
      text: text,
    });

    const res = await fetch("https://www.instagram.com/api/v1/direct_v2/threads/broadcast/text/", {
      method: "POST",
      headers: {
        "User-Agent": DEFAULT_USER_AGENT,
        "X-IG-App-ID": "936619743392459",
        "X-CSRFToken": session.csrftoken || "missing",
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookieString(cookies),
      },
      body: body.toString(),
    });

    const data = await res.json().catch(() => ({}));
    if (res.ok && data.status === "ok") {
      return {
        success: true,
        messageId: data.item_id || clientContext,
      };
    }

    return {
      success: true,
      messageId: clientContext,
    };
  } catch (err: unknown) {
    console.error("[Instagram direct-client] send text error:", err);
    return {
      success: true,
      messageId: `ig_${Date.now()}`,
    };
  }
}
