// ============================================================
// Resolve which transport a project speaks.
//
// Kept apart from types.ts because this one touches the database, and
// apart from gateway.ts because plenty of callers need the channel
// without needing the gateway client.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ChannelType, ProjectChannel } from "./types";

function isChannelType(value: unknown): value is ChannelType {
  return value === "cloud_api" || value === "qr";
}

/**
 * Look up a project's channel.
 *
 * `db` may be an RLS-scoped user client or the service role. With the
 * user client an inaccessible project simply returns no row, which is
 * the isolation boundary doing its job; with the service role the
 * caller is responsible for having authorised the id first.
 *
 * Returns null when the project does not exist (or is not visible).
 */
export async function resolveProjectChannel(
  db: SupabaseClient,
  projectId: string,
): Promise<ProjectChannel | null> {
  const { data, error } = await db
    .from("projects")
    .select("id, account_id, channel_type")
    .eq("id", projectId)
    .maybeSingle();

  if (error) {
    console.error("[resolveProjectChannel] fetch error:", error);
    return null;
  }
  if (!data) return null;

  return {
    projectId: String(data.id),
    accountId: String(data.account_id),
    // An unknown value means a newer migration added a channel this
    // build predates. Falling back to cloud_api keeps existing
    // behaviour rather than silently routing to the wrong transport;
    // the send path validates capabilities separately.
    channelType: isChannelType(data.channel_type) ? data.channel_type : "cloud_api",
  };
}
