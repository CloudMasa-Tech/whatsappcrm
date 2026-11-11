import { NextResponse } from "next/server";
import { requireProjectRole } from "@/lib/auth/project";
import { UnauthorizedError, ForbiddenError, toErrorResponse } from "@/lib/auth/account";
import { decrypt, encrypt } from "@/lib/whatsapp/encryption";
import {
  loginWithCredentials,
  connectWithSessionId,
  completeTwoFactorLogin,
  fetchDirectProfile,
  type DirectSessionPayload,
} from "@/lib/instagram/direct-client";

export async function POST(request: Request) {
  try {
    const ctx = await requireProjectRole("admin");
    const body = await request.json().catch(() => null);

    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { action, username, password, session_id, verification_code, verification_method } = body;

    // 1. Complete 2FA challenge for an active '2fa_pending' attempt
    if (action === "two_factor") {
      const code = typeof verification_code === "string" ? verification_code.trim() : "";
      if (!code) {
        return NextResponse.json({ error: "Verification code is required" }, { status: 400 });
      }

      const { data: pendingRow, error: rowErr } = await ctx.supabase
        .from("instagram_config")
        .select("id, session_data, two_factor_identifier")
        .eq("project_id", ctx.projectId)
        .maybeSingle();

      if (rowErr || !pendingRow?.session_data || !pendingRow?.two_factor_identifier) {
        return NextResponse.json(
          { error: "No active two-factor challenge found. Please sign in again." },
          { status: 400 },
        );
      }

      const pendingSession = decrypt(pendingRow.session_data);
      const method =
        verification_method === "sms" || verification_method === "email"
          ? verification_method
          : "totp";

      const result = await completeTwoFactorLogin(
        pendingSession,
        pendingRow.two_factor_identifier,
        code,
        method,
      );

      const sessionObj = result.sessionData
        ? (JSON.parse(result.sessionData) as DirectSessionPayload)
        : undefined;
      const fullProfile = await fetchDirectProfile(sessionObj, result.username);

      const encryptedSession = encrypt(result.sessionData || pendingSession);
      const { error: upsertErr } = await ctx.supabase
        .from("instagram_config")
        .update({
          connection_method: "direct",
          username: fullProfile.username || result.username,
          name: fullProfile.name || result.name,
          profile_picture_url: fullProfile.profilePictureUrl || result.profilePictureUrl || null,
          biography: fullProfile.biography || null,
          followers_count: fullProfile.followersCount ?? null,
          following_count: fullProfile.followingCount ?? null,
          media_count: fullProfile.postsCount ?? null,
          is_verified: Boolean(fullProfile.isVerified),
          session_data: encryptedSession,
          two_factor_identifier: null,
          status: "connected",
          last_error: null,
          connected_at: new Date().toISOString(),
          last_synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", pendingRow.id);

      if (upsertErr) {
        return NextResponse.json(
          { error: upsertErr.message || "Failed to save Instagram connection" },
          { status: 500 },
        );
      }

      return NextResponse.json({
        status: "connected",
        username: fullProfile.username || result.username,
        name: fullProfile.name || result.name,
        profilePictureUrl: fullProfile.profilePictureUrl || result.profilePictureUrl || null,
      });
    }

    // 2. Initial Direct login (Username & Password OR Session Cookie)
    if (action === "login" || !action) {
      let result;
      let cleanUsername = (username || "").trim().replace(/^@/, "");

      if (session_id && typeof session_id === "string") {
        result = await connectWithSessionId(session_id.trim(), cleanUsername);
        cleanUsername = result.username || cleanUsername;
      } else {
        if (!username || !password) {
          return NextResponse.json(
            { error: "Username and password (or Instagram Session ID) are required" },
            { status: 400 },
          );
        }
        result = await loginWithCredentials(cleanUsername, password);
      }

      const encryptedSession = result.sessionData ? encrypt(result.sessionData) : null;

      if (result.status === "2fa_required") {
        await ctx.supabase.from("instagram_config").upsert(
          {
            account_id: ctx.accountId,
            project_id: ctx.projectId,
            user_id: ctx.userId,
            connection_method: "direct",
            username: result.username || cleanUsername,
            session_data: encryptedSession,
            two_factor_identifier: result.twoFactorIdentifier || null,
            status: "2fa_pending",
            last_error: null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "project_id" },
        );

        return NextResponse.json({
          status: "2fa_required",
          twoFactorType: result.twoFactorType || "totp",
          obfuscatedPhone: result.obfuscatedPhone || null,
          username: result.username || cleanUsername,
        });
      }

      const sessionObj = result.sessionData
        ? (JSON.parse(result.sessionData) as DirectSessionPayload)
        : undefined;
      const fullProfile = await fetchDirectProfile(sessionObj, result.username || cleanUsername);

      const { error: upsertErr } = await ctx.supabase.from("instagram_config").upsert(
        {
          account_id: ctx.accountId,
          project_id: ctx.projectId,
          user_id: ctx.userId,
          connection_method: "direct",
          username: fullProfile.username || result.username || cleanUsername,
          name: fullProfile.name || result.name || cleanUsername,
          profile_picture_url: fullProfile.profilePictureUrl || result.profilePictureUrl || null,
          biography: fullProfile.biography || null,
          followers_count: fullProfile.followersCount ?? null,
          following_count: fullProfile.followingCount ?? null,
          media_count: fullProfile.postsCount ?? null,
          is_verified: Boolean(fullProfile.isVerified),
          session_data: encryptedSession,
          two_factor_identifier: null,
          status: "connected",
          last_error: null,
          connected_at: new Date().toISOString(),
          last_synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "project_id" },
      );

      if (upsertErr) {
        if (upsertErr.code === "PGRST205" || upsertErr.message?.includes("Could not find the table")) {
          return NextResponse.json(
            {
              error:
                "Database table 'instagram_config' not found. Please run migrations 052 and 062 in Supabase.",
              table_missing: true,
            },
            { status: 400 },
          );
        }

        console.error("[POST /api/instagram/auth] upsert error:", upsertErr);
        return NextResponse.json(
          { error: upsertErr.message || "Failed to save Instagram connection to database" },
          { status: 500 },
        );
      }

      return NextResponse.json({
        status: "connected",
        username: fullProfile.username || result.username || cleanUsername,
        name: fullProfile.name || result.name || cleanUsername,
        profilePictureUrl: fullProfile.profilePictureUrl || result.profilePictureUrl || null,
      });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err: unknown) {
    if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
      return toErrorResponse(err);
    }
    console.error("[POST /api/instagram/auth] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Authentication failed" },
      { status: 400 },
    );
  }
}
