"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronsUpDown, FolderKanban, Loader2 } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

// Switches the active project.
//
// The switch is a server round trip, not a client state change: the
// active project lives in an httpOnly cookie that the server
// re-validates against project membership on every request. After it
// is set we hard-refresh so every server component re-renders against
// the new scope — a soft update would leave cached lists from the
// previous project on screen, which is exactly the kind of cross-
// project bleed this feature exists to prevent.

interface Project {
  id: string;
  name: string;
  slug: string;
  channel_type: "qr" | "cloud_api";
  archived_at: string | null;
}

export function ProjectSwitcher() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch("/api/projects", { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json();
        if (cancelled) return;
        setProjects(data.projects ?? []);
        setActiveId(data.active_project_id ?? null);
      } catch {
        // Non-fatal: the switcher just stays empty. Every server-side
        // query still resolves a project on its own.
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function switchTo(projectId: string) {
    if (projectId === activeId) return;
    setSwitching(projectId);
    try {
      const response = await fetch("/api/projects/active", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ project_id: projectId }),
      });
      if (!response.ok) {
        setSwitching(null);
        return;
      }
      setActiveId(projectId);
      // Full reload, deliberately: see the note at the top.
      window.location.reload();
    } catch {
      setSwitching(null);
    }
  }

  const active = projects.find((p) => p.id === activeId);

  // One project is the common case and a switcher would be noise.
  if (loading || projects.length <= 1) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex h-9 min-w-0 max-w-[200px] items-center gap-2 rounded-md border border-border px-2.5 text-sm transition-colors hover:bg-muted focus:outline-none data-popup-open:bg-muted"
        aria-label="Switch project"
      >
        <FolderKanban className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="truncate font-medium">
          {active?.name ?? "Select project"}
        </span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-64">
        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
          Projects
        </div>
        <DropdownMenuSeparator />

        {projects.map((project) => (
          <DropdownMenuItem
            key={project.id}
            onSelect={(event) => {
              event.preventDefault();
              void switchTo(project.id);
            }}
            className="flex items-center justify-between gap-2"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate">{project.name}</span>
              {project.archived_at && (
                <span className="shrink-0 rounded bg-muted px-1 text-[10px] uppercase text-muted-foreground">
                  archived
                </span>
              )}
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              <span
                className={cn(
                  "text-[10px] uppercase tracking-wide text-muted-foreground",
                )}
              >
                {project.channel_type === "qr" ? "QR" : "API"}
              </span>
              {switching === project.id ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : project.id === activeId ? (
                <Check className="h-3.5 w-3.5" />
              ) : null}
            </span>
          </DropdownMenuItem>
        ))}

        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push("/settings?tab=projects")}>
          Manage projects
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
