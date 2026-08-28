import { NextResponse } from "next/server";

import { getCurrentAccount, requireRole, toErrorResponse } from "@/lib/auth/account";
import { resolveProject } from "@/lib/auth/project";
import { supabaseAdmin } from "@/lib/flows/admin-client";

// PATCH — rename, archive or restore a project.
// DELETE — destroy it, and everything inside it (Super Admin only).

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  let auth;
  try {
    auth = await requireRole("admin");
  } catch (err) {
    return toErrorResponse(err);
  }

  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    await resolveProject(auth.supabase, id);
  } catch (err) {
    return toErrorResponse(err);
  }

  const patch: Record<string, unknown> = {};

  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 80) {
      return NextResponse.json(
        { error: "name must be between 1 and 80 characters" },
        { status: 400 },
      );
    }
    patch.name = name;
  }

  if (body.archived !== undefined) {
    if (typeof body.archived !== "boolean") {
      return NextResponse.json(
        { error: "archived must be a boolean" },
        { status: 400 },
      );
    }
    patch.archived_at = body.archived ? new Date().toISOString() : null;
  }

  // allowed_channels: which connection methods are enabled.
  // Only admins/owners can change this (enforced by requireRole above).
  if (body.allowed_channels !== undefined) {
    if (!Array.isArray(body.allowed_channels)) {
      return NextResponse.json(
        { error: "allowed_channels must be an array" },
        { status: 400 },
      );
    }
    const VALID_CHANNELS = ["qr", "cloud_api"] as const;
    const parsed = body.allowed_channels.filter(
      (c: unknown): c is string =>
        typeof c === "string" && (VALID_CHANNELS as readonly string[]).includes(c),
    );
    if (parsed.length === 0) {
      return NextResponse.json(
        { error: 'allowed_channels must contain at least one of "qr" or "cloud_api"' },
        { status: 400 },
      );
    }
    patch.allowed_channels = [...new Set(parsed)];
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: "Nothing to update. Supply `name`, `archived`, and/or `allowed_channels`." },
      { status: 400 },
    );
  }

  const { data, error } = await auth.supabase
    .from("projects")
    .update(patch)
    .eq("id", id)
    .select("id, name, slug, channel_type, allowed_channels, archived_at")
    .maybeSingle();

  if (error) {
    console.error("[projects PATCH] update error:", error);
    return NextResponse.json({ error: "Failed to update project" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({ project: data });
}

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  let auth;
  try {
    auth = await getCurrentAccount();
  } catch (err) {
    return toErrorResponse(err);
  }

  // Strictly enforce: ONLY Super Admins can delete projects
  if (auth.platformRole !== "super_admin") {
    return NextResponse.json(
      { error: "Only super administrators can delete projects." },
      { status: 403 },
    );
  }

  const admin = supabaseAdmin();

  // Verify the project exists
  const { data: project, error: fetchErr } = await admin
    .from("projects")
    .select("id, name, account_id")
    .eq("id", id)
    .maybeSingle();

  if (fetchErr || !project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  // Refuse to delete the last project in an account
  const { count, error: countError } = await admin
    .from("projects")
    .select("id", { count: "exact", head: true })
    .eq("account_id", project.account_id);

  if (countError) {
    console.error("[projects DELETE] count error:", countError);
    return NextResponse.json({ error: "Failed to verify account projects" }, { status: 500 });
  }
  if ((count ?? 0) <= 1) {
    return NextResponse.json(
      { error: "Cannot delete the only project in an account. Create another first." },
      { status: 409 },
    );
  }

  try {
    // 1. Identify all users associated with this project
    const { data: memberRows } = await admin
      .from("project_members")
      .select("user_id")
      .eq("project_id", id);

    const { data: customerRows } = await admin
      .from("onboarded_customers")
      .select("user_id")
      .eq("project_id", id);

    const targetUserIds = Array.from(
      new Set(
        [
          ...(memberRows ?? []).map((m) => m.user_id),
          ...(customerRows ?? []).map((c) => c.user_id),
        ].filter((uid): uid is string => Boolean(uid))
      )
    );

    // 2. Protect super administrators from being deleted
    let superAdminUserIds = new Set<string>();
    superAdminUserIds.add(auth.userId);

    if (targetUserIds.length > 0) {
      const { data: userProfiles } = await admin
        .from("profiles")
        .select("user_id, platform_role")
        .in("user_id", targetUserIds);

      (userProfiles ?? []).forEach((p) => {
        if (p.platform_role === "super_admin") {
          superAdminUserIds.add(p.user_id);
        }
      });
    }

    const usersToDelete = targetUserIds.filter((uid) => !superAdminUserIds.has(uid));

    // 3. Delete each assigned user (Auth, Profile, Memberships, Customer records)
    for (const uid of usersToDelete) {
      try {
        await admin.from("onboarded_customers").delete().eq("user_id", uid);
        await admin.from("project_members").delete().eq("user_id", uid);
        await admin.from("profiles").delete().eq("user_id", uid);
        const { error: authErr } = await admin.auth.admin.deleteUser(uid);
        if (authErr) {
          console.warn(`[projects DELETE] auth deleteUser warning for ${uid}:`, authErr.message);
        }
      } catch (userErr) {
        console.error(`[projects DELETE] error deleting user ${uid}:`, userErr);
      }
    }

    // 4. Delete/clean all child workspace data
    await admin.from("messages").delete().eq("project_id", id);
    await admin.from("conversations").delete().eq("project_id", id);
    await admin.from("contact_notes").delete().eq("project_id", id);
    await admin.from("contacts").delete().eq("project_id", id);
    await admin.from("deals").delete().eq("project_id", id);
    await admin.from("pipelines").delete().eq("project_id", id);
    await admin.from("broadcast_recipients").delete().eq("project_id", id);
    await admin.from("broadcasts").delete().eq("project_id", id);
    await admin.from("email_campaign_recipients").delete().eq("project_id", id);
    await admin.from("email_campaigns").delete().eq("project_id", id);
    await admin.from("email_configs").delete().eq("project_id", id);
    await admin.from("automation_logs").delete().eq("project_id", id);
    await admin.from("automation_pending_executions").delete().eq("project_id", id);
    await admin.from("automations").delete().eq("project_id", id);
    await admin.from("flow_runs").delete().eq("project_id", id);
    await admin.from("flows").delete().eq("project_id", id);
    await admin.from("message_templates").delete().eq("project_id", id);
    await admin.from("whatsapp_config").delete().eq("project_id", id);
    await admin.from("qr_sessions").delete().eq("project_id", id);
    await admin.from("instagram_config").delete().eq("project_id", id);
    await admin.from("ai_knowledge_chunks").delete().eq("project_id", id);
    await admin.from("ai_knowledge_documents").delete().eq("project_id", id);
    await admin.from("ai_configs").delete().eq("project_id", id);
    await admin.from("ai_usage_log").delete().eq("project_id", id);
    await admin.from("webhook_endpoints").delete().eq("project_id", id);
    await admin.from("api_keys").delete().eq("project_id", id);
    await admin.from("notifications").delete().eq("project_id", id);
    await admin.from("tags").delete().eq("project_id", id);
    await admin.from("custom_fields").delete().eq("project_id", id);
    await admin.from("quick_replies").delete().eq("project_id", id);
    await admin.from("onboarded_customers").delete().eq("project_id", id);
    await admin.from("project_members").delete().eq("project_id", id);

    // 5. Delete the project
    const { error: delErr } = await admin.from("projects").delete().eq("id", id);
    if (delErr) {
      console.error("[projects DELETE] delete error:", delErr);
      return NextResponse.json({ error: "Failed to delete project: " + delErr.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      deleted_id: id,
      deleted_users_count: usersToDelete.length,
    });
  } catch (err: unknown) {
    console.error("[projects DELETE] exception:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error deleting project" },
      { status: 500 },
    );
  }
}
