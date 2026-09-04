import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Resolves the next agent in circular order (Round-Robin) for new inbound conversations.
 *
 * 1. Fetches all active agents allocated to this project.
 * 2. Finds the last assigned agent for the project to determine the sequence.
 * 3. Returns the next agent's user_id, or null if no agents are available.
 */
export async function getNextRoundRobinAgentId(
  db: SupabaseClient,
  projectId: string,
  accountId: string
): Promise<string | null> {
  try {
    // 1. Query project members allocated to this project
    const { data: projectMembers, error: pmErr } = await db
      .from("project_members")
      .select("user_id, role")
      .eq("project_id", projectId);

    let candidateUserIds: string[] = [];

    if (!pmErr && projectMembers && projectMembers.length > 0) {
      candidateUserIds = projectMembers
        .filter((pm) => pm.role === "agent" || pm.role === "admin")
        .map((pm) => pm.user_id as string);
    }

    // Fallback: if project_members is empty, query profiles in this account
    if (candidateUserIds.length === 0) {
      const { data: accountProfiles } = await db
        .from("profiles")
        .select("user_id, account_role")
        .eq("account_id", accountId);

      if (accountProfiles && accountProfiles.length > 0) {
        candidateUserIds = accountProfiles
          .filter((p) => p.account_role === "agent" || p.account_role === "admin" || p.account_role === "owner")
          .map((p) => p.user_id as string);
      }
    }

    if (candidateUserIds.length === 0) {
      return null;
    }

    // Sort deterministically
    candidateUserIds.sort();

    if (candidateUserIds.length === 1) {
      return candidateUserIds[0];
    }

    // 2. Query the last assigned conversation in this project
    const { data: lastAssigned } = await db
      .from("conversations")
      .select("assigned_agent_id")
      .eq("project_id", projectId)
      .not("assigned_agent_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!lastAssigned || !lastAssigned.assigned_agent_id) {
      return candidateUserIds[0];
    }

    const lastIndex = candidateUserIds.indexOf(lastAssigned.assigned_agent_id as string);
    if (lastIndex === -1) {
      return candidateUserIds[0];
    }

    const nextIndex = (lastIndex + 1) % candidateUserIds.length;
    return candidateUserIds[nextIndex];
  } catch (err) {
    console.error("[round-robin] Error resolving next agent:", err);
    return null;
  }
}
