// ============================================================
// Account & Platform role helpers — pure, unit-testable, no I/O.
//
// 3 Core Roles:
//   1. super_admin: Platform-wide operator. Full platform control,
//      project creation & deletion, user onboarding, /admin.
//   2. admin: Organization / Project administrator. Full project details,
//      channel configurations (WhatsApp, Instagram), team roster,
//      pipelines, automations, templates, flows.
//   3. agent: Project agent / marketing user. Operational access:
//      inbox messaging, contacts, campaigns/broadcasts, pipelines.
//      Cannot disconnect channels or edit project settings.
// ============================================================

export type AccountRole = "owner" | "admin" | "agent" | "viewer";

/**
 * Platform-level role — orthogonal to AccountRole.
 *
 * - `super_admin`: Platform operator. Can access /admin, create/delete projects, onboard users.
 * - `customer` / `agent`: Operational user assigned to projects.
 */
export type PlatformRole = "super_admin" | "customer";

/** Ordered list of every valid role, lowest privilege first. */
export const ACCOUNT_ROLES: readonly AccountRole[] = [
  "viewer",
  "agent",
  "admin",
  "owner",
] as const;

/**
 * Numeric rank of a role. Higher = more privileged. Mirrors the
 * CASE expression in `is_account_member` so JS/SQL stay aligned.
 */
export function roleRank(role: AccountRole): number {
  switch (role) {
    case "owner":
      return 4;
    case "admin":
      return 3;
    case "agent":
      return 2;
    case "viewer":
      return 1;
  }
}

/**
 * True iff `role` is at least as privileged as `min`. Use this
 * for any "user has at least admin" / "at least agent" checks.
 */
export function hasMinRole(role: AccountRole, min: AccountRole): boolean {
  return roleRank(role) >= roleRank(min);
}

/** Type-narrow an unknown string into a valid `AccountRole`. */
export function isAccountRole(value: unknown): value is AccountRole {
  return (
    typeof value === "string" &&
    (ACCOUNT_ROLES as readonly string[]).includes(value)
  );
}

// ============================================================
// Capability predicates
// ============================================================

/** Owner / admin: invite, remove, change roles within the account. */
export function canManageMembers(role: AccountRole): boolean {
  return hasMinRole(role, "admin");
}

/**
 * Platform user onboarding: STRICTLY SUPER_ADMIN only.
 */
export function canManageCustomers(platformRole?: PlatformRole | string | null): boolean {
  return platformRole === "super_admin";
}

/**
 * Project creation: STRICTLY SUPER_ADMIN only.
 */
export function canCreateProject(platformRole?: PlatformRole | string | null): boolean {
  return platformRole === "super_admin";
}

/**
 * Project deletion: STRICTLY SUPER_ADMIN only.
 */
export function canDeleteProject(platformRole?: PlatformRole | string | null): boolean {
  return platformRole === "super_admin";
}

/**
 * Project Settings & Channel Config: Super Admin, Owner, Admin.
 * Excludes Agent.
 */
export function canManageProjectSettings(
  accountRole: AccountRole,
  platformRole?: PlatformRole | string | null,
  userRole?: string | null,
): boolean {
  if (platformRole === "super_admin" || accountRole === "owner" || accountRole === "admin") {
    return true;
  }
  if (userRole === "agent" || userRole === "customer") {
    return false;
  }
  return hasMinRole(accountRole, "admin");
}

/** Owner / admin: edit account-wide settings. */
export function canEditSettings(role: AccountRole): boolean {
  return hasMinRole(role, "admin");
}

/**
 * Super Admin / Admin / Agent: write operational data — send messages,
 * create contacts, move deals, run broadcasts, view inbox.
 */
export function canSendMessages(role: AccountRole): boolean {
  return hasMinRole(role, "agent");
}

/**
 * Connect WhatsApp / Instagram / Facebook for a project: Super Admin, Owner, Admin.
 * Agents CANNOT connect channels.
 */
export function canConnectWhatsApp(
  accountRole: AccountRole,
  platformRole?: PlatformRole | string | null,
  userRole?: string | null,
): boolean {
  if (platformRole === "super_admin" || accountRole === "owner" || accountRole === "admin") {
    return true;
  }
  if (userRole === "agent" || userRole === "customer" || accountRole === "agent" || accountRole === "viewer") {
    return false;
  }
  return hasMinRole(accountRole, "admin");
}

/**
 * Disconnect WhatsApp / Instagram channels:
 * - Super Admin / Owner / Admin: YES
 * - Agent: NO (cannot disconnect channels)
 */
export function canDisconnectWhatsApp(
  accountRole: AccountRole,
  platformRole?: PlatformRole | string | null,
  userRole?: string | null,
): boolean {
  if (
    platformRole === "super_admin" ||
    accountRole === "owner" ||
    accountRole === "admin"
  ) {
    return true;
  }
  if (userRole === "agent" || userRole === "customer" || accountRole === "agent") {
    return false;
  }
  return hasMinRole(accountRole, "admin");
}

/** Alias for channel disconnection capability */
export const canDisconnectChannels = canDisconnectWhatsApp;

/**
 * Viewer: read-only across everything.
 */
export function canViewOnly(role: AccountRole): boolean {
  return role === "viewer";
}

/** Owner only: irreversible destructive operations on account. */
export function canDeleteAccount(role: AccountRole): boolean {
  return role === "owner";
}

/** Owner only: hand the account to another member. */
export function canTransferOwnership(role: AccountRole): boolean {
  return role === "owner";
}

// ============================================================
// Platform role helpers
// ============================================================

/** Type-narrow an unknown string into a valid `PlatformRole`. */
export function isPlatformRole(value: unknown): value is PlatformRole {
  return value === "super_admin" || value === "customer";
}

/** True iff the platform role is super_admin. */
export function isSuperAdmin(platformRole: PlatformRole | string | null | undefined): boolean {
  return platformRole === "super_admin";
}

/** True iff the platform role is customer/agent. */
export function isCustomer(platformRole: PlatformRole | string | null | undefined): boolean {
  return platformRole === "customer";
}

/**
 * Can this user access the Super Admin area (/admin)?
 * Only super_admins.
 */
export function canAccessAdmin(platformRole: PlatformRole | string | null | undefined): boolean {
  return platformRole === "super_admin";
}

/**
 * Can this user create/manage customers and projects at the platform level?
 * Only super_admins.
 */
export function canManagePlatform(platformRole: PlatformRole | string | null | undefined): boolean {
  return platformRole === "super_admin";
}
