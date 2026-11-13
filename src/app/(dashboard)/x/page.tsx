"use client";

import { Loader2 } from "lucide-react";

import { XSocialIcon } from "@/components/icons/x";
import { XConfig } from "@/components/settings/x-config";
import { useAuth } from "@/hooks/use-auth";

export default function XPage() {
  const {
    activeProjectId,
    loading,
    profileLoading,
    canDisconnectWhatsApp,
  } = useAuth();

  if (loading || profileLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!activeProjectId) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <XSocialIcon className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Select or create a project first to manage X (Twitter) integration.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full space-y-6">
      <XConfig canDisconnect={canDisconnectWhatsApp} />
    </div>
  );
}

