"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { playNotificationSound } from "@/lib/notifications/sound";
import type { Notification } from "@/types";

export function NotificationListener() {
  const router = useRouter();
  const { user, activeProjectId } = useAuth();
  const activeProjectIdRef = useRef(activeProjectId);
  activeProjectIdRef.current = activeProjectId;

  useEffect(() => {
    if (!user) return;

    const supabase = createClient();
    const channelName = `realtime-listener-${user.id}-${Math.random().toString(36).slice(2, 8)}`;

    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const row = payload.new as Notification;
          if (!row) return;

          // Play pleasant audio chime
          playNotificationSound();

          // Native Desktop Push Notification when page is in background
          if (
            typeof window !== "undefined" &&
            "Notification" in window &&
            window.Notification.permission === "granted" &&
            document.hidden
          ) {
            try {
              const desktopNotif = new window.Notification(row.title, {
                body: row.body || "New notification received in MaSa CRM",
                icon: "/logo.png",
                tag: row.id,
              });

              desktopNotif.onclick = () => {
                window.focus();
                if (row.conversation_id) {
                  router.push(`/inbox?c=${row.conversation_id}`);
                }
              };
            } catch {
              // Ignore browser desktop notification errors
            }
          }

          // In-App Toast
          toast(row.title, {
            description: row.body || undefined,
            action: row.conversation_id
              ? {
                  label: "Open",
                  onClick: () => {
                    if (row.conversation_id) {
                      router.push(`/inbox?c=${row.conversation_id}`);
                    }
                  },
                }
              : undefined,
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, router]);

  return null;
}
