import type { AccountMember } from '@/types';

/**
 * Fetch the current account's members from the API (which applies
 * project scoping and role visibility rules).
 *
 * If projectId is provided, only members of that specific project are returned.
 * Super Admin (platform_role = 'super_admin') is automatically excluded.
 *
 * Client-side only (uses `fetch` against the relative API route).
 */
export async function fetchAccountMembers(
  projectId?: string | null,
  options?: { includeSuperAdmin?: boolean }
): Promise<AccountMember[]> {
  try {
    const params = new URLSearchParams();
    if (projectId) params.set('project_id', projectId);
    if (options?.includeSuperAdmin) params.set('include_super_admin', 'true');

    const qs = params.toString();
    const url = `/api/account/members${qs ? `?${qs}` : ''}`;

    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return [];
    const json = (await res.json()) as { members?: AccountMember[] };
    return json.members ?? [];
  } catch {
    return [];
  }
}

/** Display label for a member: full name → email → raw id. */
export function memberLabel(m: AccountMember): string {
  return m.full_name || m.email || m.user_id;
}
