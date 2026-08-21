"use client";

import { useEffect, useState } from "react";

/**
 * The active project, for client components that need its id.
 *
 * The authoritative copy lives in an httpOnly cookie that the server
 * re-validates on every request — this hook only mirrors the resolved
 * result so the browser can scope things it owns, chiefly the Realtime
 * subscription filter.
 *
 * It is deliberately NOT a permission signal. Nothing should decide
 * what a user may see from this value; the database does that.
 */
export interface ActiveProject {
  id: string;
  name: string;
  slug: string;
  channel_type: "qr" | "cloud_api";
  archived_at: string | null;
}

export function useActiveProject() {
  const [project, setProject] = useState<ActiveProject | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch("/api/projects", { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json();
        if (cancelled) return;
        const active = (data.projects ?? []).find(
          (p: ActiveProject) => p.id === data.active_project_id,
        );
        setProject(active ?? null);
      } catch {
        // Leave it null. Consumers fall back to unscoped behaviour,
        // which RLS still confines to the caller's own organisation.
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { project, projectId: project?.id ?? null, loading };
}
