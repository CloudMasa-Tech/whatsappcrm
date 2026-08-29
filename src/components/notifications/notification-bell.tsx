"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import {
  Bell,
  CheckCheck,
  ExternalLink,
  MessageSquare,
  Volume2,
  VolumeX,
  UserPlus,
  ArrowRight,
  ShieldAlert,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useUnreadNotifications } from "@/hooks/use-unread-notifications";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  isSoundEnabled,
  setSoundEnabled,
  playNotificationSound,
} from "@/lib/notifications/sound";
import { cn } from "@/lib/utils";
import type { Notification } from "@/types";

export function NotificationBell() {
  const router = useRouter();
  const { user } = useAuth();
  const unreadCount = useUnreadNotifications();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [permission, setPermission] = useState<NotificationPermission>("default");

  useEffect(() => {
    setSoundOn(isSoundEnabled());
    if (typeof window !== "undefined" && "Notification" in window) {
      setPermission(window.Notification.permission);
    }
  }, []);

  const loadRecent = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const supabase = createClient();
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(8);

    setNotifications((data ?? []) as Notification[]);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    if (open) {
      loadRecent();
    }
  }, [open, loadRecent]);

  const markAsRead = async (id: string, conversationId?: string) => {
    setNotifications((prev) =>
      prev.map((n) =>
        n.id === id ? { ...n, read_at: new Date().toISOString() } : n
      )
    );

    const supabase = createClient();
    await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", id)
      .is("read_at", null);

    if (conversationId) {
      setOpen(false);
      router.push(`/inbox?c=${conversationId}`);
    }
  };

  const markAllRead = async () => {
    const now = new Date().toISOString();
    setNotifications((prev) =>
      prev.map((n) => (n.read_at ? n : { ...n, read_at: now }))
    );

    if (user) {
      const supabase = createClient();
      await supabase
        .from("notifications")
        .update({ read_at: now })
        .eq("user_id", user.id)
        .is("read_at", null);
    }
  };

  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    setSoundEnabled(next);
    if (next) {
      playNotificationSound();
    }
  };

  const requestDesktopPermission = async () => {
    if (typeof window !== "undefined" && "Notification" in window) {
      const result = await window.Notification.requestPermission();
      setPermission(result);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className="relative flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none"
        aria-label="Notifications"
      >
        <Bell className="size-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground animate-in zoom-in-75">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-80 sm:w-96 p-0 shadow-2xl border-border bg-card overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3 bg-muted/40">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold text-foreground">Notifications</h4>
            {unreadCount > 0 && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                {unreadCount} unread
              </span>
            )}
          </div>

          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground hover:text-foreground"
              title={soundOn ? "Mute notification sounds" : "Enable notification sounds"}
              onClick={toggleSound}
            >
              {soundOn ? <Volume2 className="size-3.5" /> : <VolumeX className="size-3.5 text-muted-foreground/60" />}
            </Button>

            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground gap-1"
                onClick={markAllRead}
              >
                <CheckCheck className="size-3" />
                Mark read
              </Button>
            )}
          </div>
        </div>

        {/* Desktop notification banner if permission not granted */}
        {permission === "default" && (
          <div className="bg-primary/10 px-4 py-2.5 border-b border-primary/20 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <ShieldAlert className="size-4 shrink-0 text-primary" />
              <p className="text-xs text-foreground truncate">
                Enable desktop alerts for new chats
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[11px] shrink-0 border-primary/30 text-primary hover:bg-primary/20"
              onClick={requestDesktopPermission}
            >
              Enable
            </Button>
          </div>
        )}

        {/* Notifications List */}
        <div className="max-h-[340px] overflow-y-auto divide-y divide-border">
          {loading && notifications.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">
              Loading notifications...
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex h-36 flex-col items-center justify-center p-4 text-center">
              <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground mb-2">
                <Bell className="size-4" />
              </div>
              <p className="text-sm font-medium text-foreground">All caught up!</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                No new notifications at this time.
              </p>
            </div>
          ) : (
            notifications.map((n) => {
              const isUnread = !n.read_at;
              return (
                <div
                  key={n.id}
                  onClick={() => markAsRead(n.id, n.conversation_id)}
                  className={cn(
                    "flex items-start gap-3 p-3.5 transition-colors cursor-pointer text-left",
                    isUnread
                      ? "bg-primary/5 hover:bg-primary/10"
                      : "hover:bg-muted/50"
                  )}
                >
                  <div
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-lg mt-0.5",
                      isUnread
                        ? "bg-primary/15 text-primary"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    {n.type === "conversation_assigned" ? (
                      <UserPlus className="size-4" />
                    ) : (
                      <MessageSquare className="size-4" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <p
                        className={cn(
                          "text-xs font-semibold truncate",
                          isUnread ? "text-foreground" : "text-muted-foreground"
                        )}
                      >
                        {n.title}
                      </p>
                      {isUnread && (
                        <span className="size-1.5 rounded-full bg-primary shrink-0" />
                      )}
                    </div>

                    {n.body && (
                      <p className="text-xs text-muted-foreground/90 line-clamp-2 mt-0.5">
                        {n.body}
                      </p>
                    )}

                    <p className="text-[10px] text-muted-foreground/60 mt-1">
                      {formatDistanceToNow(new Date(n.created_at), {
                        addSuffix: true,
                      })}
                    </p>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border p-2 bg-muted/20">
          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="flex items-center justify-center gap-1.5 py-1 text-xs font-medium text-primary hover:underline"
          >
            View all notifications
            <ArrowRight className="size-3" />
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
