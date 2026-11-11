import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/auth/account";
import { requireProject } from "@/lib/auth/project";
import { getInstagramMessageMediaUrl } from "@/lib/instagram/meta-client";
import type { InstagramTokenType } from "@/lib/instagram/types";
import { ephemeralMediaCache } from "@/lib/media/ephemeral-cache";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { decrypt } from "@/lib/whatsapp/encryption";

export const dynamic = "force-dynamic";

const MAX_MEDIA_BYTES = 16 * 1024 * 1024;

interface IgMediaDescriptor {
  v: 1;
  p: string;
  u: string;
  mid?: string | null;
  k?: string;
}

const ALLOWED_META_CDN_SUFFIXES = [
  ".fbcdn.net",
  ".fbsbx.com",
  ".cdninstagram.com",
  ".instagram.com",
  ".facebook.com",
];

function isAllowedMetaCdnUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    return ALLOWED_META_CDN_SUFFIXES.some(
      (suffix) => host === suffix.slice(1) || host.endsWith(suffix),
    );
  } catch {
    return false;
  }
}

function unsealIgMediaRef(ref: string): IgMediaDescriptor | null {
  try {
    const encrypted = Buffer.from(ref, "base64url").toString("utf8");
    const parsed = JSON.parse(decrypt(encrypted)) as Partial<IgMediaDescriptor>;
    if (
      parsed?.v !== 1 ||
      typeof parsed.p !== "string" ||
      typeof parsed.u !== "string" ||
      !parsed.p ||
      !parsed.u
    ) {
      return null;
    }
    return parsed as IgMediaDescriptor;
  } catch {
    return null;
  }
}

function buildDirectCookieHeader(sessionDataEncrypted: string): string | null {
  try {
    const parsed = JSON.parse(decrypt(sessionDataEncrypted)) as Record<string, string>;
    const pairs: string[] = [];
    if (parsed.sessionid) pairs.push(`sessionid=${parsed.sessionid}`);
    if (parsed.csrftoken) pairs.push(`csrftoken=${parsed.csrftoken}`);
    if (parsed.ds_user_id) pairs.push(`ds_user_id=${parsed.ds_user_id}`);
    return pairs.length > 0 ? pairs.join("; ") : null;
  } catch {
    return null;
  }
}

async function fetchAllowlistedUpstream(
  initialUrl: string,
  cookieHeader: string | null,
): Promise<Response> {
  let current = initialUrl;
  for (let hop = 0; hop < 4; hop++) {
    if (!isAllowedMetaCdnUrl(current)) {
      throw new Error("Blocked non-Meta media host");
    }
    const headers: Record<string, string> = {
      "User-Agent": "Mozilla/5.0",
    };
    if (cookieHeader) {
      headers.Cookie = cookieHeader;
    }
    const res = await fetch(current, {
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new Error("Redirect missing Location");
      current = new URL(loc, current).toString();
      continue;
    }
    return res;
  }
  throw new Error("Too many redirects fetching Instagram media");
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const ref = searchParams.get("ref")?.trim() ?? "";
    if (!ref) {
      return NextResponse.json({ error: "Missing media ref" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const desc = unsealIgMediaRef(ref);
    if (!desc) {
      return NextResponse.json({ error: "Invalid media reference" }, { status: 400 });
    }

    await requireProject(desc.p);

    const cacheKey = ephemeralMediaCache.keyFor(
      "ig-dm",
      `${desc.p}:${desc.mid || desc.u}`,
    );

    const media = await ephemeralMediaCache.getOrLoad(cacheKey, async () => {
      const db = supabaseAdmin();
      const { data: cfg } = await db
        .from("instagram_config")
        .select("connection_method, session_data, access_token, token_type")
        .eq("project_id", desc.p)
        .maybeSingle();

      const cookieHeader =
        cfg?.connection_method === "direct" && cfg.session_data
          ? buildDirectCookieHeader(cfg.session_data as string)
          : null;

      let res = await fetchAllowlistedUpstream(desc.u, cookieHeader);

      if (
        !res.ok &&
        desc.mid &&
        cfg?.connection_method !== "direct" &&
        cfg?.access_token
      ) {
        try {
          const decryptedToken = decrypt(cfg.access_token as string);
          const refreshed = await getInstagramMessageMediaUrl(
            decryptedToken,
            desc.mid,
            (cfg.token_type as InstagramTokenType | null) ?? null,
          );
          if (refreshed) {
            res = await fetchAllowlistedUpstream(refreshed, null);
          }
        } catch {
          // Keep original failure response below
        }
      }

      if (!res.ok) {
        throw new Error(`Upstream media responded ${res.status}`);
      }

      const arr = await res.arrayBuffer();
      if (arr.byteLength === 0 || arr.byteLength > MAX_MEDIA_BYTES) {
        throw new Error("Instagram media exceeds size bounds or is empty");
      }

      return {
        buffer: Buffer.from(arr),
        contentType:
          res.headers.get("content-type") || "application/octet-stream",
      };
    });

    return new Response(new Uint8Array(media.buffer), {
      status: 200,
      headers: {
        "Content-Type": media.contentType,
        "Cache-Control": "private, max-age=604800, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

