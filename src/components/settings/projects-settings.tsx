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
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { QrPairing } from "@/components/settings/qr-pairing";
import {
  DeleteProjectDialog,
  type ProjectToDelete,
} from "@/components/projects/delete-project-dialog";

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
  channel_type: Channel;
  allowed_channels: Channel[];
  archived_at: string | null;
}

interface ProjectsSettingsProps {
  /** Owner/admin. Non-admins get a read-only list. */
  canManage: boolean;
}

type Channel = "qr" | "cloud_api";

const CHANNEL_COPY: Record<Channel, { label: string; blurb: string }> = {
  qr: {
    label: "QR code",
    blurb:
      "Pair any number by scanning, like WhatsApp Web. No Meta approval needed. No message templates.",
  },
  cloud_api: {
    label: "Cloud API",
    blurb:
      "Official Meta WhatsApp Business API. Supports approved templates and broadcasts. Requires a Meta app and a WABA.",
  },
};

export function ProjectsSettings({ canManage }: ProjectsSettingsProps) {
  const { isSuperAdmin, platformRole } = useAuth();
  const canCreateOrDeleteProject = isSuperAdmin || platformRole === "super_admin";

  const [projects, setProjects] = useState<Project[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<ProjectToDelete | null>(null);
  const [newName, setNewName] = useState("");
  const [newAllowedChannels, setNewAllowedChannels] = useState<Channel[]>(["qr"]);
  const [showForm, setShowForm] = useState(false);
  /** Project id whose channel toggle is mid-flight, so we can disable it. */
  const [savingChannels, setSavingChannels] = useState<string | null>(null);

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
    if (newAllowedChannels.length === 0) {
      toast.error("Select at least one connection method");
      return;
    }
    setCreating(true);
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          channel_type: newAllowedChannels[0],
          allowed_channels: newAllowedChannels,
        }),
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

  /**
   * Enable or disable one connection method on an existing project.
   *
   * The server is the authority on the result — we take
   * `data.project.allowed_channels` back rather than trusting the array
   * we computed, so a rejected or normalised value shows up immediately
   * instead of leaving the switch lying about the stored state.
   */
  async function toggleChannel(
    project: Project,
    channel: Channel,
    enable: boolean,
  ) {
    const next = enable
      ? Array.from(new Set([...project.allowed_channels, channel]))
      : project.allowed_channels.filter((c) => c !== channel);

    // Mirrors the API's own check so the round trip is skipped. A
    // project with no connection method could never send or receive.
    if (next.length === 0) {
      toast.error("A project needs at least one connection method.");
      return;
    }

    // Turning QR off does not log the number out — the gateway keeps
    // the socket and the inbox keeps syncing. Say so, because the
    // pairing controls vanish and that reads like a disconnect.
    if (
      !enable &&
      channel === "qr" &&
      !window.confirm(
        `Disable QR pairing for "${project.name}"? Any number already paired stays connected — use Disconnect first if you want to unlink it.`,
      )
    ) {
      return;
    }

    setSavingChannels(project.id);
    try {
      const response = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ allowed_channels: next }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        toast.error(data.error ?? "Could not update the project");
        return;
      }
      setProjects((prev) =>
        prev.map((p) => (p.id === project.id ? { ...p, ...data.project } : p)),
      );
      toast.success(
        `${CHANNEL_COPY[channel].label} ${enable ? "enabled" : "disabled"} for "${project.name}"`,
      );
    } catch {
      toast.error("Could not reach the server");
    } finally {
      setSavingChannels(null);
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
        {canCreateOrDeleteProject && !showForm && (
          <Button size="sm" onClick={() => setShowForm(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            New project
          </Button>
        )}
      </div>

      {showForm && canCreateOrDeleteProject && (
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
            <legend className="text-sm font-medium">WhatsApp connection methods</legend>
            {(["qr", "cloud_api"] as const).map((channel) => (
              <label
                key={channel}
                className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-3 text-sm"
              >
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={newAllowedChannels.includes(channel)}
                  onChange={(e) => {
                    setNewAllowedChannels((prev) =>
                      e.target.checked
                        ? [...prev, channel]
                        : prev.filter((c) => c !== channel),
                    );
                  }}
                />
                <span>
                  <span className="font-medium">
                    {CHANNEL_COPY[channel].label}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {CHANNEL_COPY[channel].blurb}
                  </span>
                </span>
              </label>
            ))}
            <p className="text-xs text-muted-foreground">
              Both can be enabled at once — you choose which to connect after
              the project exists, and you can change this later.
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
                    {project.allowed_channels.includes("qr") && (
                      <span className="inline-flex items-center gap-0.5">
                        <QrCode className="h-3 w-3" /> QR
                      </span>
                    )}
                    {project.allowed_channels.includes("qr") && project.allowed_channels.includes("cloud_api") && (
                      <span>·</span>
                    )}
                    {project.allowed_channels.includes("cloud_api") && (
                      <span className="inline-flex items-center gap-0.5">
                        <Radio className="h-3 w-3" /> Cloud API
                      </span>
                    )}
                    <span>·</span>
                    <span>{project.slug}</span>
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
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

                {canCreateOrDeleteProject && (
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() =>
                      setProjectToDelete({
                        id: project.id,
                        name: project.name,
                        slug: project.slug,
                      })
                    }
                    className="gap-1.5"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </Button>
                )}
              </div>
            </div>

            {!project.archived_at && (
              <div className="border-t border-border pt-4">
                <p className="text-sm font-medium">WhatsApp connection</p>
                <p className="mt-0.5 max-w-xl text-xs text-muted-foreground">
                  Choose how this project connects. Whatever you enable here
                  applies to this project only — its inbox, contacts and
                  conversations stay separate from every other project.
                </p>

                <div className="mt-3 space-y-2">
                  {(["qr", "cloud_api"] as const).map((channel) => {
                    const enabled = project.allowed_channels.includes(channel);
                    return (
                      <div
                        key={channel}
                        className="flex items-start gap-3 rounded-md border border-border p-3"
                      >
                        <Switch
                          id={`${project.id}-${channel}`}
                          checked={enabled}
                          disabled={!canManage || savingChannels === project.id}
                          onCheckedChange={(checked) =>
                            void toggleChannel(project, channel, checked)
                          }
                          className="mt-0.5"
                        />
                        <Label
                          htmlFor={`${project.id}-${channel}`}
                          className="cursor-pointer font-normal"
                        >
                          <span className="block text-sm font-medium">
                            {CHANNEL_COPY[channel].label}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {CHANNEL_COPY[channel].blurb}
                          </span>
                        </Label>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {project.allowed_channels.includes("qr") && !project.archived_at && (
              <div className="border-t border-border pt-4">
                <QrPairing
                  projectId={project.id}
                  projectName={project.name}
                  canManage={canManage}
                />
              </div>
            )}

            {project.allowed_channels.includes("cloud_api") && !project.archived_at && (
              <p className="border-t border-border pt-4 text-sm text-muted-foreground">
                Configure this project&apos;s Meta credentials under Settings →
                WhatsApp while it is the active project.
              </p>
            )}
          </div>
        ))}
      </div>

      <DeleteProjectDialog
        open={Boolean(projectToDelete)}
        onOpenChange={(open) => {
          if (!open) setProjectToDelete(null);
        }}
        project={projectToDelete}
        onDeleted={() => {
          setProjectToDelete(null);
          void load();
        }}
      />
    </div>
  );
}
