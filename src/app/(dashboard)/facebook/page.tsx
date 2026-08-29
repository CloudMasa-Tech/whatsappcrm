"use client";

import { useAuth } from "@/hooks/use-auth";
import { FacebookHub } from "@/components/facebook/facebook-hub";
import { FacebookConnect } from "@/components/facebook/facebook-connect";
import { Loader2 } from "lucide-react";
import { Facebook } from "@/components/icons/facebook";

export default function FacebookPage() {
  const {
    activeProjectId,
    loading,
    profileLoading,
    canDisconnectWhatsApp,
  } = useAuth();

  if (loading || profileLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!activeProjectId) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <Facebook className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Select or create a project first to manage Facebook integration.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full space-y-4">
      <FacebookConnect />
      <FacebookHub canDisconnect={canDisconnectWhatsApp} />
    </div>
  );
}
