"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  FolderKanban,
  Radio,
  Users,
  MessageSquare,
  QrCode,
  RefreshCw,
  Plus,
  ArrowUpRight,
  Shield,
  Activity,
  Layers,
  CheckCircle2,
  Calendar,
  FileText,
  AlertTriangle,
} from "lucide-react";
import { Instagram } from "@/components/icons/instagram";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface DashboardMetrics {
  totalProjects: number;
  activeProjects: number;
  qrProjects: number;
  cloudApiProjects: number;
  totalUsers: number;
  totalSuperAdmins: number;
  totalAdmins: number;
  totalAgents: number;
  connectedWhatsApp: number;
  connectedInstagram: number;
  totalConnectedAccounts: number;
  totalConversations: number;
  totalMessages: number;
  pendingTemplates?: number;
}

interface RecentProject {
  id: string;
  name: string;
  slug: string;
  channel_type: string;
  archived_at: string | null;
  created_at: string;
}

interface RecentUser {
  id: string;
  user_id: string;
  email: string;
  full_name: string | null;
  role: string;
  projects: string;
  created_at: string;
}

interface AdminStatsResponse {
  metrics: DashboardMetrics;
  recentProjects: RecentProject[];
  recentUsers: RecentUser[];
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

export function SuperAdminDashboard() {
  const t = useTranslations("Admin.dashboard");
  const [data, setData] = useState<AdminStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchStats = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const res = await fetch("/api/admin/stats");
      if (!res.ok) throw new Error("Failed to fetch admin stats");
      const json: AdminStatsResponse = await res.json();
      setData(json);
    } catch (err) {
      console.error("[superadmin-dashboard] load failed:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const metrics = data?.metrics;

  return (
    <div className="space-y-8 pb-10">
      {/* Top Header & Actions */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-6 items-center gap-1.5 rounded-full bg-primary/10 px-2.5 text-xs font-semibold text-primary">
              <Shield className="h-3 w-3" />
              Super Admin Console
            </span>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              Live Platform
            </span>
          </div>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            {t("title")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("description")}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchStats(true)}
            disabled={loading || refreshing}
            className="gap-1.5"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", (loading || refreshing) && "animate-spin")} />
            {t("refresh")}
          </Button>

          <Link href="/admin/projects">
            <Button size="sm" variant="outline" className="gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              {t("newProject")}
            </Button>
          </Link>

          <Link href="/admin/customers">
            <Button size="sm" className="gap-1.5">
              <Users className="h-3.5 w-3.5" />
              {t("onboardUser")}
            </Button>
          </Link>
        </div>
      </div>

      {/* Pending Templates Approval Banner */}
      {!loading && (metrics?.pendingTemplates ?? 0) > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-amber-500/30 bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent p-5 shadow-sm">
          <div className="flex items-center gap-3.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/20 text-amber-500 dark:text-amber-400">
              <FileText className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-semibold text-foreground">
                {metrics?.pendingTemplates} Message Template{metrics?.pendingTemplates === 1 ? "" : "s"} Awaiting Super Admin Approval
              </h3>
              <p className="text-xs text-muted-foreground">
                Project admins have created templates requiring your approval before they can be sent to customers.
              </p>
            </div>
          </div>
          <Link href="/admin/templates">
            <Button size="sm" className="bg-amber-600 hover:bg-amber-700 text-white gap-1.5 font-medium shadow-sm">
              Review & Approve Templates
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Button>
          </Link>
        </div>
      )}

      {/* Primary KPI Grid: Number of Projects, Number of Connected Accounts, Number of Users, Platform Messages */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* 1. Total Projects */}
        <div className="relative overflow-hidden rounded-2xl border border-border/80 bg-card p-5 shadow-sm transition-all hover:shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t("totalProjects")}
            </span>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
              <FolderKanban className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-3xl font-bold tracking-tight text-foreground">
              {loading ? "—" : metrics?.totalProjects ?? 0}
            </span>
            <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
              {loading ? "" : `${metrics?.activeProjects ?? 0} Active`}
            </span>
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-border/60 pt-3 text-xs text-muted-foreground">
            <span>
              QR: <strong className="font-semibold text-foreground">{metrics?.qrProjects ?? 0}</strong>
            </span>
            <span>·</span>
            <span>
              Cloud API: <strong className="font-semibold text-foreground">{metrics?.cloudApiProjects ?? 0}</strong>
            </span>
            <Link
              href="/admin/projects"
              className="ml-auto inline-flex items-center gap-0.5 font-medium text-primary hover:underline"
            >
              Manage <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>
        </div>

        {/* 2. Connected Accounts */}
        <div className="relative overflow-hidden rounded-2xl border border-border/80 bg-card p-5 shadow-sm transition-all hover:shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t("connectedAccounts")}
            </span>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <Radio className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-3xl font-bold tracking-tight text-foreground">
              {loading ? "—" : metrics?.totalConnectedAccounts ?? 0}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Connected
            </span>
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-border/60 pt-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <QrCode className="h-3 w-3 text-emerald-500" />
              WA: <strong className="font-semibold text-foreground">{metrics?.connectedWhatsApp ?? 0}</strong>
            </span>
            <span>·</span>
            <span className="inline-flex items-center gap-1">
              <Instagram className="h-3 w-3 text-pink-500" />
              IG: <strong className="font-semibold text-foreground">{metrics?.connectedInstagram ?? 0}</strong>
            </span>
          </div>
        </div>

        {/* 3. Total Users */}
        <div className="relative overflow-hidden rounded-2xl border border-border/80 bg-card p-5 shadow-sm transition-all hover:shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t("totalUsers")}
            </span>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400">
              <Users className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-3xl font-bold tracking-tight text-foreground">
              {loading ? "—" : metrics?.totalUsers ?? 0}
            </span>
            <span className="text-xs text-muted-foreground">Accounts</span>
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-border/60 pt-3 text-xs text-muted-foreground">
            <span>
              Admins: <strong className="font-semibold text-foreground">{metrics?.totalAdmins ?? 0}</strong>
            </span>
            <span>·</span>
            <span>
              Agents: <strong className="font-semibold text-foreground">{metrics?.totalAgents ?? 0}</strong>
            </span>
            <Link
              href="/admin/customers"
              className="ml-auto inline-flex items-center gap-0.5 font-medium text-primary hover:underline"
            >
              Roster <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>
        </div>

        {/* 4. Platform Messaging Activity */}
        <div className="relative overflow-hidden rounded-2xl border border-border/80 bg-card p-5 shadow-sm transition-all hover:shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t("totalMessages")}
            </span>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <MessageSquare className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-3xl font-bold tracking-tight text-foreground">
              {loading ? "—" : metrics?.totalMessages ?? 0}
            </span>
            <span className="text-xs text-muted-foreground">Sent / Received</span>
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-border/60 pt-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Activity className="h-3 w-3 text-primary" />
              Conversations: <strong className="font-semibold text-foreground">{metrics?.totalConversations ?? 0}</strong>
            </span>
          </div>
        </div>
      </div>

      {/* Channel Connections Breakdown */}
      <div className="rounded-2xl border border-border/80 bg-card p-6 shadow-sm">
        <div className="flex items-center justify-between border-b border-border/60 pb-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Channel Integration Status</h2>
            <p className="text-xs text-muted-foreground">
              Real-time connectivity across WhatsApp QR, Meta Cloud API, and Instagram DM channels
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5" />
            All Gateways Operational
          </span>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {/* WhatsApp QR Gateway */}
          <div className="rounded-xl border border-border/60 bg-muted/30 p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600">
                <QrCode className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-muted-foreground">WhatsApp QR Gateway</p>
                <p className="text-base font-bold text-foreground">
                  {metrics?.connectedWhatsApp ?? 0} Connected
                </p>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Direct socket session gateway active
            </div>
          </div>

          {/* WhatsApp Cloud API */}
          <div className="rounded-xl border border-border/60 bg-muted/30 p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600">
                <Radio className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-muted-foreground">Meta Cloud API</p>
                <p className="text-base font-bold text-foreground">
                  {metrics?.cloudApiProjects ?? 0} Configured
                </p>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
              Official Business API endpoints ready
            </div>
          </div>

          {/* Instagram Direct */}
          <div className="rounded-xl border border-border/60 bg-muted/30 p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-pink-500/10 text-pink-600">
                <Instagram className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-muted-foreground">Instagram Messaging</p>
                <p className="text-base font-bold text-foreground">
                  {metrics?.connectedInstagram ?? 0} Connected
                </p>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-pink-500" />
              Graph API DM webhooks registered
            </div>
          </div>
        </div>
      </div>

      {/* 2-Column Tables: Recent Projects & Recent Users */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Left Column: Recent Projects */}
        <div className="rounded-2xl border border-border/80 bg-card shadow-sm">
          <div className="flex items-center justify-between border-b border-border/60 px-6 py-4">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-primary" />
              <h2 className="font-semibold text-foreground">{t("recentProjects")}</h2>
            </div>
            <Link
              href="/admin/projects"
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              {t("viewAll")} <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>

          <div className="divide-y divide-border/60">
            {loading ? (
              <div className="px-6 py-8 text-center text-sm text-muted-foreground">
                {t("loading")}
              </div>
            ) : !data?.recentProjects || data.recentProjects.length === 0 ? (
              <div className="px-6 py-8 text-center text-sm text-muted-foreground">
                {t("noProjects")}
              </div>
            ) : (
              data.recentProjects.map((project) => (
                <div key={project.id} className="flex items-center justify-between px-6 py-3.5 transition-colors hover:bg-muted/40">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium text-foreground">
                        {project.name}
                      </p>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                          project.channel_type === "qr"
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                            : "bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20"
                        )}
                      >
                        {project.channel_type === "qr" ? "WhatsApp QR" : "Cloud API"}
                      </span>
                    </div>
                    <p className="truncate text-xs text-muted-foreground mt-0.5">
                      Slug: {project.slug}
                    </p>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="hidden text-right sm:block">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-medium",
                          project.archived_at
                            ? "bg-muted text-muted-foreground"
                            : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                        )}
                      >
                        {project.archived_at ? "Archived" : "Active"}
                      </span>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        {fmtDate(project.created_at)}
                      </p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right Column: Recent Users & Project Assignments */}
        <div className="rounded-2xl border border-border/80 bg-card shadow-sm">
          <div className="flex items-center justify-between border-b border-border/60 px-6 py-4">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              <h2 className="font-semibold text-foreground">{t("recentUsers")}</h2>
            </div>
            <Link
              href="/admin/customers"
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              {t("viewAll")} <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>

          <div className="divide-y divide-border/60">
            {loading ? (
              <div className="px-6 py-8 text-center text-sm text-muted-foreground">
                {t("loading")}
              </div>
            ) : !data?.recentUsers || data.recentUsers.length === 0 ? (
              <div className="px-6 py-8 text-center text-sm text-muted-foreground">
                {t("noUsers")}
              </div>
            ) : (
              data.recentUsers.map((user) => (
                <div key={user.id} className="flex items-center justify-between px-6 py-3.5 transition-colors hover:bg-muted/40">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                      {(user.full_name ?? user.email).charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium text-foreground">
                          {user.full_name ?? user.email}
                        </p>
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                            user.role === "Super Admin"
                              ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20"
                              : user.role === "Admin"
                              ? "bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20"
                              : "bg-primary/10 text-primary border border-primary/20"
                          )}
                        >
                          {user.role}
                        </span>
                      </div>
                      <p className="truncate text-xs text-muted-foreground mt-0.5">
                        {user.email} · <span className="text-foreground/80 font-medium">{user.projects}</span>
                      </p>
                    </div>
                  </div>

                  <div className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
                    <Calendar className="h-3.5 w-3.5" />
                    {fmtDate(user.created_at)}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
