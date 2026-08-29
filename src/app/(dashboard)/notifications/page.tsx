"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import {
  Bell,
  CheckCheck,
  ExternalLink,
  Loader2,
  MessageSquare,
  ShieldAlert,
  Trash2,
  UserPlus,
  Volume2,
  VolumeX,
} from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import {
  isSoundEnabled,
  setSoundEnabled,
  playNotificationSound,
} from "@/lib/notifications/sound";
import { cn } from "@/lib/utils";
import type { Notification } from "@/types";

export default function NotificationsPage() {
  const router = useRouter();
  const { user, accountId, activeProjectId } = useAuth();
  const [notifications, setNotifications] = useState<Notification[] | null>(null);
  const [filter, setFilter] = useState<"all" | "unread" | "assignments">("all");
  const [error, setError] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [permission, setPermission] = useState<NotificationPermission>("default");

  useEffect(() => {
    setSoundOn(isSoundEnabled());
    if (typeof window !== "undefined" && "Notification" in window) {
      setPermission(window.Notification.permission);
    }
  }, []);

  const load = useCallback(async () => {
    if (!user) return;
    const supabase = createClient();
    let query = supabase
      .from("notifications")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(100);

    if (activeProjectId) {
      query = query.eq("project_id", activeProjectId);
    }

    const { data, error: fetchErr } = await query;
    if (fetchErr) {
      setError(fetchErr.message);
      return;
    }
    setNotifications((data ?? []) as Notification[]);
  }, [user, activeProjectId]);

  useEffect(() => {
    load();
  }, [load]);

  // Realtime subscription
  useEffect(() => {
    if (!user) return;
    const supabase = createClient();
    const channelName = `notifications-page-${user.id}-${Math.random().toString(36).slice(2, 8)}`;
    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const row = payload.new as Notification;
            setNotifications((prev) => {
              if (!prev) return [row];
              if (prev.some((n) => n.id === row.id)) return prev;
              return [row, ...prev];
            });
          } else if (payload.eventType === "UPDATE") {
            const row = payload.new as Notification;
            setNotifications((prev) =>
              prev?.map((n) => (n.id === row.id ? { ...n, ...row } : n)) ?? prev
            );
          } else if (payload.eventType === "DELETE") {
            const oldRow = payload.old as Partial<Notification>;
            setNotifications((prev) =>
              prev?.filter((n) => n.id !== oldRow.id) ?? prev
            );
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  const markRead = useCallback(
    async (id: string) => {
      setNotifications((prev) =>
        prev?.map((n) =>
          n.id === id && !n.read_at
            ? { ...n, read_at: new Date().toISOString() }
            : n
        ) ?? prev
      );

      const supabase = createClient();
      const { error: updateErr } = await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("id", id)
        .is("read_at", null);

      if (updateErr) {
        toast.error("Failed to mark notification as read");
        load();
      }
    },
    [load]
  );

  const deleteNotification = useCallback(
    async (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      setNotifications((prev) => prev?.filter((n) => n.id !== id) ?? prev);

      const supabase = createClient();
      const { error: delErr } = await supabase
        .from("notifications")
        .delete()
        .eq("id", id);

      if (delErr) {
        toast.error("Failed to delete notification");
        load();
      } else {
        toast.success("Notification removed");
      }
    },
    [load]
  );

  const handleClick = useCallback(
    (n: Notification) => {
      if (!n.read_at) markRead(n.id);
      if (n.conversation_id) {
        router.push(`/inbox?c=${n.conversation_id}`);
      }
    },
    [markRead, router]
  );

  const unreadIds = notifications?.filter((n) => !n.read_at).map((n) => n.id) ?? [];

  const markAllRead = useCallback(async () => {
    if (unreadIds.length === 0 || !user) return;
    setMarkingAll(true);
    const now = new Date().toISOString();
    setNotifications(
      (prev) => prev?.map((n) => (n.read_at ? n : { ...n, read_at: now })) ?? prev
    );

    const supabase = createClient();
    const { error: updateErr } = await supabase
      .from("notifications")
      .update({ read_at: now })
      .eq("user_id", user.id)
      .is("read_at", null);

    setMarkingAll(false);
    if (updateErr) {
      toast.error("Failed to mark all as read");
      load();
    } else {
      toast.success("All notifications marked as read");
    }
  }, [unreadIds.length, user, load]);

  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    setSoundEnabled(next);
    if (next) {
      playNotificationSound();
      toast.success("Notification sound chime enabled");
    } else {
      toast.info("Notification sound chime muted");
    }
  };

  const requestDesktopPermission = async () => {
    if (typeof window !== "undefined" && "Notification" in window) {
      const result = await window.Notification.requestPermission();
      setPermission(result);
      if (result === "granted") {
        toast.success("Desktop notifications enabled!");
      } else {
        toast.error("Desktop notifications were not allowed.");
      }
    }
  };

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" onClick={() => window.location.reload()}>
          Retry
        </Button>
      </div>
    );
  }

  if (notifications === null) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const filteredNotifications = notifications.filter((n) => {
    if (filter === "unread") return !n.read_at;
    if (filter === "assignments") return n.type === "conversation_assigned";
    return true;
  });

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Notifications</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Realtime alerts for conversation assignments, incoming chats, and team activities.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={toggleSound}
            className="gap-1.5"
            title={soundOn ? "Mute notification sounds" : "Enable notification sounds"}
          >
            {soundOn ? (
              <>
                <Volume2 className="h-4 w-4 text-emerald-500" />
                <span className="text-xs">Sound On</span>
              </>
            ) : (
              <>
                <VolumeX className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs">Sound Muted</span>
              </>
            )}
          </Button>

          <Button
            variant="outline"
            size="sm"
            disabled={unreadIds.length === 0 || markingAll}
            onClick={markAllRead}
            className="gap-1.5"
          >
            {markingAll ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCheck className="h-4 w-4" />
            )}
            Mark all read
          </Button>
        </div>
      </div>

      {/* Desktop permission banner */}
      {permission === "default" && (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <ShieldAlert className="size-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">
                Get Desktop Push Notifications
              </p>
              <p className="text-xs text-muted-foreground">
                Never miss an incoming customer chat when working in another tab or window.
              </p>
            </div>
          </div>
          <Button
            size="sm"
            onClick={requestDesktopPermission}
            className="shrink-0"
          >
            Enable Desktop Alerts
          </Button>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 border-b border-border pb-3">
        <Button
          variant={filter === "all" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setFilter("all")}
          className="text-xs font-medium"
        >
          All ({notifications.length})
        </Button>
        <Button
          variant={filter === "unread" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setFilter("unread")}
          className="text-xs font-medium"
        >
          Unread ({unreadIds.length})
        </Button>
        <Button
          variant={filter === "assignments" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setFilter("assignments")}
          className="text-xs font-medium"
        >
          Assignments
        </Button>
      </div>

      {/* Notifications List */}
      {filteredNotifications.length === 0 ? (
        <div className="flex h-48 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/40 p-6 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 mb-3">
            <Bell className="h-6 w-6 text-primary" />
          </div>
          <p className="text-sm font-medium text-foreground">
            {filter === "unread" ? "No unread notifications" : "No notifications found"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {filter === "unread"
              ? "You are completely up to date."
              : "Notifications and assignments will appear here in realtime."}
          </p>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {filteredNotifications.map((n) => {
            const isUnread = !n.read_at;
            return (
              <li key={n.id}>
                <div
                  onClick={() => handleClick(n)}
                  className={cn(
                    "group flex items-start justify-between gap-4 rounded-xl border p-4 text-left transition-all cursor-pointer",
                    isUnread
                      ? "border-primary/40 bg-primary/5 hover:border-primary/60 shadow-sm"
                      : "border-border bg-card hover:border-border/80 hover:bg-muted/30"
                  )}
                >
                  <div className="flex items-start gap-3.5 min-w-0 flex-1">
                    <div
                      className={cn(
                        "flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg mt-0.5",
                        isUnread
                          ? "bg-primary/15 text-primary"
                          : "bg-muted text-muted-foreground"
                      )}
                    >
                      {n.type === "conversation_assigned" ? (
                        <UserPlus className="h-5 w-5" />
                      ) : (
                        <MessageSquare className="h-5 w-5" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "text-sm font-semibold truncate",
                            isUnread ? "text-foreground" : "text-muted-foreground"
                          )}
                        >
                          {n.title}
                        </span>
                        {isUnread && (
                          <span
                            aria-label="Unread"
                            className="h-2 w-2 flex-shrink-0 rounded-full bg-primary animate-pulse"
                          />
                        )}
                      </div>

                      {n.body && (
                        <p className="mt-1 text-xs text-muted-foreground/90 line-clamp-2 leading-relaxed">
                          {n.body}
                        </p>
                      )}

                      <p className="mt-2 text-[11px] text-muted-foreground/60 font-medium">
                        {formatDistanceToNow(new Date(n.created_at), {
                          addSuffix: true,
                        })}
                      </p>
                    </div>
                  </div>

                  {/* Actions on hover/mobile */}
                  <div className="flex items-center gap-1 shrink-0">
                    {n.conversation_id && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-8 text-muted-foreground hover:text-foreground opacity-80 group-hover:opacity-100"
                        title="Open Conversation in Inbox"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleClick(n);
                        }}
                      >
                        <ExternalLink className="size-4" />
                      </Button>
                    )}
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8 text-muted-foreground hover:text-destructive opacity-60 group-hover:opacity-100"
                      title="Dismiss notification"
                      onClick={(e) => deleteNotification(n.id, e)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
