import { NextResponse } from "next/server";
import { getCurrentProject, requireProjectRole } from "@/lib/auth/project";
import { encrypt } from "@/lib/whatsapp/encryption";
import { verifyMetaCredentials } from "@/lib/instagram/meta-client";
import { toErrorResponse } from "@/lib/auth/account";

export async function GET(request: Request) {
  try {
    const ctx = await getCurrentProject();
    const origin = new URL(request.url).origin;
    const webhookUrl = `${origin}/api/instagram/webhook`;
    const defaultVerifyToken = `wacrm_ig_${ctx.projectId.slice(0, 8)}`;

    const { data: config, error } = await ctx.supabase
      .from("instagram_config")
      .select(
        "id, connection_method, username, name, profile_picture_url, status, last_error, instagram_business_id, page_id, connected_at, created_at, updated_at",
      )
      .eq("project_id", ctx.projectId)
      .maybeSingle();

    if (error) {
      // If table doesn't exist in DB schema yet
      if (error.code === "PGRST205" || error.message?.includes("Could not find the table")) {
        return NextResponse.json({
          config: {
            status: "disconnected",
            connection_method: "direct",
          },
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

    return NextResponse.json({
      config: config ?? {
        status: "disconnected",
        connection_method: "direct",
      },
      webhook_url: webhookUrl,
      default_verify_token: defaultVerifyToken,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireProjectRole("agent");
    const body = await request.json().catch(() => null);

    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { access_token, instagram_business_id, page_id, verify_token, app_secret } = body;

    if (!access_token || typeof access_token !== "string") {
      return NextResponse.json({ error: "Meta Access Token is required" }, { status: 400 });
    }

    // Verify token with Meta Graph API
    let profile;
    try {
      profile = await verifyMetaCredentials(access_token.trim(), instagram_business_id?.trim());
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

    const encryptedAccessToken = encrypt(access_token.trim());
    const verifyTokenToSave = verify_token?.trim() || `wacrm_ig_${ctx.projectId.slice(0, 8)}`;
    const encryptedVerifyToken = encrypt(verifyTokenToSave);

    const { error: upsertErr } = await ctx.supabase.from("instagram_config").upsert(
      {
        account_id: ctx.accountId,
        project_id: ctx.projectId,
        user_id: ctx.userId,
        connection_method: "cloud_api",
        instagram_business_id: instagram_business_id?.trim() || profile.id,
        page_id: page_id?.trim() || null,
        access_token: encryptedAccessToken,
        verify_token: encryptedVerifyToken,
        app_secret: app_secret?.trim() ? encrypt(app_secret.trim()) : null,
        username: profile.username,
        name: profile.name,
        profile_picture_url: profile.profilePictureUrl || null,
        status: "connected",
        last_error: null,
        connected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "project_id" },
    );

    if (upsertErr) {
      if (upsertErr.code === "PGRST205" || upsertErr.message?.includes("Could not find the table")) {
        return NextResponse.json(
          {
            error:
              "Database table 'instagram_config' not found. Please run the SQL migration (052_instagram_integration.sql) in your Supabase SQL Editor.",
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
      profile,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await requireProjectRole("agent");

    // Enforce role check: customer role CANNOT disconnect Instagram
    const { data: profile } = await ctx.supabase
      .from("profiles")
      .select("role, platform_role")
      .eq("user_id", ctx.userId)
      .maybeSingle();

    const isCustomerUser =
      profile?.role === "customer" ||
      (ctx.platformRole === "customer" &&
        profile?.role !== "agent" &&
        ctx.role !== "owner" &&
        ctx.role !== "admin");

    if (isCustomerUser) {
      return NextResponse.json(
        {
          error:
            "Customer accounts cannot disconnect the Instagram channel. Contact your administrator.",
        },
        { status: 403 },
      );
    }

    // Reset status to disconnected and clear credentials
    const { error } = await ctx.supabase
      .from("instagram_config")
      .update({
        status: "disconnected",
        session_data: null,
        two_factor_identifier: null,
        access_token: null,
        verify_token: null,
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
