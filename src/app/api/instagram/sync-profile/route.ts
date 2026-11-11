import { NextResponse } from "next/server";
import { requireProjectRole } from "@/lib/auth/project";
import { toErrorResponse } from "@/lib/auth/account";
import { decrypt } from "@/lib/whatsapp/encryption";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { fetchDirectProfile, type DirectSessionPayload } from "@/lib/instagram/direct-client";
import { verifyMetaCredentials } from "@/lib/instagram/meta-client";
import type { InstagramTokenType } from "@/lib/instagram/types";

export const dynamic = "force-dynamic";

export async function POST() {
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

    let updatedUsername = config.username;
    let updatedName = config.name || config.username;
    let updatedProfilePic = config.profile_picture_url || "";
    let followersCount: number | null = config.followers_count ?? null;
    let followingCount: number | null = config.following_count ?? null;
    let postsCount: number | null = config.media_count ?? null;
    let biography: string | null = config.biography ?? null;
    let website: string | null = config.website ?? null;
    let isVerified = Boolean(config.is_verified);
    let grantedScopes: string[] = config.granted_scopes ?? [];

    if (config.connection_method === "cloud_api" && config.access_token) {
      const decryptedToken = decrypt(config.access_token);
      const metaProfile = await verifyMetaCredentials(
        decryptedToken,
        config.instagram_business_id || undefined,
        (config.token_type as InstagramTokenType | undefined) ?? null,
        config.page_id || undefined,
      );
      updatedUsername = metaProfile.username || updatedUsername;
      updatedName = metaProfile.name || metaProfile.username || updatedName;
      updatedProfilePic = metaProfile.profilePictureUrl || updatedProfilePic;
      followersCount = metaProfile.followersCount ?? followersCount;
      followingCount = metaProfile.followingCount ?? followingCount;
      postsCount = metaProfile.mediaCount ?? postsCount;
      biography = metaProfile.biography ?? biography;
      website = metaProfile.website ?? website;
      if (metaProfile.grantedScopes?.length) {
        grantedScopes = metaProfile.grantedScopes;
      }
    } else {
      let session: DirectSessionPayload | undefined;
      if (config.session_data) {
        try {
          session = JSON.parse(decrypt(config.session_data)) as DirectSessionPayload;
        } catch {
          // Fallback to handle lookup
        }
      }
      const profile = await fetchDirectProfile(session, config.username || undefined);
      if (profile.username) updatedUsername = profile.username;
      if (profile.name) updatedName = profile.name;
      if (profile.profilePictureUrl) updatedProfilePic = profile.profilePictureUrl;
      followersCount = profile.followersCount ?? followersCount;
      followingCount = profile.followingCount ?? followingCount;
      postsCount = profile.postsCount ?? postsCount;
      biography = profile.biography ?? biography;
      isVerified = !!profile.isVerified;
    }

    const nowIso = new Date().toISOString();
    await supabaseAdmin()
      .from("instagram_config")
      .update({
        username: updatedUsername,
        name: updatedName,
        profile_picture_url: updatedProfilePic || null,
        biography,
        website,
        followers_count: followersCount,
        following_count: followingCount,
        media_count: postsCount,
        is_verified: isVerified,
        granted_scopes: grantedScopes,
        last_synced_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", config.id);

    return NextResponse.json({
      success: true,
      username: updatedUsername,
      name: updatedName,
      profile_picture_url: updatedProfilePic,
      followers_count: followersCount,
      following_count: followingCount,
      posts_count: postsCount,
      biography,
      website,
      is_verified: isVerified,
      granted_scopes: grantedScopes,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to sync Instagram profile" },
      { status: 400 },
    );
  }
}
