import { NextRequest, NextResponse } from "next/server";
import { requireProjectRole } from "@/lib/auth/project";
import { toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { fetchDirectProfile } from "@/lib/instagram/direct-client";
import { verifyMetaCredentials } from "@/lib/instagram/meta-client";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireProjectRole("agent");

    const { data: config, error: configError } = await supabaseAdmin()
      .from("instagram_config")
      .select("*")
      .eq("project_id", ctx.projectId)
      .eq("status", "connected")
      .maybeSingle();

    if (configError || !config) {
      return NextResponse.json(
        { error: "No connected Instagram account found." },
        { status: 404 },
      );
    }

    let updatedName = config.name || config.username;
    let updatedProfilePic = config.profile_picture_url || "";
    let followersCount: number | null = null;
    let followingCount: number | null = null;
    let postsCount: number | null = null;
    let biography: string | null = null;
    let isVerified = false;

    if (config.connection_method === "cloud_api" && config.access_token) {
      try {
        const metaProfile = await verifyMetaCredentials(
          config.access_token,
          config.instagram_business_id || undefined,
        );
        updatedName = metaProfile.name || metaProfile.username || updatedName;
        updatedProfilePic = metaProfile.profilePictureUrl || updatedProfilePic;
      } catch (err) {
        console.warn("[Instagram Sync] Meta sync warning:", err);
      }
    } else {
      // Direct connection
      const profile = await fetchDirectProfile(undefined, config.username || undefined);
      if (profile.name) updatedName = profile.name;
      if (profile.profilePictureUrl) updatedProfilePic = profile.profilePictureUrl;
      followersCount = profile.followersCount ?? null;
      followingCount = profile.followingCount ?? null;
      postsCount = profile.postsCount ?? null;
      biography = profile.biography ?? null;
      isVerified = !!profile.isVerified;
    }

    // Save refreshed details to DB
    await supabaseAdmin()
      .from("instagram_config")
      .update({
        name: updatedName,
        profile_picture_url: updatedProfilePic || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", config.id);

    return NextResponse.json({
      success: true,
      username: config.username,
      name: updatedName,
      profile_picture_url: updatedProfilePic,
      followers_count: followersCount,
      following_count: followingCount,
      posts_count: postsCount,
      biography: biography,
      is_verified: isVerified,
    });
  } catch (err: unknown) {
    return toErrorResponse(err);
  }
}
