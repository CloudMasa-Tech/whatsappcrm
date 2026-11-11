"use client";

import { Suspense, useEffect, useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  LifeBuoy,
  Search,
  Filter,
  RefreshCw,
  Clock,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Send,
  Building,
  User,
  Mail,
  ExternalLink,
  ChevronRight,
  X,
  Trash2,
  Edit3,
  Shield,
  FileText,
} from "lucide-react";

interface Ticket {
  id: string;
  ticket_number: string;
  subject: string;
  description: string;
  category: string;
  priority: string;
  status: string;
  created_by_name: string | null;
  created_by_email: string;
  attachment_urls: string[] | null;
  resolution_notes: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  projects?: { id: string; name: string } | null;
  accounts?: { id: string; name: string } | null;
}

interface TicketReply {
  id: string;
  ticket_id: string;
  user_name: string | null;
  user_email: string;
  user_role: string;
  message: string;
  is_internal: boolean;
  created_at: string;
}

const CATEGORIES = [
  { value: "whatsapp_gateway", label: "WhatsApp Gateway / Connection" },
  { value: "technical", label: "Technical Issue / System Error" },
  { value: "bug_report", label: "Bug Report" },
  { value: "billing", label: "Billing & Quota" },
  { value: "feature_request", label: "Feature Request" },
  { value: "account_access", label: "Account & Team Access" },
  { value: "other", label: "General Inquiry" },
];

