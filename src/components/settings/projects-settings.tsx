"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  FolderKanban,
  Loader2,
  Plus,
  QrCode,
  Radio,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { QrPairing } from "@/components/settings/qr-pairing";

// ============================================================
// Projects — the isolation boundary inside an organisation.
//
// Each project keeps its own contacts, conversations, pipelines and
// flows, and connects its own WhatsApp number. Members with the agent
// or viewer role only reach projects they are assigned to; owners and
// admins reach all of them.
// ============================================================

interface Project {
  id: string;
  name: string;
  slug: string;
  channel_type: "qr" | "cloud_api";
  archived_at: string | null;
}

interface ProjectsSettingsProps {
  /** Owner/admin. Non-admins get a read-only list. */
  canManage: boolean;
}

export function ProjectsSettings({ canManage }: ProjectsSettingsProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newChannel, setNewChannel] = useState<"qr" | "cloud_api">("qr");
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/projects", { cache: "no-store" });
      if (!response.ok) {
        toast.error("Could not load projects");
        return;
      }
      const data = await response.json();
      setProjects(data.projects ?? []);
      setActiveId(data.active_project_id ?? null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createProject() {
    const name = newName.trim();
    if (!name) {
      toast.error("Give the project a name");
      return;
    }
    setCreating(true);
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, channel_type: newChannel }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        toast.error(data.error ?? "Could not create the project");
        return;
      }
      toast.success(`Created "${name}"`);
      setNewName("");
      setShowForm(false);
      void load();
    } finally {
      setCreating(false);
    }
  }

  async function setArchived(project: Project, archived: boolean) {
    const response = await fetch(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ archived }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      toast.error(data.error ?? "Could not update the project");
      return;
    }
    toast.success(archived ? "Project archived" : "Project restored");
    void load();
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading projects…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Projects</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Each project is a separate workspace with its own WhatsApp number,
            contacts, conversations and pipelines. Data never crosses between
            projects — assign agents to the ones they should see under Team
            members.
          </p>
        </div>
        {canManage && !showForm && (
          <Button size="sm" onClick={() => setShowForm(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            New project
          </Button>
        )}
      </div>

      {showForm && canManage && (
        <div className="space-y-4 rounded-lg border border-border p-4">
          <div className="space-y-2">
            <Label htmlFor="project-name">Project name</Label>
            <Input
              id="project-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Support, Sales, Clinic B…"
              maxLength={80}
            />
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">WhatsApp channel</legend>
            <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-3 text-sm">
              <input
                type="radio"
                name="channel"
                className="mt-1"
                checked={newChannel === "qr"}
                onChange={() => setNewChannel("qr")}
              />
              <span>
                <span className="font-medium">QR code</span>
                <span className="block text-xs text-muted-foreground">
                  Pair any number by scanning, like WhatsApp Web. No Meta
                  approval needed. No message templates.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-3 text-sm">
              <input
                type="radio"
                name="channel"
                className="mt-1"
                checked={newChannel === "cloud_api"}
                onChange={() => setNewChannel("cloud_api")}
              />
              <span>
                <span className="font-medium">Cloud API</span>
                <span className="block text-xs text-muted-foreground">
                  Official Meta WhatsApp Business API. Supports approved
                  templates and broadcasts. Requires a Meta app and a WABA.
                </span>
              </span>
            </label>
            <p className="text-xs text-muted-foreground">
              The channel cannot be changed later — existing conversations would
              be stranded on a transport that can no longer reach them.
            </p>
          </fieldset>

          <div className="flex gap-2">
            <Button size="sm" onClick={createProject} disabled={creating}>
              {creating && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Create project
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowForm(false)}
              disabled={creating}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {projects.map((project) => (
          <div
            key={project.id}
            className="space-y-4 rounded-lg border border-border p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <FolderKanban className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="flex items-center gap-2 font-medium">
                    {project.name}
                    {project.id === activeId && (
                      <span className="rounded bg-primary-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase text-primary">
                        active
                      </span>
                    )}
                    {project.archived_at && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                        archived
                      </span>
                    )}
                  </p>
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    {project.channel_type === "qr" ? (
                      <>
                        <QrCode className="h-3 w-3" /> QR code
                      </>
                    ) : (
                      <>
                        <Radio className="h-3 w-3" /> Cloud API
                      </>
                    )}
                    <span>·</span>
                    <span>{project.slug}</span>
                  </p>
                </div>
              </div>

              {canManage && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setArchived(project, !project.archived_at)}
                >
                  {project.archived_at ? (
                    <>
                      <ArchiveRestore className="mr-1.5 h-4 w-4" />
                      Restore
                    </>
                  ) : (
                    <>
                      <Archive className="mr-1.5 h-4 w-4" />
                      Archive
                    </>
                  )}
                </Button>
              )}
            </div>

            {project.channel_type === "qr" && !project.archived_at && (
              <div className="border-t border-border pt-4">
                <QrPairing
                  projectId={project.id}
                  projectName={project.name}
                  canManage={canManage}
                />
              </div>
            )}

            {project.channel_type === "cloud_api" && (
              <p className="border-t border-border pt-4 text-sm text-muted-foreground">
                Configure this project&apos;s Meta credentials under Settings →
                WhatsApp while it is the active project.
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
