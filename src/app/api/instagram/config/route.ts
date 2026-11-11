import { NextResponse } from "next/server";
import { getCurrentProject, requireProjectRole } from "@/lib/auth/project";
import { decrypt, encrypt } from "@/lib/whatsapp/encryption";
import { sanitizeAccessToken, verifyMetaCredentials } from "@/lib/instagram/meta-client";
import { toErrorResponse } from "@/lib/auth/account";
import { fetchDirectProfile, type DirectSessionPayload } from "@/lib/instagram/direct-client";
import type { InstagramTokenType } from "@/lib/instagram/types";

export async function GET(request: Request) {
  try {
    const ctx = await getCurrentProject();
    const origin = new URL(request.url).origin;
    const webhookUrl = `${origin}/api/instagram/webhook`;
    const defaultVerifyToken = `masacrm_ig_${ctx.projectId.slice(0, 8)}`;

    const { data: config, error } = await ctx.supabase
      .from("instagram_config")
      .select("*")
      .eq("project_id", ctx.projectId)
      .maybeSingle();

    if (error) {
      if (error.code === "PGRST205" || error.message?.includes("Could not find the table")) {
        return NextResponse.json({
          config: { status: "disconnected", connection_method: "direct" },
          table_missing: true,
          webhook_url: webhookUrl,
          default_verify_token: defaultVerifyToken,
        });
      }

      console.error("[GET /api/instagram/config] error:", error);
      return NextResponse.json({
        config: { status: "disconnected", connection_method: "direct" },
        webhook_url: webhookUrl,
        default_verify_token: defaultVerifyToken,
      });
    }

    if (!config) {
      return NextResponse.json({
        config: { status: "disconnected", connection_method: "direct" },
        webhook_url: webhookUrl,
        default_verify_token: defaultVerifyToken,
      });
    }

    // Never expose raw encrypted secrets (`access_token`, `session_data`, `app_secret`, `verify_token`) to client
    const safeConfig = {
      id: config.id,
      connection_method: config.connection_method,
      token_type: config.token_type ?? "facebook_page",
      username: config.username,
      name: config.name,
      profile_picture_url: config.profile_picture_url,
      biography: config.biography ?? null,
      website: config.website ?? null,
      followers_count: config.followers_count ?? null,
      following_count: config.following_count ?? null,
      posts_count: config.media_count ?? null,
      is_verified: Boolean(config.is_verified),
      granted_scopes: config.granted_scopes ?? [],
      instagram_business_id: config.instagram_business_id,
      page_id: config.page_id,
      status: config.status,
      last_error: config.last_error,
      connected_at: config.connected_at,
      last_synced_at: config.last_synced_at ?? null,
      has_access_token: Boolean(config.access_token),
      has_app_secret: Boolean(config.app_secret),
      comment_auto_reply_enabled: Boolean(config.comment_auto_reply_enabled),
      comment_auto_reply_keyword: config.comment_auto_reply_keyword ?? "",
      comment_auto_reply_message: config.comment_auto_reply_message ?? "",
      comment_auto_dm_message: config.comment_auto_dm_message ?? "",
    };

    // Only opportunistically hydrate Direct profile if missing avatar/stats and session exists
    if (
      config.status === "connected" &&
      config.connection_method === "direct" &&
      config.username &&
      (!config.profile_picture_url || config.followers_count == null)
    ) {
      try {
        let session: DirectSessionPayload | undefined;
        if (config.session_data) {
          try {
            session = JSON.parse(decrypt(config.session_data)) as DirectSessionPayload;
          } catch {
            // Ignore decrypt error on background enrichment
          }
        }
        const liveProfile = await fetchDirectProfile(session, config.username);
        const enriched = {
          ...safeConfig,
          name: config.name && config.name !== config.username ? config.name : liveProfile.name || config.name,
          profile_picture_url: config.profile_picture_url || liveProfile.profilePictureUrl || null,
          followers_count: liveProfile.followersCount ?? safeConfig.followers_count,
          following_count: liveProfile.followingCount ?? safeConfig.following_count,
          posts_count: liveProfile.postsCount ?? safeConfig.posts_count,
          biography: safeConfig.biography || liveProfile.biography || null,
          is_verified: safeConfig.is_verified || !!liveProfile.isVerified,
        };

        return NextResponse.json({
          config: enriched,
          webhook_url: webhookUrl,
          default_verify_token: defaultVerifyToken,
        });
      } catch {
        // Fallback to DB row
      }
    }

    return NextResponse.json({
      config: safeConfig,
      webhook_url: webhookUrl,
      default_verify_token: defaultVerifyToken,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireProjectRole("admin");
    const body = await request.json().catch(() => null);

    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { access_token, instagram_business_id, page_id, verify_token, app_secret, token_type } = body;

    if (!access_token || typeof access_token !== "string" || !access_token.trim()) {
      return NextResponse.json({ error: "Meta Access Token is required" }, { status: 400 });
    }

    const cleanedToken = sanitizeAccessToken(access_token);
    if (!cleanedToken) {
      return NextResponse.json({ error: "Meta Access Token is required" }, { status: 400 });
    }

    const explicitTokenType: InstagramTokenType | null =
      token_type === "instagram_login" || token_type === "facebook_page" ? token_type : null;

    let profile;
    try {
      profile = await verifyMetaCredentials(
        cleanedToken,
        typeof instagram_business_id === "string" ? instagram_business_id.trim() : undefined,
        explicitTokenType,
        typeof page_id === "string" ? page_id.trim() : undefined,
      );
    } catch (err) {
      return NextResponse.json(
        {
          error:
            err instanceof Error
              ? err.message
              : "Failed to verify Meta Instagram credentials.",
        },
        { status: 400 },
      );
    }

    // Prefer resolved Page Access Token for Facebook Page flows so /messages & /conversations work seamlessly
    const effectiveToken = profile.pageAccessToken || cleanedToken;
    const encryptedAccessToken = encrypt(effectiveToken);
    const verifyTokenToSave =
      typeof verify_token === "string" && verify_token.trim()
        ? verify_token.trim()
        : `masacrm_ig_${ctx.projectId.slice(0, 8)}`;
    const encryptedVerifyToken = encrypt(verifyTokenToSave);

    const payload: Record<string, unknown> = {
      account_id: ctx.accountId,
      project_id: ctx.projectId,
      user_id: ctx.userId,
      connection_method: "cloud_api",
      token_type: profile.tokenType,
      instagram_business_id: profile.id || instagram_business_id?.trim() || null,
      page_id: profile.pageId || page_id?.trim() || null,
      access_token: encryptedAccessToken,
      verify_token: encryptedVerifyToken,
      username: profile.username,
      name: profile.name,
      profile_picture_url: profile.profilePictureUrl || null,
      biography: profile.biography ?? null,
      website: profile.website ?? null,
      followers_count: profile.followersCount ?? null,
      following_count: profile.followingCount ?? null,
      media_count: profile.mediaCount ?? null,
      is_verified: Boolean(profile.isVerified),
      granted_scopes: profile.grantedScopes ?? [],
      status: "connected",
      last_error: null,
      connected_at: new Date().toISOString(),
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (typeof app_secret === "string" && app_secret.trim()) {
      payload.app_secret = encrypt(app_secret.trim());
    }

    const { error: upsertErr } = await ctx.supabase
      .from("instagram_config")
      .upsert(payload, { onConflict: "project_id" });

    if (upsertErr) {
      if (
        upsertErr.code === "PGRST205" ||
        upsertErr.code === "PGRST204" ||
        upsertErr.code === "42703" ||
        upsertErr.message?.includes("Could not find the table") ||
        upsertErr.message?.includes("schema cache")
      ) {
        return NextResponse.json(
          {
            error:
              "Instagram database schema is missing or outdated. Please run supabase/migrations/052_instagram_integration.sql and 062_instagram_full_suite.sql in your Supabase SQL Editor.",
            table_missing: true,
          },
          { status: 400 },
        );
      }

      console.error("[POST /api/instagram/config] upsert error:", upsertErr);
      return NextResponse.json(
        { error: "Failed to save Instagram configuration" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      profile: {
        id: profile.id,
        username: profile.username,
        name: profile.name,
        profilePictureUrl: profile.profilePictureUrl,
        tokenType: profile.tokenType,
        pageId: profile.pageId ?? null,
        grantedScopes: profile.grantedScopes ?? [],
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await requireProjectRole("admin");
    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body.comment_auto_reply_enabled === "boolean") {
      patch.comment_auto_reply_enabled = body.comment_auto_reply_enabled;
    }
    if (typeof body.comment_auto_reply_keyword === "string") {
      patch.comment_auto_reply_keyword = body.comment_auto_reply_keyword.trim();
    }
    if (typeof body.comment_auto_reply_message === "string") {
      patch.comment_auto_reply_message = body.comment_auto_reply_message.trim();
    }
    if (typeof body.comment_auto_dm_message === "string") {
      patch.comment_auto_dm_message = body.comment_auto_dm_message.trim();
    }
    if (typeof body.app_secret === "string" && body.app_secret.trim()) {
      patch.app_secret = encrypt(body.app_secret.trim());
    }

    const { error } = await ctx.supabase
      .from("instagram_config")
      .update(patch)
      .eq("project_id", ctx.projectId);

    if (error) {
      console.error("[PATCH /api/instagram/config] error:", error);
      return NextResponse.json({ error: "Failed to update Instagram settings" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE() {
  try {
    const ctx = await requireProjectRole("admin");

    const { error } = await ctx.supabase
      .from("instagram_config")
      .update({
        status: "disconnected",
        session_data: null,
        two_factor_identifier: null,
        access_token: null,
        verify_token: null,
        app_secret: null,
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("project_id", ctx.projectId);

    if (error) {
      console.error("[DELETE /api/instagram/config] error:", error);
      return NextResponse.json(
        { error: "Failed to disconnect Instagram" },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