const PRIORITIES = [
  { value: "low", label: "Low", color: "bg-slate-500/10 text-slate-400 border-slate-500/20" },
  { value: "medium", label: "Medium", color: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  { value: "high", label: "High", color: "bg-orange-500/10 text-orange-400 border-orange-500/20" },
  { value: "urgent", label: "Urgent", color: "bg-red-500/10 text-red-400 border-red-500/20" },
];

function AdminTicketsPageContent() {
  const { user, profile } = useAuth();
  const searchParams = useSearchParams();
  const ticketIdParam = searchParams.get("ticketId");
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [needsMigration, setNeedsMigration] = useState(false);

  // Selected Ticket Drawer / Modal
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [editStatus, setEditStatus] = useState("open");
  const [editPriority, setEditPriority] = useState("medium");
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [updatingTicket, setUpdatingTicket] = useState(false);

  // Replies Thread
  const [replies, setReplies] = useState<TicketReply[]>([]);
  const [repliesLoading, setRepliesLoading] = useState(false);
  const [replyMessage, setReplyMessage] = useState("");
  const [isInternalNote, setIsInternalNote] = useState(false);
  const [sendingReply, setSendingReply] = useState(false);

  const fetchTickets = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const res = await fetch("/api/tickets");
      const data = await res.json();
      if (data.needsMigration) {
        setNeedsMigration(true);
      } else {
        setNeedsMigration(false);
      }
      if (data.tickets) {
        setTickets(data.tickets);
      }
    } catch (err) {
      console.error("Failed to load tickets:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchTickets();
  }, []);

  useEffect(() => {
    if (ticketIdParam && tickets.length > 0) {
      const match = tickets.find((t) => t.id === ticketIdParam);
      if (match) {
        openTicketDetails(match);
      }
    }
  }, [ticketIdParam, tickets]);

  const openTicketDetails = async (ticket: Ticket) => {
    setSelectedTicket(ticket);
    setEditStatus(ticket.status);
    setEditPriority(ticket.priority);
    setResolutionNotes(ticket.resolution_notes || "");
    setRepliesLoading(true);

    try {
      const res = await fetch(`/api/tickets/${ticket.id}/replies`);
      const data = await res.json();
      setReplies(data.replies || []);
    } catch (err) {
      console.error("Failed to load replies:", err);
    } finally {
      setRepliesLoading(false);
    }
  };

  const handleUpdateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicket) return;

    setUpdatingTicket(true);
    try {
      const res = await fetch(`/api/tickets/${selectedTicket.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: editStatus,
          priority: editPriority,
          resolution_notes: resolutionNotes,
        }),
      });

      const data = await res.json();
      if (res.ok && data.ticket) {
        setTickets((prev) =>
          prev.map((t) => (t.id === selectedTicket.id ? { ...t, ...data.ticket } : t))
        );
        setSelectedTicket((prev) => (prev ? { ...prev, ...data.ticket } : null));
        alert(`Ticket #${selectedTicket.ticket_number} updated successfully! Status update email has been sent to client.`);
      } else {
        alert(data.error || "Failed to update ticket");
      }
    } catch (err) {
      console.error("Update error:", err);
      alert("Failed to update ticket");
    } finally {
      setUpdatingTicket(false);
    }
  };

  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicket || !replyMessage.trim()) return;

    setSendingReply(true);
    try {
      const res = await fetch(`/api/tickets/${selectedTicket.id}/replies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: replyMessage.trim(),
          is_internal: isInternalNote,
        }),
      });

      const data = await res.json();
      if (res.ok && data.reply) {
        setReplies((prev) => [...prev, data.reply]);
        setReplyMessage("");
        if (!isInternalNote) {
          alert(`Reply sent and emailed to ${selectedTicket.created_by_email}`);
        }
      } else {
        alert(data.error || "Failed to post reply");
      }
    } catch (err) {
      console.error("Reply error:", err);
      alert("Failed to send reply");
    } finally {
      setSendingReply(false);
    }
  };

  const handleDeleteTicket = async () => {
    if (!selectedTicket) return;
    if (!confirm(`Are you sure you want to permanently delete ticket #${selectedTicket.ticket_number}?`)) {
      return;
    }

    try {
      const res = await fetch(`/api/tickets/${selectedTicket.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setTickets((prev) => prev.filter((t) => t.id !== selectedTicket.id));
        setSelectedTicket(null);
      } else {
        alert("Failed to delete ticket");
      }
    } catch (err) {
      console.error("Delete error:", err);
    }
  };

  // Filtered tickets
  const filteredTickets = useMemo(() => {
    return tickets.filter((t) => {
      const matchesSearch =
        search === "" ||
        t.subject.toLowerCase().includes(search.toLowerCase()) ||
        t.ticket_number.toLowerCase().includes(search.toLowerCase()) ||
        t.description.toLowerCase().includes(search.toLowerCase()) ||
        (t.created_by_name && t.created_by_name.toLowerCase().includes(search.toLowerCase())) ||
        t.created_by_email.toLowerCase().includes(search.toLowerCase()) ||
        (t.projects?.name && t.projects.name.toLowerCase().includes(search.toLowerCase()));

      const matchesStatus = statusFilter === "all" || t.status === statusFilter;
      const matchesPriority = priorityFilter === "all" || t.priority === priorityFilter;
      const matchesCategory = categoryFilter === "all" || t.category === categoryFilter;

      return matchesSearch && matchesStatus && matchesPriority && matchesCategory;
    });
  }, [tickets, search, statusFilter, priorityFilter, categoryFilter]);

  // Status statistics
  const stats = useMemo(() => {
    return {
      total: tickets.length,
      open: tickets.filter((t) => t.status === "open").length,
      in_progress: tickets.filter((t) => t.status === "in_progress").length,
      urgent: tickets.filter((t) => t.priority === "urgent" || t.priority === "high").length,
      resolved: tickets.filter((t) => t.status === "resolved").length,
    };
  }, [tickets]);

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-background p-6">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border/60 pb-6">
        <div>
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20 shadow-sm">
              <LifeBuoy className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                Support Tickets Moderation
              </h1>
              <p className="text-xs sm:text-sm text-muted-foreground">
                Global escalation queue for all projects. Notifications automatically route to{" "}
                <span className="font-semibold text-primary">info@cloudmasa.com</span>.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchTickets(true)}
            disabled={refreshing}
            className="border-border text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
            Refresh Queue
          </Button>
        </div>
      </div>

      {/* Migration Notice Banner */}
      {needsMigration && (
        <div className="my-5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-200 shadow-sm animate-in fade-in duration-300">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="font-semibold text-amber-300 flex items-center gap-2">
                <span>Database Table Setup Required in Supabase</span>
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">Action Needed</span>
              </div>
              <p className="text-xs text-amber-200/90 leading-relaxed">
                Email routing to <strong className="text-white">info@cloudmasa.com</strong> is active! To persist tickets in the database queue, execute <code className="bg-black/30 px-1.5 py-0.5 rounded font-mono text-white">supabase/migrations/061_support_ticketing_system.sql</code> in your Supabase SQL editor.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Metrics Banner */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5 my-6">
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Total Tickets
          </div>
          <div className="mt-2 text-2xl font-bold text-foreground">{stats.total}</div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-amber-500">
            <Clock className="h-3.5 w-3.5" /> Open
          </div>
          <div className="mt-2 text-2xl font-bold text-foreground">{stats.open}</div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-red-500">
            <AlertTriangle className="h-3.5 w-3.5" /> High / Urgent
          </div>
          <div className="mt-2 text-2xl font-bold text-foreground">{stats.urgent}</div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-blue-500">
            <AlertCircle className="h-3.5 w-3.5" /> In Progress
          </div>
          <div className="mt-2 text-2xl font-bold text-foreground">{stats.in_progress}</div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-emerald-500">
            <CheckCircle2 className="h-3.5 w-3.5" /> Resolved
          </div>
          <div className="mt-2 text-2xl font-bold text-foreground">{stats.resolved}</div>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between bg-card border border-border/80 rounded-xl p-3 shadow-sm mb-6">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by ticket #, submitter, email, or subject…"
            className="pl-9 bg-background/50 border-border text-sm h-9"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-9 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="all">All Statuses</option>
            <option value="open">Open</option>
            <option value="in_progress">In Progress</option>
            <option value="resolved">Resolved</option>
            <option value="closed">Closed</option>
          </select>

          {/* Priority Filter */}
          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="h-9 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="all">All Priorities</option>
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>

          {/* Category Filter */}
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="h-9 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="all">All Categories</option>
            {CATEGORIES.map((cat) => (
              <option key={cat.value} value={cat.value}>
                {cat.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Tickets List */}
      {loading ? (
        <div className="flex flex-1 items-center justify-center py-20">
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <p className="text-xs text-muted-foreground">Loading tickets queue…</p>
          </div>
        </div>
      ) : filteredTickets.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-border py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/60 text-muted-foreground mb-4">
            <LifeBuoy className="h-7 w-7" />
          </div>
          <h3 className="text-base font-semibold text-foreground">No Tickets Found</h3>
          <p className="text-xs text-muted-foreground max-w-sm mt-1">
            {tickets.length === 0
              ? "All caught up! No support tickets have been opened yet across platform projects."
              : "No tickets match your active filter criteria."}
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {filteredTickets.map((ticket) => {
            const pMeta = PRIORITIES.find((p) => p.value === ticket.priority) || PRIORITIES[1];
            const catLabel =
              CATEGORIES.find((c) => c.value === ticket.category)?.label || ticket.category;

            return (
              <div
                key={ticket.id}
                onClick={() => openTicketDetails(ticket)}
                className="group flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 hover:border-primary/40 hover:bg-card/90 transition-all cursor-pointer shadow-sm"
              >
                <div className="flex items-start gap-3.5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary border border-primary/20">
                    <LifeBuoy className="h-5 w-5" />
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs font-bold text-primary">
                        #{ticket.ticket_number}
                      </span>
                      <h4 className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                        {ticket.subject}
                      </h4>
                    </div>

                    <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                      <span className="text-foreground/80 font-medium">{catLabel}</span>
                      <span>&bull;</span>
                      <span className="inline-flex items-center gap-1 font-medium text-foreground">
                        <User className="h-3 w-3" />
                        {ticket.created_by_name || ticket.created_by_email}
                      </span>
                      {ticket.projects?.name && (
                        <>
                          <span>&bull;</span>
                          <span className="inline-flex items-center gap-1 text-primary/80">
                            <Building className="h-3 w-3" />
                            {ticket.projects.name}
                          </span>
                        </>
                      )}
                      <span>&bull;</span>
                      <span>{new Date(ticket.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2.5 self-end sm:self-center">
                  <Badge variant="outline" className={`text-xs capitalize font-medium ${pMeta.color}`}>
                    {ticket.priority}
                  </Badge>

                  <Badge
                    variant="outline"
                    className={`text-xs capitalize font-medium ${
                      ticket.status === "open"
                        ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                        : ticket.status === "in_progress"
                        ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
                        : ticket.status === "resolved"
                        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                        : "bg-slate-500/10 text-slate-400 border-slate-500/20"
                    }`}
                  >
                    {ticket.status.replace("_", " ")}
                  </Badge>

                  <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* SUPER ADMIN TICKET RESOLUTION DRAWER / MODAL */}
      {selectedTicket && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="relative w-full max-w-3xl rounded-2xl border border-border bg-card p-6 shadow-2xl my-8 max-h-[92vh] flex flex-col">
            <button
              onClick={() => setSelectedTicket(null)}
              className="absolute right-4 top-4 rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-5 w-5" />
            </button>

            {/* Header */}
            <div className="flex items-start justify-between pr-8 border-b border-border pb-4 mb-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-base font-bold text-primary">
                    #{selectedTicket.ticket_number}
                  </span>
                  <Badge variant="outline" className="text-xs uppercase">
                    {selectedTicket.status.replace("_", " ")}
                  </Badge>
                </div>
                <h3 className="text-lg font-bold text-foreground mt-1">
                  {selectedTicket.subject}
                </h3>
                <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1 flex-wrap">
                  <span>Client: <strong>{selectedTicket.created_by_name}</strong></span>
                  <span>&bull;</span>
                  <a
                    href={`mailto:${selectedTicket.created_by_email}`}
                    className="text-primary hover:underline flex items-center gap-1"
                  >
                    <Mail className="h-3 w-3" />
                    {selectedTicket.created_by_email}
                  </a>
                  {selectedTicket.projects?.name && (
                    <>
                      <span>&bull;</span>
                      <span>Project: <strong>{selectedTicket.projects.name}</strong></span>
                    </>
                  )}
                </div>
              </div>

              <Button
                variant="ghost"
                size="sm"
                onClick={handleDeleteTicket}
                className="text-muted-foreground hover:text-red-400"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>

            {/* Content Body (Scrollable) */}
            <div className="flex-1 overflow-y-auto space-y-4 pr-1">
              {/* Problem Description */}
              <div className="rounded-xl border border-border bg-background/50 p-4">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                  Client Problem Description
                </div>
                <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                  {selectedTicket.description}
                </p>

                {selectedTicket.attachment_urls && selectedTicket.attachment_urls.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-border flex flex-wrap gap-2">
                    {selectedTicket.attachment_urls.map((url, i) => (
                      <a
                        key={i}
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline bg-muted/60 px-2.5 py-1 rounded-md"
                      >
                        <ExternalLink className="h-3 w-3" />
                        Attachment #{i + 1}
                      </a>
                    ))}
                  </div>
                )}
              </div>

              {/* Status & Priority Management Form */}
              <form
                onSubmit={handleUpdateTicket}
                className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-3"
              >
                <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-primary">
                  <Shield className="h-4 w-4" /> Super Admin Controls
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold uppercase text-muted-foreground mb-1">
                      Update Status
                    </label>
                    <select
                      value={editStatus}
                      onChange={(e) => setEditStatus(e.target.value)}
                      className="w-full h-9 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                      <option value="open">Open</option>
                      <option value="in_progress">In Progress</option>
                      <option value="resolved">Resolved</option>
                      <option value="closed">Closed</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold uppercase text-muted-foreground mb-1">
                      Update Priority
                    </label>
                    <select
                      value={editPriority}
                      onChange={(e) => setEditPriority(e.target.value)}
                      className="w-full h-9 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                      {PRIORITIES.map((p) => (
                        <option key={p.value} value={p.value}>
                          {p.label} Priority
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold uppercase text-muted-foreground mb-1">
                    Resolution Notes (Emailed to Submitter upon Resolution)
                  </label>
                  <textarea
                    rows={2}
                    value={resolutionNotes}
                    onChange={(e) => setResolutionNotes(e.target.value)}
                    placeholder="e.g. Gateway socket restarted, IP unblocked, session refreshed..."
                    className="w-full rounded-md border border-border bg-background p-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-y"
                  />
                </div>

                <div className="flex justify-end">
                  <Button
                    type="submit"
                    size="sm"
                    disabled={updatingTicket}
                    className="bg-primary text-primary-foreground text-xs"
                  >
                    {updatingTicket ? "Saving…" : "Save & Notify Client"}
                  </Button>
                </div>
              </form>

              {/* Conversation Replies Thread */}
              <div className="space-y-3 pt-2">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Support Conversation Thread ({replies.length})
                </div>

                {repliesLoading ? (
                  <div className="py-6 text-center text-xs text-muted-foreground">
                    Loading conversation…
                  </div>
                ) : replies.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                    No replies yet. Type below to send an update to the user.
                  </div>
                ) : (
                  replies.map((reply) => {
                    const isSuperAdmin = reply.user_role === "super_admin";
                    return (
                      <div
                        key={reply.id}
                        className={`rounded-xl p-3.5 border ${
                          reply.is_internal
                            ? "bg-amber-500/10 border-amber-500/30"
                            : isSuperAdmin
                            ? "bg-primary/5 border-primary/30"
                            : "bg-muted/40 border-border"
                        }`}
                      >
                        <div className="flex items-center justify-between text-xs mb-1.5">
                          <span className="font-semibold text-foreground flex items-center gap-1.5">
                            {reply.user_name || reply.user_email}
                            {reply.is_internal ? (
                              <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-[10px] py-0">
                                Internal Admin Note
                              </Badge>
                            ) : isSuperAdmin ? (
                              <Badge className="bg-primary/20 text-primary border-primary/30 text-[10px] py-0">
                                Super Admin Response
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px] py-0">
                                Client
                              </Badge>
                            )}
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            {new Date(reply.created_at).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </div>
                        <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                          {reply.message}
                        </p>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Super Admin Reply Composer */}
            <form onSubmit={handleSendReply} className="mt-4 pt-3 border-t border-border space-y-2">
              <div className="flex items-center gap-3 text-xs">
                <label className="flex items-center gap-1.5 text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isInternalNote}
                    onChange={(e) => setIsInternalNote(e.target.checked)}
                    className="rounded border-border"
                  />
                  <span>Private Internal Note (Hidden from client)</span>
                </label>
              </div>

              <div className="flex gap-2">
                <Input
                  value={replyMessage}
                  onChange={(e) => setReplyMessage(e.target.value)}
                  placeholder={
                    isInternalNote
                      ? "Add private internal admin note…"
                      : "Reply to client (automatically dispatches email notification)…"
                  }
                  className="flex-1 bg-background text-sm"
                />
                <Button
                  type="submit"
                  size="sm"
                  disabled={sendingReply || !replyMessage.trim()}
                  className="bg-primary text-primary-foreground"
                >
                  <Send className="h-4 w-4 mr-1.5" />
                  {sendingReply ? "Sending…" : isInternalNote ? "Add Note" : "Send & Email"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminTicketsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center bg-background">
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <p className="text-xs text-muted-foreground">Loading admin support queue…</p>
          </div>
        </div>
      }
    >
      <AdminTicketsPageContent />
    </Suspense>
  );
}
