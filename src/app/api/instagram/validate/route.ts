import { NextRequest, NextResponse } from "next/server";
import { getCurrentProject } from "@/lib/auth/project";
import { toErrorResponse } from "@/lib/auth/account";

export const dynamic = "force-dynamic";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

export async function POST(request: NextRequest) {
  try {
    await getCurrentProject().catch(() => null);
    const body = await request.json().catch(() => null);

    const rawUsername = body?.username?.trim() || "";

    if (!rawUsername) {
      return NextResponse.json({ error: "Username is required." }, { status: 400 });
    }

    // Check if user entered an email address
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawUsername)) {
      return NextResponse.json(
        {
          error: "It looks like you entered an email address. Please enter your Instagram username/handle (e.g. cloudmasa_innovation) instead.",
          isEmail: true,
        },
        { status: 400 },
      );
    }

    // Clean up handle from full URL or @ prefix
    let cleanHandle = rawUsername
      .replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
      .replace(/\/.*$/, "")
      .replace(/^@+/, "")
      .trim();

    // Instagram usernames only allow letters, numbers, periods, and underscores, max 30 chars
    if (!/^[a-zA-Z0-9._]{1,30}$/.test(cleanHandle)) {
      return NextResponse.json(
        {
          error: "Invalid Instagram username format. Usernames can only contain letters, numbers, periods, and underscores (max 30 characters).",
        },
        { status: 400 },
      );
    }

    // Fetch public profile info from Instagram
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
      // Fallback
    }

    // If Instagram web API was rate-limited or blocked, attempt oEmbed validation
    try {
      const oembedRes = await fetch(
        `https://api.instagram.com/oembed/?url=https://www.instagram.com/${encodeURIComponent(cleanHandle)}/`,
        { headers: { "User-Agent": DEFAULT_USER_AGENT } },
      );
      if (oembedRes.ok) {
        const oembedData = await oembedRes.json();
        return NextResponse.json({
          valid: true,
          username: oembedData.author_name || cleanHandle,
          name: oembedData.author_name || cleanHandle,
          profilePictureUrl: "",
          isVerified: false,
        });
      }
    } catch {
      // Fallback
    }

    // Return valid structured username
    return NextResponse.json({
      valid: true,
      username: cleanHandle,
      name: cleanHandle,
      profilePictureUrl: "",
    });
  } catch (err: unknown) {
    return toErrorResponse(err);
  }
}
