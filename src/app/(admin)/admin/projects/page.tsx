"use client";

import { useEffect, useState } from "react";
import { FolderKanban, Loader2, MessageSquare, Wifi, WifiOff } from "lucide-react";
import { useTranslations } from "next-intl";

interface Project {
  id: string;
  name: string;
  slug: string;
  channel_type: "qr" | "cloud_api";
  account_name: string;
  created_at: string;
}

export default function AdminProjectsPage() {
  const t = useTranslations("Admin.projects");
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Projects are account-scoped, so we list via the existing API.
    // A super admin's own projects will show here. For a full platform
    // view we'd need a dedicated admin API — this is the MVP.
    async function load() {
      try {
        const res = await fetch("/api/projects");
        if (!res.ok) throw new Error("Failed to load");
        const data = await res.json();
        setProjects(
          (data.projects ?? []).map((p: Record<string, unknown>) => ({
            id: String(p.id),
            name: String(p.name),
            slug: String(p.slug),
            channel_type: (p.channel_type as string) === "qr" ? "qr" : "cloud_api",
            account_name: "",
            created_at: String(p.created_at ?? ""),
          }))
        );
      } catch (err) {
        console.error("[admin/projects] load error:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
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
              <div key={p.id} className="flex items-center gap-4 px-6 py-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <FolderKanban className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{p.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {t("channel")}: {p.channel_type === "qr" ? "QR Code" : "Cloud API"}
                  </p>
                </div>
                <div className="hidden items-center gap-2 sm:flex">
                  {p.channel_type === "qr" ? (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <MessageSquare className="h-3.5 w-3.5" />
                      QR
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <Wifi className="h-3.5 w-3.5" />
                      API
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
