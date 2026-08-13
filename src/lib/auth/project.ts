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
import { hasMinRole, type AccountRole } from "./roles";

/** Cookie holding the caller's active project id. */
export const ACTIVE_PROJECT_COOKIE = "wacrm_project";

/** How a project's WhatsApp connection is wired up. */
export type ChannelType = "cloud_api" | "qr";

export interface ProjectSummary {
  id: string;
  name: string;
  slug: string;
  channel_type: ChannelType;
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
  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    // Defensive: a future migration could add a channel we don't know
    // yet. Fall back to 'cloud_api' rather than crashing the request —
    // the send path re-checks and refuses unsupported operations.
    channel_type: isChannelType(row.channel_type) ? row.channel_type : "cloud_api",
    archived_at: row.archived_at ? String(row.archived_at) : null,
  };
}

const PROJECT_COLUMNS = "id, name, slug, channel_type, archived_at";

/**
 * Every project the caller can reach, newest last. Reads through RLS,
 * so the list is already filtered to their organisation and (for
 * agents/viewers) their assigned projects — there is no client-side
 * filtering to forget.
 */
export async function listProjects(
  supabase: SupabaseClient,
): Promise<ProjectSummary[]> {
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
 *
 * The SELECT runs under the user's own client, so `projects_select`
 * (which delegates to `is_project_member`) does the authorisation:
 * a project the caller cannot reach simply returns no row, and we
 * turn that into a 403. There is no code path where an id supplied
 * by a client reaches a query without passing through here.
 */
export async function resolveProject(
  supabase: SupabaseClient,
  projectId: string,
): Promise<ProjectSummary> {
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
    // Deliberately the same error for "does not exist" and "not
    // yours": distinguishing them would confirm the existence of
    // another tenant's project to anyone probing ids.
    throw new ForbiddenError("Project not found or not accessible");
  }
  return toSummary(data);
}

/**
 * Resolve the caller's account, then their ACTIVE project.
 *
 * Selection order:
 *   1. the `wacrm_project` cookie, if it names a project they may use
 *   2. otherwise their first accessible project
 *
 * A stale or tampered cookie silently falls back to (2) rather than
 * erroring — a user removed from a project should land somewhere
 * usable, not on a broken dashboard.
 *
 * Throws `ForbiddenError` when the caller has no accessible project
 * at all. Post-042 every account has at least one, so this means an
 * agent/viewer with an empty roster: an admin must assign them.
 */
export async function getCurrentProject(): Promise<ProjectContext> {
  const account = await getCurrentAccount();

  const cookieStore = await cookies();
  const requested = cookieStore.get(ACTIVE_PROJECT_COOKIE)?.value;

  if (requested) {
    try {
      const project = await resolveProject(account.supabase, requested);
      return { ...account, projectId: project.id, project };
    } catch (err) {
      if (!(err instanceof ForbiddenError)) throw err;
      // Fall through to the default project below.
    }
  }

  const projects = await listProjects(account.supabase);
  const first = projects.find((p) => !p.archived_at) ?? projects[0];
  if (!first) {
    throw new ForbiddenError(
      "You do not have access to any project in this account",
    );
  }
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
