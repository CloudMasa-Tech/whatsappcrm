// ============================================================
// GET /api/account/members
//
// Lists members of the caller's account and/or active project.
//
// Project Scoping & RBAC:
//   - Super Admins: see all account members across all projects,
//     or filter by ?project_id=... if specified.
//   - Agents & Project Admins: strictly scoped to ONLY members
//     who belong to their assigned project(s). They never see
//     unrelated users from other projects.
//   - Super Admin (platform_role = 'super_admin') is excluded from
//     workspace project member lists by default (unless include_super_admin=true).
//   - Every member is enriched with project details (project_name,
//     project_id, and projects list).
// ============================================================

import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { canManageMembers, isAccountRole } from "@/lib/auth/roles";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { AccountMember } from "@/types";

interface ProfileRow {
  user_id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  account_role: string;
  platform_role?: string | null;
  beta_features?: string[] | null;
  created_at: string;
}

export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const url = new URL(request.url);
    const queryProjectId = url.searchParams.get("project_id");
    const includeSuperAdmin = url.searchParams.get("include_super_admin") === "true";

    const isSuper = ctx.platformRole === "super_admin";

    let targetUserIds: string[] | null = null;
    let allowedProjectIds: string[] = [];

    if (isSuper) {
      if (queryProjectId) {
        // Filter by specified project
        const { data: pmData } = await supabaseAdmin()
          .from("project_members")
          .select("user_id")
          .eq("project_id", queryProjectId);

        const { data: onbData } = await supabaseAdmin()
          .from("onboarded_customers")
          .select("user_id")
          .eq("project_id", queryProjectId);

        targetUserIds = Array.from(
          new Set([
            ...(pmData ?? []).map((p) => p.user_id),
            ...(onbData ?? []).map((o) => o.user_id),
          ].filter(Boolean) as string[])
        );
        allowedProjectIds = [queryProjectId];
      }
    } else {
      // Non-superadmin (Agent or Project Admin): MUST be strictly project-specific
      const { data: myMemberships } = await supabaseAdmin()
        .from("project_members")
        .select("project_id")
        .eq("user_id", ctx.userId);

      // Also check onboarded_customers for caller's assigned project
      const { data: myOnboarded } = await supabaseAdmin()
        .from("onboarded_customers")
        .select("project_id")
        .eq("user_id", ctx.userId);

      const foundProjectIds = Array.from(
        new Set([
          ...(myMemberships ?? []).map((m) => m.project_id),
          ...(myOnboarded ?? []).map((o) => o.project_id),
        ].filter(Boolean) as string[])
      );

      if (queryProjectId) {
        if (!foundProjectIds.includes(queryProjectId)) {
          return NextResponse.json(
            { error: "You do not have access to this project" },
            { status: 403 }
          );
        }
        allowedProjectIds = [queryProjectId];
      } else {
        allowedProjectIds = foundProjectIds;
      }

      if (allowedProjectIds.length === 0) {
        // Agent has no assigned projects yet — return only their own profile
        targetUserIds = [ctx.userId];
      } else {
        // Find all users assigned to these allowed projects
        const { data: teamPms } = await supabaseAdmin()
          .from("project_members")
          .select("user_id")
          .in("project_id", allowedProjectIds);

        const { data: teamOnboarded } = await supabaseAdmin()
          .from("onboarded_customers")
          .select("user_id")
          .in("project_id", allowedProjectIds);

        targetUserIds = Array.from(
          new Set([
            ctx.userId,
            ...(teamPms ?? []).map((p) => p.user_id),
            ...(teamOnboarded ?? []).map((o) => o.user_id),
          ].filter(Boolean) as string[])
        );
      }
    }

    // Query profiles
    let profilesQuery = supabaseAdmin()
      .from("profiles")
      .select("user_id, full_name, email, avatar_url, account_role, beta_features, platform_role, created_at")
      .eq("account_id", ctx.accountId)
      .order("created_at", { ascending: true });

    if (targetUserIds !== null) {
      if (targetUserIds.length === 0) {
        return NextResponse.json({ members: [] });
      }
      profilesQuery = profilesQuery.in("user_id", targetUserIds);
    }

    // Exclude platform super admin from regular workspace project lists unless requested
    if (!includeSuperAdmin) {
      profilesQuery = profilesQuery.neq("platform_role", "super_admin");
    }

    const { data, error } = await profilesQuery;

    if (error) {
      console.error("[GET /api/account/members] fetch error:", error);
      return NextResponse.json(
        { error: "Failed to load members" },
        { status: 500 }
      );
    }

    const userIds = (data as ProfileRow[]).map((r) => r.user_id);

    // Fetch project assignments and project names for all returned users
    const projectMap: Record<string, Array<{ id: string; name: string; channel_type?: string }>> = {};

    if (userIds.length > 0) {
      const { data: pmDetails } = await supabaseAdmin()
        .from("project_members")
        .select("user_id, project_id, project:projects(id, name, channel_type)")
        .in("user_id", userIds);

      if (pmDetails) {
        for (const row of pmDetails) {
          const projObj = Array.isArray(row.project) ? row.project[0] : row.project;
          if (projObj && projObj.id && projObj.name) {
            if (!projectMap[row.user_id]) projectMap[row.user_id] = [];
            if (!projectMap[row.user_id].some((p) => p.id === projObj.id)) {
              projectMap[row.user_id].push({
                id: projObj.id,
                name: projObj.name,
                channel_type: projObj.channel_type,
              });
            }
          }
        }
      }

      // Also check onboarded_customers for project links
      const { data: onboardedDetails } = await supabaseAdmin()
        .from("onboarded_customers")
        .select("user_id, project_id, project:projects(id, name, channel_type)")
        .in("user_id", userIds);

      if (onboardedDetails) {
        for (const row of onboardedDetails) {
          const projObj = Array.isArray(row.project) ? row.project[0] : row.project;
          if (projObj && projObj.id && projObj.name) {
            if (!projectMap[row.user_id]) projectMap[row.user_id] = [];
            if (!projectMap[row.user_id].some((p) => p.id === projObj.id)) {
              projectMap[row.user_id].push({
                id: projObj.id,
                name: projObj.name,
                channel_type: projObj.channel_type,
              });
            }
          }
        }
      }
    }

    const canSeeEmails = canManageMembers(ctx.role) || isSuper;

    const members: AccountMember[] = (data as ProfileRow[]).flatMap((row) => {
      if (!isAccountRole(row.account_role)) return [];
      const userProjects = projectMap[row.user_id] ?? [];
      const primaryProject = userProjects[0] ?? null;

      return [
        {
          user_id: row.user_id,
          full_name: row.full_name ?? "",
          email: canSeeEmails ? row.email : null,
          avatar_url: row.avatar_url,
          role: row.account_role,
          joined_at: row.created_at,
          project_id: primaryProject?.id ?? null,
          project_name: primaryProject?.name ?? null,
          projects: userProjects,
          is_default_admin: (row.beta_features ?? []).includes('default_admin'),
        },
      ];
    });

    return NextResponse.json({ members });
  } catch (err) {
    return toErrorResponse(err);
  }
}
