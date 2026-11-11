import { NextRequest, NextResponse } from "next/server";
import { requireProjectRole } from "@/lib/auth/project";
import { toErrorResponse } from "@/lib/auth/account";
import { normalizeHandle } from "@/lib/instagram/direct-client";

export const dynamic = "force-dynamic";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export async function POST(request: NextRequest) {
  try {
    await requireProjectRole("admin");
    const body = await request.json().catch(() => null);
    const rawUsername = body?.username?.trim() || "";

    if (!rawUsername) {
      return NextResponse.json({ error: "Username is required." }, { status: 400 });
    }

    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawUsername)) {
      return NextResponse.json(
        {
          error:
            "It looks like you entered an email address. Please enter your Instagram handle (e.g. cloudmasa_innovation) instead.",
          isEmail: true,
        },
        { status: 400 },
      );
    }

    const cleanHandle = normalizeHandle(rawUsername);

    if (!/^[a-zA-Z0-9._]{1,30}$/.test(cleanHandle)) {
      return NextResponse.json(
        {
          error:
            "Invalid Instagram username format. Usernames can only contain letters, numbers, periods, and underscores (max 30 characters).",
        },
        { status: 400 },
      );
    }

    // 1. Check web_profile_info
    try {
      const res = await fetch(
        `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(cleanHandle)}`,
        {
          headers: {
            "User-Agent": DEFAULT_USER_AGENT,
            "X-IG-App-ID": "936619743392459",
            Accept: "application/json",
          },
          cache: "no-store",
        },
      );

      if (res.status === 404) {
        return NextResponse.json(
          { valid: false, error: `Instagram account @${cleanHandle} does not exist.` },
          { status: 404 },
        );
      }

      if (res.ok) {
        const data = await res.json();
        const user = data.data?.user;
        if (user) {
          return NextResponse.json({
            valid: true,
            username: user.username || cleanHandle,
            name: user.full_name || user.username || cleanHandle,
            profilePictureUrl: user.profile_pic_url_hd || user.profile_pic_url || "",
            isVerified: !!user.is_verified,
            isPrivate: !!user.is_private,
            biography: user.biography || "",
            followersCount: user.edge_followed_by?.count ?? null,
          });
        }
      }
    } catch {
      // Fall through to oEmbed check
    }

    // 2. Fallback oEmbed verification
    try {
      const oembedRes = await fetch(
        `https://api.instagram.com/oembed/?url=https://www.instagram.com/${encodeURIComponent(cleanHandle)}/`,
        { headers: { "User-Agent": DEFAULT_USER_AGENT }, cache: "no-store" },
      );
      if (oembedRes.ok) {
        const oembedData = await oembedRes.json();
        return NextResponse.json({
          valid: true,
          username: oembedData.author_name || cleanHandle,
          name: oembedData.author_name || cleanHandle,
          profilePictureUrl: oembedData.thumbnail_url || "",
          isVerified: false,
        });
      }
    } catch {
      // Rate-limited or unreachable
    }

    // Never falsely confirm account existence when Meta could not verify it
    return NextResponse.json({
      valid: false,
      unverified: true,
      username: cleanHandle,
      name: cleanHandle,
      profilePictureUrl: "",
    });
  } catch (err: unknown) {
    return toErrorResponse(err);
  }
}
