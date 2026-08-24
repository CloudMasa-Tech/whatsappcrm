import { NextResponse } from "next/server";
import { requireProjectRole } from "@/lib/auth/project";
import { encrypt } from "@/lib/whatsapp/encryption";
import { loginWithCredentials } from "@/lib/instagram/direct-client";

export async function POST(request: Request) {
  try {
    const ctx = await requireProjectRole("agent");
    const body = await request.json().catch(() => null);

    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { action, username, password } = body;

    if (action === "login" || !action) {
      if (!username || !password) {
        return NextResponse.json(
          { error: "Username and password are required" },
          { status: 400 },
        );
      }

      const cleanUsername = username.trim().replace(/^@/, "");
      const result = await loginWithCredentials(cleanUsername, password);

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
    console.error("[POST /api/instagram/auth] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 },
    );
  }
}
