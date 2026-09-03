"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useRouter } from "next/navigation";
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
  TrendingUp,
  DollarSign,
  Workflow,
  PlusCircle,
  UserPlus,
  RefreshCw,
  MoreVertical,
  Inbox,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { fetchAccountMembers } from "@/lib/account/members";
import { formatDistanceToNow, format } from "date-fns";
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

interface ExtendedConversation extends Conversation {
  contact?: Contact;
  assigned_agent?: {
    id: string;
    full_name?: string;
    email?: string;
  };
}

interface ProjectMemberItem {
  id: string;
  user_id: string;
  role: string;
  full_name: string;
  email: string;
  active_chats: number;
  resolved_chats: number;
}

export function CustomerDashboard() {
  const router = useRouter();
  const { user, profile, activeProjectId, activeProjectName, activeProjectChannel, accountRole } = useAuth();

  // Channel Connection States
  const [whatsappStatus, setWhatsappStatus] = useState<SessionStatus>(null);
  const [whatsappPhone, setWhatsappPhone] = useState<string | null>(null);
  const [whatsappLoading, setWhatsappLoading] = useState(true);
  const [instagramConnected, setInstagramConnected] = useState(false);
  const [instagramUsername, setInstagramUsername] = useState<string | null>(null);
  const [instagramLoading, setInstagramLoading] = useState(true);
  const [facebookConnected, setFacebookConnected] = useState(false);
  const [facebookPageName, setFacebookPageName] = useState<string | null>(null);
  const [facebookLoading, setFacebookLoading] = useState(true);

  // Project-Wide KPIs
  const [totalContacts, setTotalContacts] = useState(0);
  const [contactsToday, setContactsToday] = useState(0);
  const [activeConversationsCount, setActiveConversationsCount] = useState(0);
  const [unassignedCount, setUnassignedCount] = useState(0);
  const [resolvedCount, setResolvedCount] = useState(0);
  const [messagesSentToday, setMessagesSentToday] = useState(0);
  const [totalMessagesProcessed, setTotalMessagesProcessed] = useState(0);
  const [dealsCount, setDealsCount] = useState(0);
  const [dealsValue, setDealsValue] = useState(0);
  const [activeFlowsCount, setActiveFlowsCount] = useState(0);
  const [metricsLoading, setMetricsLoading] = useState(true);

  // Lists
  const [unassignedConversations, setUnassignedConversations] = useState<ExtendedConversation[]>([]);
  const [allConversations, setAllConversations] = useState<ExtendedConversation[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(true);

  const [projectMembers, setProjectMembers] = useState<ProjectMemberItem[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);

  const [recentBroadcasts, setRecentBroadcasts] = useState<Broadcast[]>([]);
  const [broadcastsLoading, setBroadcastsLoading] = useState(true);

  const [recentContacts, setRecentContacts] = useState<Contact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(true);

  const [recentMessages, setRecentMessages] = useState<Message[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);

  // Assigning state
  const [assigningId, setAssigningId] = useState<string | null>(null);

  // Active command tab
  const [dashboardTab, setDashboardTab] = useState<string>("unassigned");

  const adminName = profile?.full_name || user?.email?.split("@")[0] || "Admin";

  const loadAll = useCallback(async () => {
    if (!activeProjectId) {
      setWhatsappLoading(false);
      setInstagramLoading(false);
      setFacebookLoading(false);
      setMetricsLoading(false);
      setConversationsLoading(false);
      setMembersLoading(false);
      setBroadcastsLoading(false);
      setContactsLoading(false);
      setActivityLoading(false);
      return;
    }

    const db = createClient();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    // 1. Channel Connections Check
    setWhatsappLoading(true);
    try {
      if (activeProjectChannel === "qr") {
        const res = await fetch(
          `/api/whatsapp/qr?project_id=${encodeURIComponent(activeProjectId)}`,
          { cache: "no-store" }
        );
        if (res.ok) {
          const data = await res.json();
          setWhatsappStatus(data.session?.status ?? null);
          setWhatsappPhone(data.session?.phone ?? null);
        }
      } else {
        const res = await fetch("/api/whatsapp/config", { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          setWhatsappStatus(data.connected ? "connected" : "disconnected");
          setWhatsappPhone(data.display_phone_number ?? null);
        }
      }
    } catch {
      setWhatsappStatus("disconnected");
    } finally {
      setWhatsappLoading(false);
    }

    setInstagramLoading(true);
    try {
      const res = await fetch("/api/instagram/config", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setInstagramConnected(Boolean(data.connected));
        setInstagramUsername(data.username ?? null);
      }
    } catch {
      setInstagramConnected(false);
    } finally {
      setInstagramLoading(false);
    }

    setFacebookLoading(true);
    try {
      const res = await fetch("/api/facebook/config", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setFacebookConnected(Boolean(data.connected));
        setFacebookPageName(data.page_name ?? null);
      }
    } catch {
      setFacebookConnected(false);
    } finally {
      setFacebookLoading(false);
    }

    // 2. Project Contacts
    setContactsLoading(true);
    try {
      const [{ count: totalC }, { count: todayC }, { data: contactList }] = await Promise.all([
        db.from("contacts").select("id", { count: "exact", head: true }).eq("project_id", activeProjectId),
        db.from("contacts").select("id", { count: "exact", head: true }).eq("project_id", activeProjectId).gte("created_at", todayStart.toISOString()),
        db.from("contacts").select("id, name, phone, email, company, channel, created_at").eq("project_id", activeProjectId).order("created_at", { ascending: false }).limit(8),
      ]);

      setTotalContacts(totalC ?? 0);
      setContactsToday(todayC ?? 0);
      setRecentContacts((contactList as Contact[]) ?? []);
    } catch (err) {
      console.error("[customer-dashboard] contacts error:", err);
    } finally {
      setContactsLoading(false);
    }

    // 3. Project Conversations & Unassigned Queue
    setConversationsLoading(true);
    let loadedConvs: any[] = [];
    try {
      const { data: convs } = await db
        .from("conversations")
        .select(
          "id, contact_id, status, channel, unread_count, last_message_text, last_message_at, updated_at, created_at, assigned_agent_id, contact:contacts(id, name, phone, email, channel, avatar_url)"
        )
        .eq("project_id", activeProjectId)
        .order("updated_at", { ascending: false })
        .limit(100);

      loadedConvs = convs ?? [];
      const formatted: ExtendedConversation[] = loadedConvs.map((c: any) => ({
        ...c,
        contact: Array.isArray(c.contact) ? c.contact[0] : c.contact,
      }));

      setAllConversations(formatted);
      const active = formatted.filter((c) => c.status === "open" || c.status === "pending");
      const unassigned = active.filter((c) => !c.assigned_agent_id);
      const resolved = formatted.filter((c) => c.status === "closed");

      setActiveConversationsCount(active.length);
      setUnassignedCount(unassigned.length);
      setUnassignedConversations(unassigned);
      setResolvedCount(resolved.length);
    } catch (err) {
      console.error("[customer-dashboard] conversations error:", err);
    } finally {
      setConversationsLoading(false);
    }

    // 4. Team Members & Workload
    setMembersLoading(true);
    try {
      const [members, { data: assignedConvs }] = await Promise.all([
        fetchAccountMembers(activeProjectId),
        db
          .from("conversations")
          .select("assigned_agent_id, status")
          .eq("project_id", activeProjectId)
          .not("assigned_agent_id", "is", null),
      ]);

      const activeMap = new Map<string, number>();
      const resolvedMap = new Map<string, number>();
      (assignedConvs ?? []).forEach((c: any) => {
        if (!c.assigned_agent_id) return;
        if (c.status === "closed") {
          resolvedMap.set(c.assigned_agent_id, (resolvedMap.get(c.assigned_agent_id) || 0) + 1);
        } else {
          activeMap.set(c.assigned_agent_id, (activeMap.get(c.assigned_agent_id) || 0) + 1);
        }
      });

      const teamList: ProjectMemberItem[] = (members ?? []).map((m) => ({
        id: m.user_id,
        user_id: m.user_id,
        role: m.role || "agent",
        full_name: m.full_name || m.email?.split("@")[0] || "Team Member",
        email: m.email || "",
        avatar_url: m.avatar_url,
        active_chats: activeMap.get(m.user_id) || 0,
        resolved_chats: resolvedMap.get(m.user_id) || 0,
      }));

      setProjectMembers(teamList);
    } catch (err) {
      console.error("[customer-dashboard] members error:", err);
    } finally {
      setMembersLoading(false);
    }

    // 5. Messages & Team Process Output
    setMetricsLoading(true);
    setActivityLoading(true);
    try {
      const [todayRes, totalRes, recentMsgRes] = await Promise.all([
        db.from("messages").select("id", { count: "exact", head: true }).gte("created_at", todayStart.toISOString()),
        db.from("messages").select("id", { count: "exact", head: true }),
        db
          .from("messages")
          .select("id, conversation_id, content_text, content_type, created_at, status, sender_type, channel")
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
    setBroadcastsLoading(true);
    try {
      const { data: broadcasts } = await db
        .from("broadcasts")
        .select("id, name, status, total_recipients, delivered_count, sent_count, failed_count, created_at")
        .order("created_at", { ascending: false })
        .limit(5);

      if (broadcasts) {
        setRecentBroadcasts(broadcasts as Broadcast[]);
      }
    } catch (err) {
      console.error("[customer-dashboard] broadcasts error:", err);
    } finally {
      setBroadcastsLoading(false);
    }

    // 7. Deals & Flows
    try {
      const [{ count: dealC, data: dealData }, { count: flowC }] = await Promise.all([
        db.from("deals").select("id, value", { count: "exact" }),
        db.from("flows").select("id", { count: "exact", head: true }).eq("status", "active"),
      ]);

      setDealsCount(dealC ?? 0);
      setActiveFlowsCount(flowC ?? 0);
      if (dealData) {
        const sum = dealData.reduce((acc, d) => acc + (Number(d.value) || 0), 0);
        setDealsValue(sum);
      }
    } catch (err) {
      console.error("[customer-dashboard] deals/flows error:", err);
    }
  }, [activeProjectId, activeProjectChannel]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // Quick 1-Click Assignment from Dashboard
  const handleAssign = async (conversationId: string, agentId: string | null) => {
    setAssigningId(conversationId);
    try {
      const res = await fetch("/api/inbox/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: conversationId,
          agent_id: agentId,
          conversationId,
          agentId,
        }),
      });

      if (res.ok) {
        toast.success(agentId ? "Conversation assigned to agent" : "Conversation unassigned");
        // Refresh local queues
        setUnassignedConversations((prev) => prev.filter((c) => c.id !== conversationId));
        setUnassignedCount((prev) => Math.max(0, prev - 1));

        // Immediately update active_chats count for the assigned agent
        if (agentId) {
          setProjectMembers((prev) =>
            prev.map((m) =>
              m.user_id === agentId
                ? { ...m, active_chats: (m.active_chats || 0) + 1 }
                : m
            )
          );
        }

        setAllConversations((prev) =>
          prev.map((c) =>
            c.id === conversationId ? { ...c, assigned_agent_id: agentId ?? undefined } : c
          )
        );
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data?.error || `Assignment failed (${res.status})`);
      }
    } catch (err) {
      console.error("[customer-dashboard] assign error:", err);
      toast.error("Failed to assign agent");
    } finally {
      setAssigningId(null);
    }
  };

  const isWhatsAppConnected =
    whatsappStatus === "connected" ||
    whatsappStatus === "paired" ||
    whatsappStatus === "ready";

  if (!activeProjectId) {
    return (
      <div className="space-y-5 p-6 max-w-7xl mx-auto">
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="flex items-center gap-3 p-6">
            <AlertTriangle className="h-6 w-6 text-amber-500" />
            <div>
              <p className="text-base font-semibold text-foreground">No Project Selected</p>
              <p className="text-xs text-muted-foreground mt-0.5">Please select or create an active project to view the workspace command center.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 sm:p-6 max-w-7xl mx-auto">
      {/* 360° Project Header Banner */}
      <div className="flex flex-col gap-4 rounded-xl border border-primary/20 bg-gradient-to-r from-card via-card to-primary/5 p-5 sm:p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary text-xs font-semibold px-2.5 py-0.5">
                <ShieldCheck className="h-3.5 w-3.5 mr-1" />
                Project Command Center
              </Badge>
              <span className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                • {activeProjectName}
              </span>
            </div>
            <h1 className="mt-2 text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
              Welcome back, {adminName}!
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Complete project control center — monitor live communication channels, triage unassigned chats, and track team output.
            </p>
          </div>

          {/* Top Quick Actions */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={() => router.push("/inbox")}
              className="bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm gap-1.5 text-xs font-medium"
            >
              <Inbox className="h-4 w-4" />
              Open Inbox
              {unassignedCount > 0 && (
                <Badge className="ml-1 bg-red-500 text-white px-1.5 py-0 text-[10px]">
                  {unassignedCount} unassigned
                </Badge>
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push("/broadcasts/new")}
              className="gap-1.5 text-xs font-medium"
            >
              <Radio className="h-3.5 w-3.5 text-indigo-500" />
              New Broadcast
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push("/settings?tab=members")}
              className="gap-1.5 text-xs font-medium"
            >
              <UserPlus className="h-3.5 w-3.5 text-emerald-500" />
              Team Members
            </Button>
          </div>
        </div>

        {/* Live Channel Connection Health Row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3 border-t border-border/60">
          {/* WhatsApp Card */}
          <div
            className={cn(
              "flex items-center justify-between p-3 rounded-lg border bg-background/80 transition-colors cursor-pointer",
              isWhatsAppConnected ? "border-emerald-500/30 hover:bg-emerald-500/5" : "border-amber-500/30 hover:bg-amber-500/5"
            )}
            onClick={() => router.push("/whatsapp")}
          >
            <div className="flex items-center gap-2.5">
              <div className={cn("p-2 rounded-md", isWhatsAppConnected ? "bg-emerald-500/10 text-emerald-600" : "bg-amber-500/10 text-amber-600")}>
                <QrCode className="h-4 w-4" />
              </div>
              <div>
                <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  WhatsApp Gateway
                  <span className={cn("h-2 w-2 rounded-full", isWhatsAppConnected ? "bg-emerald-500 animate-pulse" : "bg-amber-500")} />
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {whatsappLoading ? "Checking..." : isWhatsAppConnected ? (whatsappPhone || "Connected & Ready") : "Disconnected • Click to Pair"}
                </p>
              </div>
            </div>
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
          </div>

          {/* Instagram Card */}
          <div
            className={cn(
              "flex items-center justify-between p-3 rounded-lg border bg-background/80 transition-colors cursor-pointer",
              instagramConnected ? "border-pink-500/30 hover:bg-pink-500/5" : "border-border hover:bg-muted/40"
            )}
            onClick={() => router.push("/instagram")}
          >
            <div className="flex items-center gap-2.5">
              <div className={cn("p-2 rounded-md", instagramConnected ? "bg-pink-500/10 text-pink-600" : "bg-muted text-muted-foreground")}>
                <Instagram className="h-4 w-4" />
              </div>
              <div>
                <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  Instagram DM
                  <span className={cn("h-2 w-2 rounded-full", instagramConnected ? "bg-pink-500 animate-pulse" : "bg-muted-foreground")} />
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {instagramLoading ? "Checking..." : instagramConnected ? (instagramUsername || "Connected") : "Not Connected"}
                </p>
              </div>
            </div>
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
          </div>

          {/* Facebook Card */}
          <div
            className={cn(
              "flex items-center justify-between p-3 rounded-lg border bg-background/80 transition-colors cursor-pointer",
              facebookConnected ? "border-blue-500/30 hover:bg-blue-500/5" : "border-border hover:bg-muted/40"
            )}
            onClick={() => router.push("/facebook")}
          >
            <div className="flex items-center gap-2.5">
              <div className={cn("p-2 rounded-md", facebookConnected ? "bg-blue-500/10 text-blue-600" : "bg-muted text-muted-foreground")}>
                <Facebook className="h-4 w-4" />
              </div>
              <div>
                <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  Facebook Messenger
                  <span className={cn("h-2 w-2 rounded-full", facebookConnected ? "bg-blue-500 animate-pulse" : "bg-muted-foreground")} />
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {facebookLoading ? "Checking..." : facebookConnected ? (facebookPageName || "Connected") : "Not Connected"}
                </p>
              </div>
            </div>
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
        </div>
      </div>

      {/* 360° Project KPI Matrix */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {contactsLoading || conversationsLoading || metricsLoading ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : (
          <>
            <MetricCard
              title="Total Contacts"
              value={totalContacts.toLocaleString()}
              icon={Users}
              subtitle={contactsToday > 0 ? `+${contactsToday} new leads today` : "Total audience database"}
            />
            <MetricCard
              title="Active Conversations"
              value={activeConversationsCount.toLocaleString()}
              icon={MessageSquare}
              subtitle={`${resolvedCount} resolved chats`}
            />
            <MetricCard
              title="Unassigned Queue"
              value={unassignedCount.toLocaleString()}
              icon={AlertTriangle}
              subtitle={unassignedCount > 0 ? "Requires agent assignment" : "All chats assigned"}
            />
            <MetricCard
              title="Messages Today"
              value={messagesSentToday.toLocaleString()}
              icon={Send}
              subtitle={`${totalMessagesProcessed.toLocaleString()} total project messages`}
            />
          </>
        )}
      </div>

      {/* Project Overview Secondary Row: Pipelines, Automations, Broadcasts */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border-border shadow-sm p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
              <DollarSign className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium">Pipeline Value</p>
              <p className="text-lg font-bold text-foreground">${dealsValue.toLocaleString()}</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => router.push("/pipelines")} className="text-xs">
            {dealsCount} deals <ArrowRight className="h-3 w-3 ml-1" />
          </Button>
        </Card>

        <Card className="border-border shadow-sm p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-indigo-500/10 text-indigo-600 flex items-center justify-center">
              <Workflow className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium">Active Automations</p>
              <p className="text-lg font-bold text-foreground">{activeFlowsCount} Flows</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => router.push("/flows")} className="text-xs">
            Manage <ArrowRight className="h-3 w-3 ml-1" />
          </Button>
        </Card>

        <Card className="border-border shadow-sm p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-pink-500/10 text-pink-600 flex items-center justify-center">
              <Radio className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium">Broadcast Campaigns</p>
              <p className="text-lg font-bold text-foreground">{recentBroadcasts.length} Sent</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => router.push("/broadcasts")} className="text-xs">
            View <ArrowRight className="h-3 w-3 ml-1" />
          </Button>
        </Card>
      </div>

      {/* Interactive Command Tabs: Triage, Team, Broadcasts, Contacts, Activity */}
      <Tabs value={dashboardTab} onValueChange={setDashboardTab} className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-3">
          <TabsList className="h-9 bg-muted/60">
            <TabsTrigger value="unassigned" className="text-xs gap-1.5 h-7">
              <AlertTriangle className={cn("h-3.5 w-3.5", unassignedCount > 0 ? "text-amber-500" : "text-muted-foreground")} />
              Unassigned Queue
              {unassignedCount > 0 && (
                <Badge className="bg-red-500 text-white px-1.5 py-0 text-[10px] font-bold">
                  {unassignedCount}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="team" className="text-xs gap-1.5 h-7">
              <Users className="h-3.5 w-3.5 text-primary" />
              Team & Agents ({projectMembers.length})
            </TabsTrigger>
            <TabsTrigger value="broadcasts" className="text-xs gap-1.5 h-7">
              <Radio className="h-3.5 w-3.5 text-indigo-500" />
              Broadcasts & Campaigns
            </TabsTrigger>
            <TabsTrigger value="contacts" className="text-xs gap-1.5 h-7">
              <TagIcon className="h-3.5 w-3.5 text-emerald-500" />
              Recent Contacts
            </TabsTrigger>
            <TabsTrigger value="activity" className="text-xs gap-1.5 h-7">
              <Activity className="h-3.5 w-3.5 text-pink-500" />
              Live Project Feed
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Tab 1: 🚨 Unassigned Queue (Live 1-Click Triage) */}
        <TabsContent value="unassigned" className="space-y-4">
          <Card className="border-border shadow-sm">
            <CardHeader className="p-4 sm:p-5 border-b border-border">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-amber-500" />
                    Unassigned Conversation Queue
                  </CardTitle>
                  <CardDescription className="text-xs text-muted-foreground mt-0.5">
                    Customer inquiries currently waiting for an agent assignment
                  </CardDescription>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs h-8"
                  onClick={() => router.push("/inbox?filter=unassigned")}
                >
                  Open in Inbox Triage <ArrowRight className="h-3 w-3 ml-1" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0 divide-y divide-border">
              {conversationsLoading ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  Loading unassigned queue...
                </div>
              ) : unassignedConversations.length === 0 ? (
                <div className="p-12 text-center">
                  <div className="mx-auto w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center mb-3">
                    <CheckCircle className="h-6 w-6 text-emerald-600" />
                  </div>
                  <h4 className="text-sm font-semibold text-foreground">Zero Unassigned Inquiries</h4>
                  <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                    All incoming customer chats are actively assigned to agents or handled by automated bots.
                  </p>
                </div>
              ) : (
                unassignedConversations.map((conv) => {
                  const contact = conv.contact;
                  const displayName = contact?.name || contact?.phone || "Unknown Lead";
                  const timeAgo = conv.last_message_at
                    ? formatDistanceToNow(new Date(conv.last_message_at), { addSuffix: true })
                    : "recently";

                  return (
                    <div
                      key={conv.id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 sm:p-4 hover:bg-muted/40 transition-colors gap-3"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="h-9 w-9 shrink-0 rounded-full bg-amber-500/10 text-amber-600 flex items-center justify-center text-xs font-bold border border-amber-500/20">
                          {displayName.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-foreground truncate">
                              {displayName}
                            </span>
                            <Badge variant="outline" className="text-[10px] py-0 px-1.5 capitalize">
                              {conv.channel || "WhatsApp"}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground truncate mt-0.5">
                            {conv.last_message_text || "No preview text"}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0 self-end sm:self-auto">
                        <span className="text-[11px] text-muted-foreground">
                          Waiting {timeAgo}
                        </span>

                        {/* Assign Dropdown */}
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            disabled={assigningId === conv.id}
                            className="inline-flex items-center justify-center h-7 px-2.5 text-xs font-medium gap-1 rounded-md border border-primary/30 text-primary hover:bg-primary/10 transition-colors focus:outline-none disabled:opacity-50 cursor-pointer"
                          >
                            {assigningId === conv.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <UserCheck className="h-3 w-3" />
                            )}
                            <span>Assign to Agent</span>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-56">
                            <DropdownMenuGroup>
                              <DropdownMenuLabel className="text-xs">Select Project Agent</DropdownMenuLabel>
                            </DropdownMenuGroup>
                            <DropdownMenuSeparator />
                            {projectMembers.length === 0 ? (
                              <div className="p-2 text-xs text-muted-foreground text-center">
                                No agents in project
                              </div>
                            ) : (
                              projectMembers.map((member) => (
                                <DropdownMenuItem
                                  key={member.user_id}
                                  className="text-xs flex items-center justify-between cursor-pointer"
                                  onClick={() => handleAssign(conv.id, member.user_id)}
                                >
                                  <span>{member.full_name}</span>
                                  <Badge variant="secondary" className="text-[9px] px-1 py-0 capitalize">
                                    {member.role} ({member.active_chats})
                                  </Badge>
                                </DropdownMenuItem>
                              ))
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>

                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          onClick={() => router.push(`/inbox?c=${conv.id}`)}
                        >
                          View
                        </Button>
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 2: 👥 Team & Agent Performance Workload */}
        <TabsContent value="team" className="space-y-4">
          <Card className="border-border shadow-sm">
            <CardHeader className="p-4 sm:p-5 border-b border-border">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <Users className="h-5 w-5 text-primary" />
                    Team Member Workload & Output
                  </CardTitle>
                  <CardDescription className="text-xs text-muted-foreground mt-0.5">
                    Live operational distribution across administrators, agents, and staff
                  </CardDescription>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs h-8 gap-1.5"
                  onClick={() => router.push("/settings?tab=members")}
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  Manage Team
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0 divide-y divide-border">
              {membersLoading ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  Loading team members...
                </div>
              ) : projectMembers.length === 0 ? (
                <div className="p-12 text-center text-xs text-muted-foreground">
                  No members added to this project yet.
                </div>
              ) : (
                projectMembers.map((member) => (
                  <div
                    key={member.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 sm:p-4 hover:bg-muted/40 transition-colors gap-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-9 w-9 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold border border-primary/20">
                        {member.full_name.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-foreground truncate">
                            {member.full_name}
                          </span>
                          <Badge variant="secondary" className="text-[10px] py-0 px-1.5 capitalize">
                            {member.role}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground truncate">{member.email}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 shrink-0 text-xs">
                      <div className="text-right">
                        <p className="font-semibold text-foreground">{member.active_chats} Active</p>
                        <p className="text-[10px] text-muted-foreground">{member.resolved_chats} Resolved</p>
                      </div>
                      <Badge
                        variant={member.active_chats > 0 ? "default" : "outline"}
                        className="text-[10px] py-0.5 font-medium"
                      >
                        {member.active_chats > 0 ? "Assigned" : "Available"}
                      </Badge>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 3: 📢 Broadcasts & Campaigns */}
        <TabsContent value="broadcasts" className="space-y-4">
          <Card className="border-border shadow-sm">
            <CardHeader className="p-4 sm:p-5 border-b border-border">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <Radio className="h-5 w-5 text-indigo-500" />
                    Recent Broadcast Campaigns
                  </CardTitle>
                  <CardDescription className="text-xs text-muted-foreground mt-0.5">
                    WhatsApp & Email marketing campaign performance
                  </CardDescription>
                </div>
                <Button
                  size="sm"
                  className="text-xs h-8 gap-1.5"
                  onClick={() => router.push("/broadcasts/new")}
                >
                  <PlusCircle className="h-3.5 w-3.5" />
                  Create Campaign
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0 divide-y divide-border">
              {broadcastsLoading ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  Loading campaigns...
                </div>
              ) : recentBroadcasts.length === 0 ? (
                <div className="p-12 text-center text-xs text-muted-foreground">
                  No broadcast campaigns sent yet. Click &quot;Create Campaign&quot; to send your first message.
                </div>
              ) : (
                recentBroadcasts.map((bc) => {
                  const deliveryRate =
                    bc.total_recipients > 0
                      ? Math.round(((bc.delivered_count || 0) / bc.total_recipients) * 100)
                      : 0;

                  return (
                    <div
                      key={bc.id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 sm:p-4 hover:bg-muted/40 transition-colors gap-3"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-foreground">{bc.name}</span>
                          <Badge variant="outline" className="text-[10px] capitalize">
                            {bc.status}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {bc.total_recipients} recipients • {formatDistanceToNow(new Date(bc.created_at), { addSuffix: true })}
                        </p>
                      </div>

                      <div className="flex items-center gap-4 text-xs">
                        <div className="text-right">
                          <p className="font-bold text-foreground">{deliveryRate}% Delivered</p>
                          <p className="text-[10px] text-muted-foreground">
                            {bc.delivered_count || 0} / {bc.total_recipients}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          onClick={() => router.push(`/broadcasts/${bc.id}`)}
                        >
                          Details
                        </Button>
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 4: 📇 Recent Contacts */}
        <TabsContent value="contacts" className="space-y-4">
          <Card className="border-border shadow-sm">
            <CardHeader className="p-4 sm:p-5 border-b border-border">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <Users className="h-5 w-5 text-emerald-500" />
                    Recently Registered Audience & Contacts
                  </CardTitle>
                  <CardDescription className="text-xs text-muted-foreground mt-0.5">
                    Latest leads and subscribers synced across all channels
                  </CardDescription>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs h-8"
                  onClick={() => router.push("/contacts")}
                >
                  View All ({totalContacts}) <ArrowRight className="h-3 w-3 ml-1" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0 divide-y divide-border">
              {contactsLoading ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  Loading contacts...
                </div>
              ) : recentContacts.length === 0 ? (
                <div className="p-12 text-center text-xs text-muted-foreground">
                  No contacts found in this project.
                </div>
              ) : (
                recentContacts.map((c) => (
                  <div
                    key={c.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 sm:p-4 hover:bg-muted/40 transition-colors gap-3 cursor-pointer"
                    onClick={() => router.push("/contacts")}
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-xs font-semibold text-foreground">
                        {(c.name || c.phone || "U").slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-foreground">{c.name || "Customer"}</span>
                          {c.company && (
                            <Badge variant="outline" className="text-[10px] py-0">
                              {c.company}
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">{c.phone || c.email || "No direct phone"}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <Badge variant="secondary" className="text-[10px] capitalize">
                        {c.channel || "WhatsApp"}
                      </Badge>
                      <span>{c.created_at ? formatDistanceToNow(new Date(c.created_at), { addSuffix: true }) : ""}</span>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 5: 🕒 Live Project Feed */}
        <TabsContent value="activity" className="space-y-4">
          <Card className="border-border shadow-sm">
            <CardHeader className="p-4 sm:p-5 border-b border-border">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Activity className="h-5 w-5 text-pink-500" />
                Live Project Activity Feed
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground mt-0.5">
                Real-time stream of inbound customer interactions and outbound replies
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0 divide-y divide-border">
              {activityLoading ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  Loading activity...
                </div>
              ) : recentMessages.length === 0 ? (
                <div className="p-12 text-center text-xs text-muted-foreground">
                  No messages processed recently.
                </div>
              ) : (
                recentMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className="p-3.5 sm:p-4 hover:bg-muted/40 transition-colors cursor-pointer"
                    onClick={() => router.push(`/inbox?c=${msg.conversation_id}`)}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                        <Badge
                          variant={msg.sender_type === "agent" ? "default" : "secondary"}
                          className="text-[9px] px-1 py-0 capitalize"
                        >
                          {msg.sender_type}
                        </Badge>
                        <span className="capitalize text-muted-foreground">{msg.channel || "WhatsApp"}</span>
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {formatDistanceToNow(new Date(msg.created_at), { addSuffix: true })}
                      </span>
                    </div>
                    <p className="text-xs text-foreground mt-1 line-clamp-2">
                      {msg.content_text || `[${msg.content_type || "Message"}]`}
                    </p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
