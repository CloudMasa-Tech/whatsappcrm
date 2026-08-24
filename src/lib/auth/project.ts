// ============================================================
// Server-side project context — the second tenancy level.
//
// `@/lib/auth/account` answers "which ORGANISATION is this?".
// This module answers "which PROJECT inside it?", which is the
// boundary that actually scopes data after migrations 041–044.
//
// Server-only, for the same reason as account.ts: it reaches for
// the Supabase SSR client, which reads `next/headers` cookies.
//
// Calling convention — identical in shape to requireRole():
//
//   try {
//     const ctx = await requireProjectRole("agent");
//     // ctx.supabase  — SSR client (RLS scoped to this user)
//     // ctx.projectId — the ACTIVE project, already authorised
//     // ctx.accountId / ctx.role / ctx.project
//   } catch (err) {
//     return toErrorResponse(err);
//   }
//
// The one rule that matters
// -------------------------
// The active project arrives in a cookie, and a cookie is a HINT,
// never an authorisation. Every resolution below re-checks the
// project against the caller's membership through the database
// before returning it. A tampered cookie naming another tenant's
// project resolves to a ForbiddenError, not to that project.
//
// Routes that take a project id from the client (a switcher POST,
// a deep link) must pass it through `resolveProject()` for the same
// reason — never straight into a query.
// ============================================================

import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  ForbiddenError,
  getCurrentAccount,
  UnauthorizedError,
  type AccountContext,
} from "./account";
import { hasMinRole, type AccountRole, type PlatformRole } from "./roles";
import { supabaseAdmin } from "@/lib/supabase/admin";

/** Cookie holding the caller's active project id. */
export const ACTIVE_PROJECT_COOKIE = "wacrm_project";

/** How a project's WhatsApp connection is wired up. */
export type ChannelType = "cloud_api" | "qr";

export interface ProjectSummary {
  id: string;
  name: string;
  slug: string;
  channel_type: ChannelType;
  /** Which connection methods are enabled for this project. */
  allowed_channels: ChannelType[];
  archived_at: string | null;
}

export interface ProjectContext extends AccountContext {
  /** The active project. Guaranteed readable by `userId`. */
  projectId: string;
  project: ProjectSummary;
}

export function isChannelType(value: unknown): value is ChannelType {
  return value === "cloud_api" || value === "qr";
}

function toSummary(row: Record<string, unknown>): ProjectSummary {
  // Parse allowed_channels: the DB returns a string array via PostgREST.
  const raw = row.allowed_channels;
  const allowed: ChannelType[] = Array.isArray(raw)
    ? (raw as unknown[]).filter(isChannelType)
    : [isChannelType(row.channel_type) ? row.channel_type : "cloud_api"];

  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    // Defensive: a future migration could add a channel we don't know
    // yet. Fall back to 'cloud_api' rather than crashing the request —
    // the send path re-checks and refuses unsupported operations.
    channel_type: isChannelType(row.channel_type) ? row.channel_type : "cloud_api",
    allowed_channels: allowed.length > 0 ? allowed : ["qr"],
    archived_at: row.archived_at ? String(row.archived_at) : null,
  };
}

const PROJECT_COLUMNS = "id, name, slug, channel_type, allowed_channels, archived_at";

/**
 * Every project the caller can reach, newest last.
 * - Super Admins: all projects across the platform.
 * - Project Admins and Agents: ONLY projects they are explicitly assigned to (via project_members).
 */
export async function listProjects(
  supabase: SupabaseClient,
  userId?: string,
  platformRole?: PlatformRole,
): Promise<ProjectSummary[]> {
  // 1. Platform Super Admin reaches all projects across the platform
  if (platformRole === "super_admin") {
    const { data, error } = await supabaseAdmin()
      .from("projects")
      .select(PROJECT_COLUMNS)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[listProjects super_admin] fetch error:", error);
      throw new ForbiddenError("Could not load projects");
    }
    return (data ?? []).map(toSummary);
  }

  // 2. Explicit user ID provided: filter strictly by project_members assignment
  if (userId) {
    const { data: memberships, error: memErr } = await supabaseAdmin()
      .from("project_members")
      .select("project_id")
      .eq("user_id", userId);

    if (memErr) {
      console.error("[listProjects project_members] fetch error:", memErr);
      throw new ForbiddenError("Could not load projects");
    }

    const projectIds = (memberships ?? []).map((m) => m.project_id).filter(Boolean);
    if (projectIds.length === 0) {
      return [];
    }

    const { data, error } = await supabaseAdmin()
      .from("projects")
      .select(PROJECT_COLUMNS)
      .in("id", projectIds)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[listProjects assigned] fetch error:", error);
      throw new ForbiddenError("Could not load projects");
    }
    return (data ?? []).map(toSummary);
  }

  // 3. Fallback through user's own RLS client
  const { data, error } = await supabase
    .from("projects")
    .select(PROJECT_COLUMNS)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[listProjects] fetch error:", error);
    throw new ForbiddenError("Could not load projects");
  }
  return (data ?? []).map(toSummary);
}

