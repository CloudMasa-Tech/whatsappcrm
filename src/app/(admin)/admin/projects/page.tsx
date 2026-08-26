"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  FolderKanban,
  Loader2,
  MessageSquare,
  Radio,
  Trash2,
  Users,
  UserPlus,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DeleteProjectDialog,
  type ProjectToDelete,
} from "@/components/projects/delete-project-dialog";
import { cn } from "@/lib/utils";

interface ProjectMember {
  user_id: string;
  full_name: string | null;
  email: string;
  role: "admin" | "agent";
}

interface Project {
  id: string;
  name: string;
  slug: string;
  channel_type: "qr" | "cloud_api";
  account_name: string;
  created_at: string;
  members: ProjectMember[];
}

export default function AdminProjectsPage() {
  const t = useTranslations("Admin.projects");
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [projectToDelete, setProjectToDelete] = useState<ProjectToDelete | null>(null);

  async function load() {
    try {
      const res = await fetch("/api/projects", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();
      setProjects(
        (data.projects ?? []).map((p: Record<string, unknown>) => ({
          id: String(p.id),
          name: String(p.name),
          slug: String(p.slug),
          channel_type:
            (p.channel_type as string) === "qr" ? "qr" : "cloud_api",
          account_name: "",
          created_at: String(p.created_at ?? ""),
          members: Array.isArray(p.members) ? (p.members as ProjectMember[]) : [],
        })),
      );
    } catch (err) {
      console.error("[admin/projects] load error:", err);
      toast.error("Failed to load projects");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("description")}
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card">
        <div className="divide-y divide-border">
          {loading ? (
            <div className="flex items-center justify-center px-6 py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : projects.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <FolderKanban className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">{t("noProjects")}</p>
            </div>
          ) : (
            projects.map((p) => (
              <div
                key={p.id}
                className="flex flex-col gap-4 px-6 py-5"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                      <FolderKanban className="h-5 w-5 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium text-foreground">
                          {p.name}
                        </p>
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
                          {p.slug}
                        </span>
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        {t("channel")}:{" "}
                        {p.channel_type === "qr" ? "WhatsApp QR Code" : "WhatsApp Cloud API"}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 self-end sm:self-auto">
                    <div className="hidden items-center gap-2 sm:flex">
                      {p.channel_type === "qr" ? (
                        <span className="inline-flex items-center gap-1 rounded bg-muted/60 px-2 py-1 text-xs text-muted-foreground">
                          <MessageSquare className="h-3.5 w-3.5" />
                          QR
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded bg-muted/60 px-2 py-1 text-xs text-muted-foreground">
                          <Radio className="h-3.5 w-3.5" />
                          API
                        </span>
                      )}
                    </div>

                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => setProjectToDelete({ id: p.id, name: p.name, slug: p.slug })}
                      className="h-8 gap-1.5 text-xs"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </Button>
                  </div>
                </div>

                {/* Assigned Customers / Team Members Section */}
                <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                      <Users className="h-3.5 w-3.5 text-primary" />
                      <span>Assigned Customers & Team Members ({p.members.length})</span>
                    </div>
                    <Link
                      href="/admin/customers"
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                    >
                      <UserPlus className="h-3 w-3" />
                      Add Customer
                    </Link>
                  </div>

                  {p.members.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">
                      No customer or agent assigned yet. Create or allocate a customer in the Customers tab.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {p.members.map((m) => (
                        <div
                          key={m.user_id}
                          className="flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs shadow-sm"
                        >
                          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                            {(m.full_name || m.email).charAt(0).toUpperCase()}
                          </div>
                          <div className="flex flex-col">
                            <span className="font-medium text-foreground">
                              {m.full_name || m.email}
                            </span>
                            {m.full_name && (
                              <span className="text-[10px] text-muted-foreground font-mono">
                                {m.email}
                              </span>
                            )}
                          </div>
                          <Badge
                            className={cn(
                              "text-[9px] px-1.5 py-0 capitalize",
                              m.role === "admin"
                                ? "bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20"
                                : "bg-primary/10 text-primary border border-primary/20"
                            )}
                          >
                            {m.role}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
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

