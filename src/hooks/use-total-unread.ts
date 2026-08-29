"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { Conversation } from "@/types";

/**
 * Count of conversations with at least one unread inbound message for
 * the current user. Used by the sidebar to surface a green dot on the
 * Inbox nav entry when the user is elsewhere in the app.
 *
 * For Administrators (Admin / Owner / Super Admin): counts all unread conversations in the project.
 * For Agents: counts ONLY unread conversations assigned to that specific agent.
 */
export function useTotalUnread(): number {
  const { user, canManageMembers, isSuperAdmin } = useAuth();
  const isProjectAdmin = canManageMembers || isSuperAdmin;
  const [total, setTotal] = useState(0);

  const countsRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (!user) return;
    const supabase = createClient();
    let cancelled = false;

    (async () => {
      let query = supabase
        .from("conversations")
        .select("id, unread_count, assigned_agent_id");

      if (!isProjectAdmin) {
        query = query.eq("assigned_agent_id", user.id);
      }

      const { data, error } = await query;
      if (cancelled || error || !data) return;

      const map = new Map<string, number>();
      let sum = 0;
      for (const row of data as { id: string; unread_count: number }[]) {
        const n = row.unread_count ?? 0;
        map.set(row.id, n);
        if (n > 0) sum += 1;
      }
      countsRef.current = map;
      setTotal(sum);
    })();

    const channelId = `total-unread-${Math.random().toString(36).slice(2, 9)}`;
    const channel = supabase
      .channel(channelId)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations" },
        (payload) => {
          const map = countsRef.current;
          if (payload.eventType === "DELETE") {
            const oldRow = payload.old as Partial<Conversation>;
            if (oldRow.id) map.delete(oldRow.id);
          } else {
            const row = payload.new as Conversation;
            // If the user is an agent, only track if assigned to them
            if (!isProjectAdmin && row.assigned_agent_id !== user.id) {
              map.delete(row.id);
            } else {
              map.set(row.id, row.unread_count ?? 0);
            }
          }
          let sum = 0;
          for (const n of map.values()) if (n > 0) sum += 1;
          setTotal(sum);
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [user, isProjectAdmin]);

  return total;
}