/**
 * Authorise a specific project id for the caller.
 * - Super Admins: authorised for any project.
 * - Non-Super Admins: authorised ONLY if they belong to project_members.
 */
export async function resolveProject(
  supabase: SupabaseClient,
  projectId: string,
  userId?: string,
  platformRole?: PlatformRole,
): Promise<ProjectSummary> {
  if (platformRole === "super_admin") {
    const { data, error } = await supabaseAdmin()
      .from("projects")
      .select(PROJECT_COLUMNS)
      .eq("id", projectId)
      .maybeSingle();

    if (error || !data) {
      throw new ForbiddenError("Project not found or not accessible");
    }
    return toSummary(data);
  }

  if (userId) {
    const { data: member, error: memberErr } = await supabaseAdmin()
      .from("project_members")
      .select("project_id")
      .eq("project_id", projectId)
      .eq("user_id", userId)
      .maybeSingle();

    if (memberErr || !member) {
      throw new ForbiddenError("Project not found or not accessible");
    }

    const { data, error } = await supabaseAdmin()
      .from("projects")
      .select(PROJECT_COLUMNS)
      .eq("id", projectId)
      .maybeSingle();

    if (error || !data) {
      throw new ForbiddenError("Project not found or not accessible");
    }
    return toSummary(data);
  }

  const { data, error } = await supabase
    .from("projects")
    .select(PROJECT_COLUMNS)
    .eq("id", projectId)
    .maybeSingle();

  if (error) {
    console.error("[resolveProject] fetch error:", error);
    throw new ForbiddenError("Could not load project");
  }
  if (!data) {
    throw new ForbiddenError("Project not found or not accessible");
  }
  return toSummary(data);
}

/**
 * Resolve the caller's account, then their ACTIVE project.
 *
 * Selection order:
 *   1. the `wacrm_project` cookie, if it names a project they are allocated to
 *   2. otherwise their first allocated project
 */
export async function getCurrentProject(): Promise<ProjectContext> {
  const account = await getCurrentAccount();

  const cookieStore = await cookies();
  const requested = cookieStore.get(ACTIVE_PROJECT_COOKIE)?.value;

  if (requested) {
    try {
      const project = await resolveProject(
        account.supabase,
        requested,
        account.userId,
        account.platformRole,
      );
      return { ...account, projectId: project.id, project };
    } catch (err) {
      if (!(err instanceof ForbiddenError)) throw err;
      // Fall through to default assigned project
    }
  }

  const projects = await listProjects(
    account.supabase,
    account.userId,
    account.platformRole,
  );

  const first = projects.find((p) => !p.archived_at) ?? projects[0];
  if (!first) {
    throw new ForbiddenError("No project assigned to this user");
  }

  cookieStore.set(ACTIVE_PROJECT_COOKIE, first.id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });

  return { ...account, projectId: first.id, project: first };
}

/**
 * `getCurrentProject()` plus a minimum-role check.
 *
 * Note this checks the caller's ORGANISATION role, matching the RLS
 * tiers in 043 — membership of the project has already been proven by
 * the resolution above. The two together are exactly what the database
 * enforces, so a route that passes this check will not then be
 * surprised by an RLS denial.
 */
export async function requireProjectRole(
  min: AccountRole,
): Promise<ProjectContext> {
  const ctx = await getCurrentProject();
  if (!hasMinRole(ctx.role, min)) {
    throw new ForbiddenError(
      `This action requires the '${min}' role or higher`,
    );
  }
  if (ctx.project.archived_at && min !== "viewer") {
    // Mirrors is_project_member's archived clause so the API returns a
    // clear message instead of an opaque RLS "0 rows updated".
    throw new ForbiddenError(
      "This project is archived. Restore it before making changes.",
    );
  }
  return ctx;
}

/**
 * Resolve a project id supplied by a caller (switcher, deep link,
 * gateway callback) against the current session.
 *
 * Returns a full ProjectContext so callers get the authorised id back
 * rather than re-using the untrusted input they passed in — the small
 * discipline that keeps a tampered id from ever reaching a query.
 */
export async function requireProject(
  projectId: string,
  min: AccountRole = "viewer",
): Promise<ProjectContext> {
  const account = await getCurrentAccount();
  if (!hasMinRole(account.role, min)) {
    throw new ForbiddenError(
      `This action requires the '${min}' role or higher`,
    );
  }
  const project = await resolveProject(account.supabase, projectId);
  if (project.archived_at && min !== "viewer") {
    throw new ForbiddenError(
      "This project is archived. Restore it before making changes.",
    );
  }
  return { ...account, projectId: project.id, project };
}

export { ForbiddenError, UnauthorizedError };
