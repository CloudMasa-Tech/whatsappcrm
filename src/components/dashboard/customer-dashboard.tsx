"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Users,
  Radio,
  Send,
  CheckCircle2,
  Loader2,
  ArrowRight,
  AlertTriangle,
  QrCode,
  ShieldCheck,
  MessageSquare,
  Search,
  Phone,
  Mail,
  Building2,
  MessageCircle,
  Clock,
  Sparkles,
  ExternalLink,
  Tag as TagIcon,
  CheckCircle,
  Activity,
  UserCheck,
} from "lucide-react";
import { Instagram } from "@/components/icons/instagram";
import { MetricCard } from "@/components/dashboard/metric-card";
import { SkeletonCard } from "@/components/dashboard/skeleton";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getBroadcastStatus } from "@/lib/broadcast-status";
import { cn } from "@/lib/utils";
import type { Broadcast, Contact, Conversation, Message } from "@/types";

type SessionStatus =
  | "disconnected"
  | "qr_pending"
  | "connecting"
  | "connected"
  | "paired"
  | "ready"
  | "logged_out"
  | "banned"
  | "error"
  | null;

interface AssignedConversation extends Conversation {
  contact?: Contact;
}

export function CustomerDashboard() {
  const t = useTranslations("CustomerDashboard");
  const tStatus = useTranslations("Broadcasts.status");
  const router = useRouter();
  const { user, activeProjectId, activeProjectChannel } = useAuth();

  // Channel Connection States
  const [whatsappStatus, setWhatsappStatus] = useState<SessionStatus>(null);
  const [whatsappLoading, setWhatsappLoading] = useState(true);
  const [instagramConnected, setInstagramConnected] = useState(false);
  const [instagramLoading, setInstagramLoading] = useState(true);

  // Agent Performance & Processed Metrics
  const [contactsCount, setContactsCount] = useState(0);
  const [activeConversationsCount, setActiveConversationsCount] = useState(0);
  const [resolvedConversationsCount, setResolvedConversationsCount] = useState(0);
  const [messagesSentToday, setMessagesSentToday] = useState(0);
  const [totalMessagesProcessed, setTotalMessagesProcessed] = useState(0);
  const [metricsLoading, setMetricsLoading] = useState(true);

  // Assigned Contacts List
  const [assignedContacts, setAssignedContacts] = useState<Contact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(true);
  const [contactSearch, setContactSearch] = useState("");

  // Assigned Conversations List
  const [assignedConversations, setAssignedConversations] = useState<AssignedConversation[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(true);

  // Recent Broadcasts
  const [totalCampaigns, setTotalCampaigns] = useState(0);
  const [recentCampaigns, setRecentCampaigns] = useState<Broadcast[]>([]);
  const [campaignsLoading, setCampaignsLoading] = useState(true);

  // Agent's Recent Processed Messages
  const [recentMessages, setRecentMessages] = useState<Message[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);

  const loadAll = useCallback(async () => {
    if (!activeProjectId) {
      setWhatsappLoading(false);
      setInstagramLoading(false);
      setMetricsLoading(false);
      setContactsLoading(false);
      setConversationsLoading(false);
      setCampaignsLoading(false);
      setActivityLoading(false);
      return;
    }
    const db = createClient();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    // 1. WhatsApp status check
    setWhatsappLoading(true);
    try {
      if (activeProjectChannel === "qr") {
        const res = await fetch(
          `/api/whatsapp/qr?project_id=${encodeURIComponent(activeProjectId)}`,
          { cache: "no-store" },
        );
        if (res.ok) {
          const data = await res.json();
          setWhatsappStatus(data.session?.status ?? null);
        }
      } else {
        const res = await fetch("/api/whatsapp/config", { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          setWhatsappStatus(data.connected ? "connected" : "disconnected");
        }
      }
    } catch {
      setWhatsappStatus("disconnected");
    } finally {
      setWhatsappLoading(false);
    }

    // 2. Instagram status check
    setInstagramLoading(true);
    try {
      const res = await fetch("/api/instagram/config", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setInstagramConnected(Boolean(data.connected));
      }
    } catch {
      setInstagramConnected(false);
    } finally {
      setInstagramLoading(false);
    }

    // 3. Assigned Contacts
    setContactsLoading(true);
    try {
      const { data: contacts, count } = await db
        .from("contacts")
        .select("id, name, phone, email, company, channel, created_at, updated_at", { count: "exact" })
        .order("created_at", { ascending: false })
        .limit(50);

      setAssignedContacts((contacts as Contact[]) ?? []);
      setContactsCount(count ?? (contacts?.length ?? 0));
    } catch (err) {
      console.error("[customer-dashboard] contacts error:", err);
    } finally {
      setContactsLoading(false);
    }

    // 4. Assigned Conversations
    setConversationsLoading(true);
    try {
      const { data: convs } = await db
        .from("conversations")
        .select("id, contact_id, status, channel, unread_count, last_message_text, last_message_at, updated_at, contact:contacts(id, name, phone, email, channel)")
        .order("updated_at", { ascending: false })
        .limit(25);

      const formatted = (convs ?? []).map((c: any) => ({
        ...c,
        contact: Array.isArray(c.contact) ? c.contact[0] : c.contact,
      }));

      setAssignedConversations(formatted);
      setActiveConversationsCount(formatted.filter((c) => c.status === "open" || c.status === "pending").length);
      setResolvedConversationsCount(formatted.filter((c) => c.status === "closed").length);
    } catch (err) {
      console.error("[customer-dashboard] conversations error:", err);
    } finally {
      setConversationsLoading(false);
    }

    // 5. Agent Processed Messages & Metrics
    setMetricsLoading(true);
    setActivityLoading(true);
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

      setMessagesSentToday(todayRes.count ?? 0);
      setTotalMessagesProcessed(totalRes.count ?? 0);
      setRecentMessages((recentMsgRes.data as Message[]) ?? []);
    } catch (err) {
      console.error("[customer-dashboard] messages error:", err);
    } finally {
      setMetricsLoading(false);
      setActivityLoading(false);
    }

    // 6. Broadcasts & Campaigns
    setCampaignsLoading(true);
    try {
      const { data: broadcasts } = await db
        .from("broadcasts")
        .select("id, name, status, total_recipients, delivered_count, sent_count, failed_count, created_at")
        .order("created_at", { ascending: false })
        .limit(5);

      if (broadcasts) {
        setTotalCampaigns(broadcasts.length);
        setRecentCampaigns(broadcasts as Broadcast[]);
      }
    } catch (err) {
      console.error("[customer-dashboard] broadcasts error:", err);
    } finally {
      setCampaignsLoading(false);
    }
  }, [activeProjectId, activeProjectChannel]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // Filtered assigned contacts
  const filteredContacts = useMemo(() => {
    if (!contactSearch.trim()) return assignedContacts;
    const query = contactSearch.toLowerCase().trim();
    return assignedContacts.filter(
      (c) =>
        c.name?.toLowerCase().includes(query) ||
        c.phone?.toLowerCase().includes(query) ||
        c.email?.toLowerCase().includes(query) ||
        c.company?.toLowerCase().includes(query)
    );
  }, [assignedContacts, contactSearch]);

  const isWhatsAppConnected =
    whatsappStatus === "connected" ||
    whatsappStatus === "paired" ||
    whatsappStatus === "ready";

  if (!activeProjectId) {
    return (
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="flex items-center gap-3 p-4">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            <div>
              <p className="text-sm font-medium text-foreground">{t("noProjectAssigned")}</p>
              <p className="text-xs text-muted-foreground">{t("noProjectAssignedHint")}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header & Agent Profile Banner */}
      <div className="flex flex-col gap-3 rounded-2xl border border-border/80 bg-gradient-to-r from-card via-card to-primary/5 p-5 sm:p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-6 items-center gap-1.5 rounded-full bg-primary/10 px-3 text-xs font-semibold text-primary border border-primary/20">
                <ShieldCheck className="h-3.5 w-3.5" />
                Workspace Administration
              </span>
              <span className="text-xs text-muted-foreground">•</span>
              <span className="text-xs font-medium text-foreground">
                Project Operations
              </span>
            </div>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-foreground">
              Welcome back{user?.user_metadata?.full_name ? `, ${user.user_metadata.full_name}` : ""}!
            </h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              High-level overview of project channels, audience contacts, active conversations, and team activity.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => router.push("/inbox")}
              className="gap-1.5 text-xs font-medium shadow-sm"
            >
              <MessageCircle className="h-4 w-4" />
              Open Inbox
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push("/contacts")}
              className="gap-1.5 text-xs font-medium"
            >
              <Users className="h-4 w-4" />
              All Contacts
            </Button>
          </div>
        </div>

        {/* Live Channel Connection Health Badges */}
        <div className="flex flex-wrap items-center gap-2.5 pt-2 border-t border-border/60">
          <span className="text-xs font-medium text-muted-foreground">Channel Status:</span>

          {/* WhatsApp status */}
          <div className="inline-flex items-center gap-1.5 rounded-full bg-background px-2.5 py-1 text-xs border border-border">
            <QrCode className="h-3.5 w-3.5 text-emerald-500" />
            <span className="font-medium text-foreground">WhatsApp</span>
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                isWhatsAppConnected ? "bg-emerald-500 animate-pulse" : "bg-amber-500"
              )}
            />
            <span className="text-[11px] text-muted-foreground">
              {whatsappLoading ? "Checking..." : isWhatsAppConnected ? "Connected" : "Disconnected"}
            </span>
          </div>

          {/* Instagram status */}
          <div className="inline-flex items-center gap-1.5 rounded-full bg-background px-2.5 py-1 text-xs border border-border">
            <Instagram className="h-3.5 w-3.5 text-pink-500" />
            <span className="font-medium text-foreground">Instagram</span>
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                instagramConnected ? "bg-pink-500 animate-pulse" : "bg-muted-foreground"
              )}
            />
            <span className="text-[11px] text-muted-foreground">
              {instagramLoading ? "Checking..." : instagramConnected ? "Active" : "Inactive"}
            </span>
          </div>
        </div>
      </div>

      {/* Admin Performance Metric Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {contactsLoading ? (
          <SkeletonCard />
        ) : (
          <MetricCard
            title="Total Contacts"
            value={contactsCount.toLocaleString()}
            icon={Users}
          />
        )}
        {conversationsLoading ? (
          <SkeletonCard />
        ) : (
          <MetricCard
            title="Active Conversations"
            value={activeConversationsCount.toLocaleString()}
            icon={MessageSquare}
          />
        )}
        {metricsLoading ? (
          <SkeletonCard />
        ) : (
          <MetricCard
            title="Messages Sent Today"
            value={messagesSentToday.toLocaleString()}
            icon={Send}
          />
        )}
        {metricsLoading ? (
          <SkeletonCard />
        ) : (
          <MetricCard
            title="Resolved Conversations"
            value={resolvedConversationsCount.toLocaleString()}
            icon={CheckCircle2}
          />
        )}
      </div>

      {/* Tabbed Agent Workspace: Assigned Contacts, Active Chats, Campaigns, and Activity */}
      <Tabs defaultValue="contacts" className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-3">
          <div className="w-full sm:w-auto overflow-x-auto no-scrollbar">
            <TabsList className="h-9 inline-flex w-max">
              <TabsTrigger value="contacts" className="gap-1.5 text-xs">
                <Users className="h-3.5 w-3.5" />
                Assigned Contacts ({contactsCount})
              </TabsTrigger>
              <TabsTrigger value="conversations" className="gap-1.5 text-xs">
                <MessageSquare className="h-3.5 w-3.5" />
                Active Chats ({activeConversationsCount})
              </TabsTrigger>
              <TabsTrigger value="campaigns" className="gap-1.5 text-xs">
                <Radio className="h-3.5 w-3.5" />
                Campaigns ({totalCampaigns})
              </TabsTrigger>
              <TabsTrigger value="activity" className="gap-1.5 text-xs">
                <Activity className="h-3.5 w-3.5" />
                Processed Activity
              </TabsTrigger>
            </TabsList>
          </div>

          <span className="text-xs text-muted-foreground shrink-0">
            Total Processed: <strong>{totalMessagesProcessed.toLocaleString()}</strong> messages
          </span>
        </div>

        {/* Tab 1: Assigned Contacts & Leads */}
        <TabsContent value="contacts" className="space-y-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="relative w-full sm:w-80">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search assigned contacts by name, phone, email..."
                value={contactSearch}
                onChange={(e) => setContactSearch(e.target.value)}
                className="pl-9 h-9 text-xs"
              />
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => router.push("/contacts")}
              className="text-xs self-start sm:self-auto gap-1"
            >
              Manage in Contacts Table
              <ArrowRight className="h-3 w-3" />
            </Button>
          </div>

          <Card>
            <CardContent className="p-0">
              {contactsLoading ? (
                <div className="flex h-48 items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : filteredContacts.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center px-4">
                  <Users className="h-10 w-10 text-muted-foreground/40 mb-2" />
                  <p className="text-sm font-semibold text-foreground">
                    {contactSearch ? "No matching contacts found" : "No contacts assigned yet"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                    {contactSearch
                      ? "Try searching with a different name, phone number, or company."
                      : "Contacts assigned to you or created in this project will appear here for quick messaging."}
                  </p>
                  <Button
                    size="sm"
                    onClick={() => router.push("/contacts")}
                    className="mt-4 gap-1.5 text-xs"
                  >
                    + Add or Import Contacts
                  </Button>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {filteredContacts.map((contact) => (
                    <div
                      key={contact.id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 hover:bg-muted/30 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-sm">
                          {(contact.name || contact.phone || "U").charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-sm text-foreground truncate">
                              {contact.name || "Unnamed Contact"}
                            </span>
                            {contact.channel === "instagram" ? (
                              <Badge variant="outline" className="text-[10px] gap-1 text-pink-500 border-pink-500/20 bg-pink-500/5">
                                <Instagram className="h-3 w-3" />
                                Instagram
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px] gap-1 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 bg-emerald-500/5">
                                <QrCode className="h-3 w-3" />
                                WhatsApp
                              </Badge>
                            )}
                            {contact.company && (
                              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                                <Building2 className="h-3 w-3" />
                                {contact.company}
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-3 mt-1 text-xs text-muted-foreground">
                            {contact.phone && (
                              <span className="flex items-center gap-1 font-mono">
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

                      <div className="flex items-center gap-2 self-end sm:self-auto">
                        <Button
                          size="sm"
                          onClick={() => router.push(`/inbox?contactId=${contact.id}`)}
                          className="h-8 gap-1.5 text-xs font-medium"
                        >
                          <MessageCircle className="h-3.5 w-3.5" />
                          Chat Now
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 2: Active Conversations Queue */}
        <TabsContent value="conversations" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between py-4">
              <div>
                <CardTitle className="text-base font-semibold text-foreground">
                  Active Conversation Queue
                </CardTitle>
                <CardDescription className="text-xs">
                  Threads and conversations assigned to your active queue.
                </CardDescription>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => router.push("/inbox")}
                className="text-xs text-muted-foreground hover:text-foreground gap-1"
              >
                Go to Inbox
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {conversationsLoading ? (
                <div className="flex h-48 items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : assignedConversations.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center px-4">
                  <MessageSquare className="h-10 w-10 text-muted-foreground/40 mb-2" />
                  <p className="text-sm font-semibold text-foreground">No active conversations</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    When customers reach out via WhatsApp or Instagram, your queue will populate here.
                  </p>
                  <Button
                    size="sm"
                    onClick={() => router.push("/inbox")}
                    className="mt-4 gap-1.5 text-xs"
                  >
                    Open Live Inbox
                  </Button>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {assignedConversations.map((conv) => (
                    <div
                      key={conv.id}
                      onClick={() => router.push(`/inbox?conversationId=${conv.id}`)}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 hover:bg-muted/30 cursor-pointer transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-semibold text-sm">
                          {(conv.contact?.name || conv.contact?.phone || "C").charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm text-foreground truncate">
                              {conv.contact?.name || conv.contact?.phone || "Customer"}
                            </span>
                            <Badge
                              className={cn(
                                "text-[9px] px-1.5 py-0 capitalize",
                                conv.status === "open"
                                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                                  : conv.status === "pending"
                                  ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20"
                                  : "bg-muted text-muted-foreground"
                              )}
                            >
                              {conv.status}
                            </Badge>
                            {conv.unread_count > 0 && (
                              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                                {conv.unread_count}
                              </span>
                            )}
                          </div>
                          <p className="truncate text-xs text-muted-foreground mt-0.5">
                            {conv.last_message_text || "No messages yet in this conversation"}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 self-end sm:self-auto text-xs text-muted-foreground">
                        {conv.last_message_at && (
                          <span className="flex items-center gap-1 text-[11px]">
                            <Clock className="h-3 w-3" />
                            {new Date(conv.last_message_at).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        )}
                        <Button size="sm" variant="ghost" className="h-7 text-xs px-2">
                          Reply <ArrowRight className="ml-1 h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 3: Configured Campaigns & Broadcasts */}
        <TabsContent value="campaigns" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between py-4">
              <div>
                <CardTitle className="text-base font-semibold text-foreground">
                  Processed Broadcasts & Campaigns
                </CardTitle>
                <CardDescription className="text-xs">
                  Marketing and notification campaigns created in your project.
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push("/broadcasts")}
                className="text-xs gap-1"
              >
                Create Broadcast
                <ArrowRight className="h-3 w-3" />
              </Button>
            </CardHeader>
            <CardContent>
              {campaignsLoading ? (
                <div className="flex h-32 items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : recentCampaigns.length === 0 ? (
                <div className="flex h-32 flex-col items-center justify-center gap-2">
                  <Radio className="h-8 w-8 text-muted-foreground/50" />
                  <p className="text-sm text-muted-foreground">{t("noCampaignsYet")}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {recentCampaigns.map((bc) => {
                    const status = getBroadcastStatus(bc.status);
                    return (
                      <div
                        key={bc.id}
                        className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-border p-3.5 hover:bg-muted/50 cursor-pointer transition-colors"
                        onClick={() => router.push(`/broadcasts/${bc.id}`)}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-foreground">{bc.name}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {bc.total_recipients} {t("recipients")} · Delivered: {bc.delivered_count ?? 0} ·{" "}
                            {new Date(bc.created_at).toLocaleDateString()}
                          </p>
                        </div>
                        <span
                          className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-xs font-medium ${status.classes}`}
                        >
                          {tStatus(status.label)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 4: Processed Activity & Audit Log */}
        <TabsContent value="activity" className="space-y-4">
          <Card>
            <CardHeader className="py-4">
              <CardTitle className="text-base font-semibold text-foreground">
                Agent Activity & Processed Messages
              </CardTitle>
              <CardDescription className="text-xs">
                Log of messages and actions processed through your account.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {activityLoading ? (
                <div className="flex h-32 items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : recentMessages.length === 0 ? (
                <div className="flex h-32 flex-col items-center justify-center gap-2">
                  <Activity className="h-8 w-8 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">No recent messages logged.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {recentMessages.map((msg) => (
                    <div
                      key={msg.id}
                      className="flex items-start gap-3 rounded-lg border border-border/70 p-3 bg-card"
                    >
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary mt-0.5">
                        <Send className="h-3.5 w-3.5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium text-foreground">
                            Outbound Message ({msg.channel === "instagram" ? "Instagram" : "WhatsApp"})
                          </span>
                          <span className="text-[10px] text-muted-foreground font-mono">
                            {new Date(msg.created_at).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                          {msg.content_text || `[${msg.content_type} payload]`}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
