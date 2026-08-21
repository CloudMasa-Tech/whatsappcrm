"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useAuth } from "@/hooks/use-auth";
import { QrPairing } from "@/components/settings/qr-pairing";
import { WhatsAppConfig } from "@/components/settings/whatsapp-config";
import { Loader2, Wifi, QrCode } from "lucide-react";
import { cn } from "@/lib/utils";

type ChannelMethod = "qr" | "cloud_api";

export default function WhatsAppPage() {
  const t = useTranslations("WhatsApp.page");
  const {
    activeProjectId,
    activeProjectChannel,
    allowedChannels,
    loading,
    profileLoading,
    canEditSettings,
    canSendMessages,
    canConnectWhatsApp,
  } = useAuth();

  // Only offer what the project actually has switched on under
  // Settings → Projects. Showing a method that is disabled there would
  // let someone pair a number the project is not configured to use,
  // and make the toggle look like it did nothing.
  //
  // The array is never empty — both the API and the settings UI refuse
  // to remove the last channel — but fall back to QR rather than
  // rendering a page with no way to connect if that ever changes.
  const available: ChannelMethod[] =
    allowedChannels.length > 0 ? allowedChannels : ["qr"];

  const [selectedMethod, setSelectedMethod] = useState<ChannelMethod>(
    activeProjectChannel === "cloud_api" && available.includes("cloud_api")
      ? "cloud_api"
      : available[0],
  );

  // A method disabled after this component mounted must not stay
  // selected. Derived during render rather than synced in an effect.
  const method = available.includes(selectedMethod)
    ? selectedMethod
    : available[0];

  if (loading || profileLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!activeProjectId) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <p className="text-sm text-muted-foreground">{t("noProject")}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("description")}
        </p>
      </div>

      {/* Method selector — only the methods enabled for this project.
          Hidden entirely when there is just one: a picker with a single
          option is noise. */}
      {available.length > 1 && (
        <div className="flex gap-2">
          <button
            onClick={() => setSelectedMethod("qr")}
            className={cn(
              "flex items-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium transition-colors",
              method === "qr"
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-card text-muted-foreground hover:bg-muted",
            )}
          >
            <QrCode className="h-4 w-4" />
            {t("methodQR")}
          </button>
          <button
            onClick={() => setSelectedMethod("cloud_api")}
            className={cn(
              "flex items-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium transition-colors",
              method === "cloud_api"
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-card text-muted-foreground hover:bg-muted",
            )}
          >
            <Wifi className="h-4 w-4" />
            {t("methodMeta")}
          </button>
        </div>
      )}

      {/* Connection interface based on selected method */}
      {method === "qr" ? (
        <QrPairing
          projectId={activeProjectId}
          projectName="WhatsApp"
          canManage={canConnectWhatsApp || canSendMessages || canEditSettings}
        />
      ) : (
        <WhatsAppConfig />
      )}
    </div>
  );
}
