// ============================================================
// Service-role Supabase client.
//
// This client bypasses RLS completely. Every query written against it
// must name its `project_id` explicitly — the database will not catch
// a missing filter here the way it would for a logged-in user.
// ============================================================

import { createClient } from "@supabase/supabase-js";

import { config } from "./config.js";

export const supabase = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey,
  {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "x-client-info": "masacrm-gateway" } },
  },
);

export interface ProjectRow {
  id: string;
  account_id: string;
  channel_type: string;
  archived_at: string | null;
}

/**
 * Load a project, or null if it does not exist.
 *
 * The gateway calls this before opening any socket: a request naming a
 * project that is missing, archived, or not on the QR channel must not
 * result in a WhatsApp connection.
 */
export async function loadProject(projectId: string): Promise<ProjectRow | null> {
  const { data, error } = await supabase
    .from("projects")
    .select("id, account_id, channel_type, archived_at")
    .eq("id", projectId)
    .maybeSingle();

  if (error || !data) return null;
  return data as ProjectRow;
}
