"use client";

import { useAuth } from "@/hooks/use-auth";
import { InstagramHub } from "@/components/instagram/instagram-hub";
import { Loader2, Shield } from "lucide-react";
import { Instagram } from "@/components/icons/instagram";

export default function InstagramPage() {
  const {
    activeProjectId,
    loading,
    profileLoading,
    canDisconnectWhatsApp,
  } = useAuth();

  if (loading || profileLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-pink-500" />
      </div>
    );
  }

  if (!activeProjectId) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <Instagram className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Select or create a project first to manage Instagram integration.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full space-y-6">
      <InstagramHub canDisconnect={canDisconnectWhatsApp} />
    </div>
  );
}
