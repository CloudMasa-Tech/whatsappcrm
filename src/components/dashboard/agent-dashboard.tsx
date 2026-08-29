"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useRouter } from "next/navigation";
import {
  MessageSquare,
  CheckCircle2,
  Clock,
  Send,
  ArrowRight,
  Search,
  MessageCircle,
  Sparkles,
  Inbox,
  User,
  Phone,
  Mail,
  Building2,
  Calendar,
  Activity,
} from "lucide-react";
import { Instagram } from "@/components/icons/instagram";
import { Facebook } from "@/components/icons/facebook";
import { MetricCard } from "@/components/dashboard/metric-card";
import { SkeletonCard } from "@/components/dashboard/skeleton";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDistanceToNow, format } from "date-fns";
import { cn } from "@/lib/utils";
import type { Contact, Conversation, Message } from "@/types";

interface AssignedConversation extends Conversation {
  contact?: Contact;
}

export function AgentDashboard() {
  const router = useRouter();
  const { user, profile, activeProjectId, activeProjectName } = useAuth();

  const [activeConversations, setActiveConversations] = useState<AssignedConversation[]>([]);
  const [resolvedConversations, setResolvedConversations] = useState<AssignedConversation[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(true);

  const [myMessagesToday, setMyMessagesToday] = useState(0);
  const [myTotalMessages, setMyTotalMessages] = useState(0);
  const [recentMessages, setRecentMessages] = useState<Message[]>([]);
  const [metricsLoading, setMetricsLoading] = useState(true);

  const [search, setSearch] = useState("");

  const agentName = profile?.full_name || user?.email?.split("@")[0] || "Agent";

  const loadAgentData = useCallback(async () => {
    if (!user || !activeProjectId) {
      setConversationsLoading(false);
      setMetricsLoading(false);
      return;
    }

    const db = createClient();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    // 1. Fetch Conversations strictly assigned to this agent
    setConversationsLoading(true);
    try {
      const { data: convs, error: convErr } = await db
        .from("conversations")
        .select(
          "id, contact_id, status, channel, unread_count, last_message_text, last_message_at, updated_at, assigned_agent_id, contact:contacts(id, name, phone, email, company, channel, avatar_url)"
        )
        .eq("assigned_agent_id", user.id)
        .order("updated_at", { ascending: false });

      if (convErr) {
        console.error("[AgentDashboard] conv fetch error:", convErr);
      } else {
        const formatted: AssignedConversation[] = (convs ?? []).map((c: any) => ({
          ...c,
          contact: Array.isArray(c.contact) ? c.contact[0] : c.contact,
        }));

        setActiveConversations(
          formatted.filter((c) => c.status === "open" || c.status === "pending")
        );
        setResolvedConversations(formatted.filter((c) => c.status === "closed"));
      }
    } catch (err) {
      console.error("[AgentDashboard] conv error:", err);
    } finally {
      setConversationsLoading(false);
    }

    // 2. Fetch Agent's Personal Message Output Metrics
    setMetricsLoading(true);
    try {
      const [todayRes, totalRes, recentMsgRes] = await Promise.all([
        db
          .from("messages")
          .select("id", { count: "exact", head: true })
          .eq("sender_type", "agent")
          .gte("created_at", todayStart.toISOString()),
        db
          .from("messages")
          .select("id", { count: "exact", head: true })
          .eq("sender_type", "agent"),
        db
          .from("messages")
          .select("id, conversation_id, content_text, content_type, created_at, status, sender_type, channel")
          .eq("sender_type", "agent")
          .order("created_at", { ascending: false })
          .limit(10),
      ]);

      setMyMessagesToday(todayRes.count ?? 0);
      setMyTotalMessages(totalRes.count ?? 0);
      setRecentMessages((recentMsgRes.data as Message[]) ?? []);
    } catch (err) {
      console.error("[AgentDashboard] metrics error:", err);
    } finally {
      setMetricsLoading(false);
    }
  }, [user, activeProjectId]);

  useEffect(() => {
    loadAgentData();
  }, [loadAgentData]);

  // Unread conversations assigned to me
  const unreadCount = useMemo(() => {
    return activeConversations.filter((c) => (c.unread_count ?? 0) > 0).length;
  }, [activeConversations]);

  // Filtered active conversations for search
  const filteredActive = useMemo(() => {
    if (!search.trim()) return activeConversations;
    const q = search.toLowerCase();
    return activeConversations.filter((c) => {
      const name = c.contact?.name?.toLowerCase() ?? "";
      const phone = c.contact?.phone?.toLowerCase() ?? "";
      const company = c.contact?.company?.toLowerCase() ?? "";
      const msg = c.last_message_text?.toLowerCase() ?? "";
      return name.includes(q) || phone.includes(q) || company.includes(q) || msg.includes(q);
    });
  }, [activeConversations, search]);

  const filteredResolved = useMemo(() => {
    if (!search.trim()) return resolvedConversations;
    const q = search.toLowerCase();
    return resolvedConversations.filter((c) => {
      const name = c.contact?.name?.toLowerCase() ?? "";
      const phone = c.contact?.phone?.toLowerCase() ?? "";
      const company = c.contact?.company?.toLowerCase() ?? "";
      return name.includes(q) || phone.includes(q) || company.includes(q);
    });
  }, [resolvedConversations, search]);

  return (
    <div className="space-y-6 p-4 sm:p-6 max-w-7xl mx-auto">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 rounded-xl border border-primary/20 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-5 sm:p-6 shadow-sm">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary text-xs font-semibold px-2.5 py-0.5">
              Agent Workstation
            </Badge>
            {activeProjectName && (
              <span className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                • {activeProjectName}
              </span>
            )}
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            Welcome back, {agentName}!
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Here is your daily operational summary and queue of conversations assigned to you.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button
            onClick={() => router.push("/inbox")}
            className="bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm flex items-center gap-2"
          >
            <Inbox className="h-4 w-4" />
            <span>Open My Inbox</span>
            {unreadCount > 0 && (
              <span className="ml-1 rounded-full bg-red-500 px-2 py-0.5 text-xs font-bold text-white">
                {unreadCount}
              </span>
            )}
          </Button>
        </div>
      </div>

      {/* Metrics Row (Personal Agent Performance) */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {metricsLoading || conversationsLoading ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : (
          <>
            <MetricCard
              title="My Active Chats"
              value={activeConversations.length.toLocaleString()}
              icon={MessageSquare}
              subtitle="Open conversations in your queue"
            />
            <MetricCard
              title="Pending Replies"
              value={unreadCount.toLocaleString()}
              icon={Clock}
              subtitle={unreadCount > 0 ? "Unread customer messages" : "All caught up"}
            />
            <MetricCard
              title="My Resolved Chats"
              value={resolvedConversations.length.toLocaleString()}
              icon={CheckCircle2}
              subtitle="Successfully closed conversations"
            />
            <MetricCard
              title="Messages Sent Today"
              value={myMessagesToday.toLocaleString()}
              icon={Send}
              subtitle={`${myTotalMessages} total messages processed`}
            />
          </>
        )}
      </div>

      {/* Main Content Area: Assigned Conversations & Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: My Assigned Conversations */}
        <div className="lg:col-span-2 space-y-4">
          <Card className="border-border shadow-sm">
            <CardHeader className="p-4 sm:p-5 border-b border-border">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base sm:text-lg font-semibold flex items-center gap-2">
                    <Inbox className="h-5 w-5 text-primary" />
                    My Assigned Conversations
                  </CardTitle>
                  <CardDescription className="text-xs sm:text-sm text-muted-foreground mt-0.5">
                    Conversations assigned specifically to you by project administrators
                  </CardDescription>
                </div>
                <div className="w-full sm:w-64">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      placeholder="Search customer, phone, text..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="h-8 pl-8 text-xs bg-muted/50 border-border"
                    />
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Tabs defaultValue="active" className="w-full">
                <div className="px-4 pt-3 border-b border-border">
                  <TabsList className="h-8 bg-muted/60">
                    <TabsTrigger value="active" className="text-xs gap-1.5 h-7">
                      Active Queue
                      <Badge variant="secondary" className="px-1.5 py-0 text-[10px] font-semibold">
                        {activeConversations.length}
                      </Badge>
                    </TabsTrigger>
                    <TabsTrigger value="resolved" className="text-xs gap-1.5 h-7">
                      Resolved
                      <Badge variant="secondary" className="px-1.5 py-0 text-[10px] font-semibold">
                        {resolvedConversations.length}
                      </Badge>
                    </TabsTrigger>
                  </TabsList>
                </div>

                {/* Tab 1: Active Conversations */}
                <TabsContent value="active" className="m-0 divide-y divide-border">
                  {conversationsLoading ? (
                    <div className="p-8 text-center text-sm text-muted-foreground">
                      Loading your assigned conversations...
                    </div>
                  ) : filteredActive.length === 0 ? (
                    <div className="p-12 text-center">
                      <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
                        <Sparkles className="h-6 w-6 text-primary" />
                      </div>
                      <h4 className="text-sm font-semibold text-foreground">
                        {search ? "No matching conversations" : "You're all caught up!"}
                      </h4>
                      <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                        {search
                          ? "Try searching with a different contact name or phone number."
                          : "No active conversations are currently assigned to you. New assignments from administrators will appear here."}
                      </p>
                    </div>
                  ) : (
                    filteredActive.map((conv) => {
                      const contact = conv.contact;
                      const displayName = contact?.name || contact?.phone || "Customer";
                      const isUnread = (conv.unread_count ?? 0) > 0;
                      const timeAgo = conv.last_message_at
                        ? formatDistanceToNow(new Date(conv.last_message_at), { addSuffix: true })
                        : "recently";

                      return (
                        <div
                          key={conv.id}
                          className={cn(
                            "flex items-center justify-between p-3.5 sm:p-4 hover:bg-muted/40 transition-colors cursor-pointer",
                            isUnread && "bg-primary/5"
                          )}
                          onClick={() => router.push(`/inbox?c=${conv.id}`)}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="relative h-10 w-10 shrink-0 rounded-full bg-muted flex items-center justify-center text-sm font-semibold text-foreground border border-border">
                              {contact?.avatar_url ? (
                                <img
                                  src={contact.avatar_url}
                                  alt={displayName}
                                  className="h-full w-full rounded-full object-cover"
                                />
                              ) : (
                                displayName.slice(0, 2).toUpperCase()
                              )}
                              {conv.channel === "instagram" ? (
                                <div className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full bg-gradient-to-tr from-yellow-400 via-pink-500 to-purple-600 flex items-center justify-center text-white ring-1 ring-background">
                                  <Instagram className="h-2.5 w-2.5" />
                                </div>
                              ) : conv.channel === "facebook" ? (
                                <div className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full bg-blue-600 flex items-center justify-center text-white ring-1 ring-background">
                                  <Facebook className="h-2.5 w-2.5" />
                                </div>
                              ) : (
                                <div className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full bg-emerald-600 flex items-center justify-center text-white ring-1 ring-background">
                                  <MessageCircle className="h-2.5 w-2.5" />
                                </div>
                              )}
                            </div>

                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-foreground truncate">
                                  {displayName}
                                </span>
                                {isUnread && (
                                  <Badge className="h-4 px-1.5 text-[10px] bg-primary text-primary-foreground font-semibold">
                                    {conv.unread_count} new
                                  </Badge>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground truncate mt-0.5">
                                {conv.last_message_text || "No message preview"}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-3 shrink-0 ml-3">
                            <span className="text-[11px] text-muted-foreground hidden sm:inline">
                              {timeAgo}
                            </span>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2.5 text-xs text-primary hover:text-primary hover:bg-primary/10"
                              onClick={(e) => {
                                e.stopPropagation();
                                router.push(`/inbox?c=${conv.id}`);
                              }}
                            >
                              <span>Reply</span>
                              <ArrowRight className="ml-1 h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </TabsContent>

                {/* Tab 2: Resolved Conversations */}
                <TabsContent value="resolved" className="m-0 divide-y divide-border">
                  {conversationsLoading ? (
                    <div className="p-8 text-center text-sm text-muted-foreground">
                      Loading resolved conversations...
                    </div>
                  ) : filteredResolved.length === 0 ? (
                    <div className="p-8 text-center text-xs text-muted-foreground">
                      No resolved conversations found.
                    </div>
                  ) : (
                    filteredResolved.map((conv) => {
                      const contact = conv.contact;
                      const displayName = contact?.name || contact?.phone || "Customer";
                      return (
                        <div
                          key={conv.id}
                          className="flex items-center justify-between p-3.5 hover:bg-muted/40 transition-colors cursor-pointer"
                          onClick={() => router.push(`/inbox?c=${conv.id}`)}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-xs font-medium text-foreground">
                              {displayName.slice(0, 2).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <span className="text-sm font-medium text-foreground truncate block">
                                {displayName}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                Status: Resolved
                              </span>
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs"
                            onClick={(e) => {
                              e.stopPropagation();
                              router.push(`/inbox?c=${conv.id}`);
                            }}
                          >
                            View
                          </Button>
                        </div>
                      );
                    })
                  )}
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>

        {/* Right 1 Col: Quick Actions & Agent Recent Activity */}
        <div className="space-y-6">
          {/* Quick Shortcuts */}
          <Card className="border-border shadow-sm">
            <CardHeader className="p-4 border-b border-border">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Activity className="h-4 w-4 text-primary" />
                Quick Actions
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-2">
              <Button
                variant="outline"
                className="w-full justify-between h-9 text-xs font-medium"
                onClick={() => router.push("/inbox")}
              >
                <span className="flex items-center gap-2">
                  <Inbox className="h-4 w-4 text-primary" />
                  Jump to Inbox
                </span>
                <ArrowRight className="h-3 w-3 text-muted-foreground" />
              </Button>
              <Button
                variant="outline"
                className="w-full justify-between h-9 text-xs font-medium"
                onClick={() => router.push("/contacts")}
              >
                <span className="flex items-center gap-2">
                  <User className="h-4 w-4 text-emerald-500" />
                  Search Contacts
                </span>
                <ArrowRight className="h-3 w-3 text-muted-foreground" />
              </Button>
              <Button
                variant="outline"
                className="w-full justify-between h-9 text-xs font-medium"
                onClick={() => router.push("/templates")}
              >
                <span className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-indigo-500" />
                  View WhatsApp Templates
                </span>
                <ArrowRight className="h-3 w-3 text-muted-foreground" />
              </Button>
            </CardContent>
          </Card>

          {/* Recent Outbound Messages Processed */}
          <Card className="border-border shadow-sm">
            <CardHeader className="p-4 border-b border-border">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Send className="h-4 w-4 text-primary" />
                Recent Handled Messages
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Your latest sent messages across channels
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0 divide-y divide-border">
              {metricsLoading ? (
                <div className="p-6 text-center text-xs text-muted-foreground">
                  Loading activity...
                </div>
              ) : recentMessages.length === 0 ? (
                <div className="p-6 text-center text-xs text-muted-foreground">
                  No messages sent yet today.
                </div>
              ) : (
                recentMessages.slice(0, 5).map((msg) => (
                  <div
                    key={msg.id}
                    className="p-3 hover:bg-muted/40 transition-colors cursor-pointer"
                    onClick={() => router.push(`/inbox?c=${msg.conversation_id}`)}
                  >
                    <p className="text-xs text-foreground font-medium line-clamp-2">
                      {msg.content_text || `[${msg.content_type || "Message"}]`}
                    </p>
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground mt-1.5">
                      <span className="capitalize">{msg.channel || "WhatsApp"}</span>
                      <span>
                        {formatDistanceToNow(new Date(msg.created_at), { addSuffix: true })}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
