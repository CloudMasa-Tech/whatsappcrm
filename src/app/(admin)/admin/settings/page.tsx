"use client";

import { Shield, Info } from "lucide-react";
import { useTranslations } from "next-intl";

export default function AdminSettingsPage() {
  const t = useTranslations("Admin.settings");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
      </div>

      <div className="rounded-xl border border-border bg-card p-6">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Shield className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-foreground">{t("platformInfo")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t("platformInfoDesc")}</p>
            <div className="mt-4 space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">{t("platform")}:</span>
                <span className="font-medium text-foreground">MaSa CRM v0.8.0</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">{t("role")}:</span>
                <span className="font-medium text-foreground">Super Admin</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-6">
        <div className="flex items-start gap-3">
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          <div>
            <h3 className="text-sm font-medium text-foreground">{t("notesTitle")}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{t("notesDesc")}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
