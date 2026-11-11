"use client";

import { useAuth } from "@/hooks/use-auth";
import { LinkedInConfig } from "@/components/settings/linkedin-config";
import { Loader2 } from "lucide-react";
import { LinkedIn } from "@/components/icons/linkedin";

export default function LinkedInPage() {
  const {
    activeProjectId,
    loading,
    profileLoading,
    canDisconnectWhatsApp,
  } = useAuth();

  if (loading || profileLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-[#0A66C2]" />
      </div>
    );
  }

  if (!activeProjectId) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <LinkedIn className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Select or create a project first to manage LinkedIn integration.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full space-y-6">
      <LinkedInConfig canDisconnect={canDisconnectWhatsApp} />
    </div>
  );
}

