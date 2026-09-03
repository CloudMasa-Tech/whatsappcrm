import { NextResponse } from "next/server";
import { requireProjectRole } from "@/lib/auth/project";
import { UnauthorizedError, ForbiddenError, toErrorResponse } from "@/lib/auth/account";
import { encrypt } from "@/lib/whatsapp/encryption";
import { loginWithCredentials, connectWithSessionId } from "@/lib/instagram/direct-client";

export async function POST(request: Request) {
  try {
    const ctx = await requireProjectRole("agent");
    const body = await request.json().catch(() => null);

    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { action, username, password, session_id } = body;

    if (action === "login" || !action) {
      let result;
      let cleanUsername = (username || "").trim().replace(/^@/, "");

      if (session_id && typeof session_id === "string") {
        result = await connectWithSessionId(session_id.trim(), cleanUsername);
        cleanUsername = result.username;
      } else {
        if (!username || !password) {
          return NextResponse.json(
            { error: "Username and password (or Instagram Session ID) are required" },
            { status: 400 },
          );
        }
        result = await loginWithCredentials(cleanUsername, password);
      }

      const sessionToSave = result.sessionData || JSON.stringify({ username: cleanUsername, password });
      const encryptedSession = encrypt(sessionToSave);

      const { error: upsertErr } = await ctx.supabase.from("instagram_config").upsert(
        {
          account_id: ctx.accountId,
          project_id: ctx.projectId,
          user_id: ctx.userId,
          connection_method: "direct",
          username: result.username || cleanUsername,
          name: result.name || cleanUsername,
          profile_picture_url: result.profilePictureUrl || null,
          session_data: encryptedSession,
          two_factor_identifier: null,
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

        console.error("[POST /api/instagram/auth] upsert error:", upsertErr);
        return NextResponse.json(
          { error: upsertErr.message || "Failed to save Instagram connection to database" },
          { status: 500 },
        );
      }

      return NextResponse.json({
        status: "connected",
        username: result.username || cleanUsername,
        name: result.name || cleanUsername,
        profilePictureUrl: result.profilePictureUrl || null,
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
