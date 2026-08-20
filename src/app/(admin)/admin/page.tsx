"use client";

import { useEffect, useState } from "react";
import { Shield, Users, FolderKanban, MessageSquare } from "lucide-react";
import { useTranslations } from "next-intl";

interface Stats {
  totalCustomers: number;
  totalProjects: number;
  recentCustomers: Array<{
    id: string;
    email: string;
    full_name: string | null;
    created_at: string;
  }>;
}

export default function AdminDashboardPage() {
  const t = useTranslations("Admin.dashboard");
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/admin/users");
        if (!res.ok) throw new Error("Failed to load");
        const data = await res.json();
        setStats({
          totalCustomers: data.customers?.length ?? 0,
          totalProjects: 0, // Will be loaded separately if needed
          recentCustomers: (data.customers ?? []).slice(0, 5),
        });
      } catch (err) {
        console.error("[admin] stats load failed:", err);
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

      {/* Stats cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Users className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t("totalCustomers")}</p>
              <p className="text-2xl font-bold text-foreground">
                {loading ? "—" : stats?.totalCustomers ?? 0}
              </p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <FolderKanban className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t("activeProjects")}</p>
              <p className="text-2xl font-bold text-foreground">
                {loading ? "—" : stats?.totalProjects ?? 0}
              </p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <MessageSquare className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t("platformStatus")}</p>
              <p className="text-2xl font-bold text-green-500">{t("operational")}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Recent customers */}
      <div className="rounded-xl border border-border bg-card">
        <div className="border-b border-border px-6 py-4">
          <h2 className="text-lg font-semibold text-foreground">{t("recentCustomers")}</h2>
        </div>
        <div className="divide-y divide-border">
          {loading ? (
            <div className="px-6 py-8 text-center text-sm text-muted-foreground">
              {t("loading")}
            </div>
          ) : stats?.recentCustomers.length === 0 ? (
            <div className="px-6 py-8 text-center text-sm text-muted-foreground">
              {t("noCustomers")}
            </div>
          ) : (
            stats?.recentCustomers.map((customer) => (
              <div key={customer.id} className="flex items-center gap-4 px-6 py-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-sm font-medium text-primary">
                  {(customer.full_name ?? customer.email).charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {customer.full_name ?? customer.email}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {customer.email}
                  </p>
                </div>
                <p className="text-xs text-muted-foreground">
                  {new Date(customer.created_at).toLocaleDateString()}
                </p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
