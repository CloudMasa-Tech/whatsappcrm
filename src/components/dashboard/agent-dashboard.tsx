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
  Users,
  Phone,
  Mail,
  Building2,
  Calendar,
  Activity,
  History,
  CheckCircle,
  ExternalLink,
  ChevronRight,
  TrendingUp,
  Tag as TagIcon,
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

interface ProcessItem {
  id: string;
  type: "message_sent" | "conversation_resolved" | "contact_assigned";
  title: string;
  description: string;
  timestamp: string;
  channel?: string;
  conversationId?: string;
  contactName?: string;
}

export function AgentDashboard() {
  const router = useRouter();
  const { user, profile, activeProjectId, activeProjectName } = useAuth();

  // Assigned Conversations
  const [activeConversations, setActiveConversations] = useState<AssignedConversation[]>([]);
  const [resolvedConversations, setResolvedConversations] = useState<AssignedConversation[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(true);

  // Assigned Contacts (Distinct)
  const [assignedContacts, setAssignedContacts] = useState<Contact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(true);

  // Performance & Output Metrics
  const [myMessagesToday, setMyMessagesToday] = useState(0);
  const [myTotalMessages, setMyTotalMessages] = useState(0);
  const [recentMessages, setRecentMessages] = useState<Message[]>([]);
  const [resolvedTodayCount, setResolvedTodayCount] = useState(0);
  const [metricsLoading, setMetricsLoading] = useState(true);

  // Search filter
  const [search, setSearch] = useState("");
  const [contactSearch, setContactSearch] = useState("");

  const agentName = profile?.full_name || user?.email?.split("@")[0] || "Agent";

  const loadAgentData = useCallback(async () => {
    if (!user || !activeProjectId) {
      setConversationsLoading(false);
      setContactsLoading(false);
      setMetricsLoading(false);
      return;
    }

    const db = createClient();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    // 1. Fetch Conversations strictly assigned to this agent
    setConversationsLoading(true);
    setContactsLoading(true);
    try {
      const { data: convs, error: convErr } = await db
        .from("conversations")
        .select(
          "id, contact_id, status, channel, unread_count, last_message_text, last_message_at, updated_at, created_at, assigned_agent_id, contact:contacts(id, name, phone, email, company, channel, avatar_url, created_at)"
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

        const active = formatted.filter((c) => c.status === "open" || c.status === "pending");
        const resolved = formatted.filter((c) => c.status === "closed");

        setActiveConversations(active);
        setResolvedConversations(resolved);

        // Count resolved today
        const resolvedToday = resolved.filter((c) => {
          if (!c.updated_at) return false;
          return new Date(c.updated_at) >= todayStart;
        }).length;
        setResolvedTodayCount(resolvedToday);

        // Extract distinct assigned contacts
        const contactMap = new Map<string, Contact>();
        formatted.forEach((c) => {
          if (c.contact && c.contact.id) {
            contactMap.set(c.contact.id, c.contact);
          }
        });
        setAssignedContacts(Array.from(contactMap.values()));
      }
    } catch (err) {
      console.error("[AgentDashboard] conv error:", err);
    } finally {
      setConversationsLoading(false);
      setContactsLoading(false);
    }

    // 2. Fetch Agent's Personal Messages and Handled Processes
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
          .limit(20),
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

  // Unread conversations waiting for this agent
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

  // Filtered contacts
  const filteredContacts = useMemo(() => {
    if (!contactSearch.trim()) return assignedContacts;
    const q = contactSearch.toLowerCase();
    return assignedContacts.filter((c) => {
      const name = c.name?.toLowerCase() ?? "";
      const phone = c.phone?.toLowerCase() ?? "";
      const email = c.email?.toLowerCase() ?? "";
      const company = c.company?.toLowerCase() ?? "";
      return name.includes(q) || phone.includes(q) || email.includes(q) || company.includes(q);
    });
  }, [assignedContacts, contactSearch]);

  // Filtered resolved conversations
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

  // Channel Breakdown
  const channelBreakdown = useMemo(() => {
    const counts: Record<string, number> = { whatsapp: 0, instagram: 0, facebook: 0, email: 0 };
    activeConversations.forEach((c) => {
      const ch = c.channel || "whatsapp";
      counts[ch] = (counts[ch] || 0) + 1;
    });
    return counts;
  }, [activeConversations]);

  // Generate Process Timeline Items ("What processes have been done")
  const processTimeline = useMemo<ProcessItem[]>(() => {
    const items: ProcessItem[] = [];

    // Add recent messages sent
    recentMessages.forEach((msg) => {
      items.push({
        id: `msg-${msg.id}`,
        type: "message_sent",
        title: "Sent message reply",
        description: msg.content_text || `[${msg.content_type || "Media"} attachment]`,
        timestamp: msg.created_at,
        channel: msg.channel,
        conversationId: msg.conversation_id,
      });
    });

    // Add resolved conversations
    resolvedConversations.slice(0, 10).forEach((conv) => {
      if (conv.updated_at) {
        items.push({
          id: `res-${conv.id}`,
          type: "conversation_resolved",
          title: "Resolved customer inquiry",
          description: `Closed chat with ${conv.contact?.name || conv.contact?.phone || "Customer"}`,
          timestamp: conv.updated_at,
          channel: conv.channel,
          conversationId: conv.id,
          contactName: conv.contact?.name,
        });
      }
    });

    // Sort descending by timestamp
    return items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [recentMessages, resolvedConversations]);

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
            Your live operational workstation — review assigned contacts, pending replies, and completed processes.
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

      {/* Dynamic Metrics Row */}
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
              title="Assigned Contacts"
              value={assignedContacts.length.toLocaleString()}
              icon={Users}
              subtitle="Distinct customers assigned to you"
            />
            <MetricCard
              title="Active Conversations"
              value={activeConversations.length.toLocaleString()}
              icon={MessageSquare}
              subtitle={unreadCount > 0 ? `${unreadCount} awaiting reply` : "All open chats"}
            />
            <MetricCard
              title="Messages Sent Today"
              value={myMessagesToday.toLocaleString()}
              icon={Send}
              subtitle={`${myTotalMessages} total messages handled`}
            />
            <MetricCard
              title="Resolved Inquiries"
              value={resolvedConversations.length.toLocaleString()}
              icon={CheckCircle2}
              subtitle={`${resolvedTodayCount} resolved today`}
            />
          </>
        )}
      </div>

      {/* Operational Breakdown Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 rounded-xl border border-border bg-card/60">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
            <MessageCircle className="h-4 w-4" />
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground font-medium">WhatsApp</p>
            <p className="text-sm font-bold text-foreground">{channelBreakdown.whatsapp} active</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-pink-500/10 text-pink-600 flex items-center justify-center">
            <Instagram className="h-4 w-4" />
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground font-medium">Instagram</p>
            <p className="text-sm font-bold text-foreground">{channelBreakdown.instagram} active</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-blue-500/10 text-blue-600 flex items-center justify-center">
            <Facebook className="h-4 w-4" />
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground font-medium">Facebook</p>
            <p className="text-sm font-bold text-foreground">{channelBreakdown.facebook} active</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-amber-500/10 text-amber-600 flex items-center justify-center">
            <TrendingUp className="h-4 w-4" />
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground font-medium">Completion Rate</p>
            <p className="text-sm font-bold text-foreground">
              {assignedContacts.length > 0
                ? `${Math.round((resolvedConversations.length / (activeConversations.length + resolvedConversations.length || 1)) * 100)}%`
                : "100%"}
            </p>
          </div>
        </div>
      </div>

      {/* Main Tabs Workspace */}
      <Tabs defaultValue="conversations" className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-3">
          <TabsList className="h-9 bg-muted/60">
            <TabsTrigger value="conversations" className="text-xs gap-1.5 h-7">
              <MessageSquare className="h-3.5 w-3.5 text-primary" />
              Active Queue ({activeConversations.length})
            </TabsTrigger>
            <TabsTrigger value="contacts" className="text-xs gap-1.5 h-7">
              <Users className="h-3.5 w-3.5 text-emerald-500" />
              Assigned Contacts ({assignedContacts.length})
            </TabsTrigger>
            <TabsTrigger value="process" className="text-xs gap-1.5 h-7">
              <History className="h-3.5 w-3.5 text-indigo-500" />
              Processes & Actions ({processTimeline.length})
            </TabsTrigger>
            <TabsTrigger value="resolved" className="text-xs gap-1.5 h-7">
              <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground" />
              Resolved History ({resolvedConversations.length})
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Tab 1: Active Conversations Queue */}
        <TabsContent value="conversations" className="space-y-4">
          <Card className="border-border shadow-sm">
            <CardHeader className="p-4 sm:p-5 border-b border-border">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <Inbox className="h-5 w-5 text-primary" />
                    My Active Conversation Queue
                  </CardTitle>
                  <CardDescription className="text-xs text-muted-foreground mt-0.5">
                    Live chats assigned to you awaiting reply or follow-up
                  </CardDescription>
                </div>
                <div className="w-full sm:w-64">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      placeholder="Search active chats..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="h-8 pl-8 text-xs bg-muted/50 border-border"
                    />
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0 divide-y divide-border">
              {conversationsLoading ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  Loading your assigned queue...
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
                      : "No active conversations are currently assigned to you. When administrators assign incoming leads, they will appear here in real time."}
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
                            {contact?.company && (
                              <span className="text-xs text-muted-foreground hidden sm:inline">
                                ({contact.company})
                              </span>
                            )}
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
                          className="h-7 px-2.5 text-xs text-primary hover:text-primary hover:bg-primary/10 font-medium"
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
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 2: Assigned Contacts Directory */}
        <TabsContent value="contacts" className="space-y-4">
          <Card className="border-border shadow-sm">
            <CardHeader className="p-4 sm:p-5 border-b border-border">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <Users className="h-5 w-5 text-emerald-500" />
                    My Assigned Contacts Directory
                  </CardTitle>
                  <CardDescription className="text-xs text-muted-foreground mt-0.5">
                    Customers and leads currently in your portfolio ({assignedContacts.length} total)
                  </CardDescription>
                </div>
                <div className="w-full sm:w-64">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      placeholder="Search by name, phone, company..."
                      value={contactSearch}
                      onChange={(e) => setContactSearch(e.target.value)}
                      className="h-8 pl-8 text-xs bg-muted/50 border-border"
                    />
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0 divide-y divide-border">
              {contactsLoading ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  Loading assigned contacts...
                </div>
              ) : filteredContacts.length === 0 ? (
                <div className="p-12 text-center text-xs text-muted-foreground">
                  {contactSearch ? "No matching contacts found." : "No contacts currently assigned to your account."}
                </div>
              ) : (
                filteredContacts.map((contact) => (
                  <div
                    key={contact.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 sm:p-4 hover:bg-muted/40 transition-colors gap-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-9 w-9 shrink-0 rounded-full bg-emerald-500/10 text-emerald-600 flex items-center justify-center text-xs font-bold border border-emerald-500/20">
                        {(contact.name || contact.phone || "U").slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-foreground truncate">
                            {contact.name || "Unnamed Contact"}
                          </span>
                          {contact.company && (
                            <Badge variant="outline" className="text-[10px] py-0 px-1.5">
                              {contact.company}
                            </Badge>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground mt-0.5">
                          {contact.phone && (
                            <span className="flex items-center gap-1">
                              <Phone className="h-3 w-3" />
                              {contact.phone}
                            </span>
                          )}
                          {contact.email && (
                            <span className="flex items-center gap-1">
                              <Mail className="h-3 w-3" />
                              {contact.email}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs gap-1"
                        onClick={() => router.push(`/inbox?contact=${contact.id}`)}
                      >
                        <MessageSquare className="h-3 w-3 text-primary" />
                        Chat
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={() => router.push(`/contacts`)}
                      >
                        View Details
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 3: What processes have been done (Process Audit & Timeline) */}
        <TabsContent value="process" className="space-y-4">
          <Card className="border-border shadow-sm">
            <CardHeader className="p-4 sm:p-5 border-b border-border">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <History className="h-5 w-5 text-indigo-500" />
                    Completed Processes & Output Log
                  </CardTitle>
                  <CardDescription className="text-xs text-muted-foreground mt-0.5">
                    Chronological audit log of all customer replies, resolved chats, and handled actions
                  </CardDescription>
                </div>
                <Badge variant="outline" className="text-xs font-medium">
                  {processTimeline.length} events logged
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-4 sm:p-6">
              {metricsLoading ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  Loading process timeline...
                </div>
              ) : processTimeline.length === 0 ? (
                <div className="p-12 text-center text-xs text-muted-foreground">
                  No processes completed yet today.
                </div>
              ) : (
                <div className="relative pl-6 space-y-6 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-border">
                  {processTimeline.map((item) => {
                    const isMessage = item.type === "message_sent";
                    const isResolved = item.type === "conversation_resolved";

                    return (
                      <div key={item.id} className="relative group">
                        <div
                          className={cn(
                            "absolute -left-[27px] top-1 h-3.5 w-3.5 rounded-full ring-4 ring-background",
                            isMessage ? "bg-primary" : isResolved ? "bg-emerald-500" : "bg-indigo-500"
                          )}
                        />
                        <div className="p-3.5 rounded-lg border border-border bg-card hover:bg-muted/30 transition-colors">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-foreground">
                                {item.title}
                              </span>
                              {item.channel && (
                                <Badge variant="secondary" className="text-[10px] py-0 px-1.5 capitalize">
                                  {item.channel}
                                </Badge>
                              )}
                            </div>
                            <span className="text-[11px] text-muted-foreground">
                              {formatDistanceToNow(new Date(item.timestamp), { addSuffix: true })}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                            {item.description}
                          </p>
                          {item.conversationId && (
                            <Button
                              variant="link"
                              className="p-0 h-auto text-[11px] text-primary mt-2 font-medium"
                              onClick={() => router.push(`/inbox?c=${item.conversationId}`)}
                            >
                              Open Conversation <ChevronRight className="h-3 w-3 ml-0.5" />
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 4: Resolved History */}
        <TabsContent value="resolved" className="space-y-4">
          <Card className="border-border shadow-sm">
            <CardHeader className="p-4 sm:p-5 border-b border-border">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-muted-foreground" />
                Resolved Conversation Archive
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Inquiries that have been closed and marked completed by you
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0 divide-y divide-border">
              {filteredResolved.length === 0 ? (
                <div className="p-12 text-center text-xs text-muted-foreground">
                  No resolved conversations recorded.
                </div>
              ) : (
                filteredResolved.map((conv) => {
                  const contact = conv.contact;
                  const displayName = contact?.name || contact?.phone || "Customer";
                  return (
                    <div
                      key={conv.id}
                      className="flex items-center justify-between p-3.5 sm:p-4 hover:bg-muted/40 transition-colors cursor-pointer"
                      onClick={() => router.push(`/inbox?c=${conv.id}`)}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="h-9 w-9 shrink-0 rounded-full bg-muted flex items-center justify-center text-xs font-semibold text-foreground border border-border">
                          {displayName.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <span className="text-sm font-medium text-foreground truncate block">
                            {displayName}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            Resolved on {conv.updated_at ? format(new Date(conv.updated_at), "MMM d, yyyy") : "Recently"}
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
                        Review
                      </Button>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
