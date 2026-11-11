"use client";

import { Suspense, useEffect, useState, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  LifeBuoy,
  Plus,
  Search,
  Filter,
  RefreshCw,
  Clock,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Paperclip,
  Send,
  MessageSquare,
  Building,
  User,
  ExternalLink,
  ChevronRight,
  X,
  FileText,
} from "lucide-react";
import { uploadAccountMedia } from "@/lib/storage/upload-media";

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
  attachment_urls: string[] | null;
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

function TicketsPageContent() {
  const { user, profile } = useAuth();
  const searchParams = useSearchParams();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [needsMigration, setNeedsMigration] = useState(false);

  // New Ticket Modal State
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState("technical");
  const [priority, setPriority] = useState("medium");
  const [description, setDescription] = useState("");
  const [attachmentUrls, setAttachmentUrls] = useState<string[]>([]);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    const subjectParam = searchParams.get("subject");
    if (subjectParam) {
      setSubject(subjectParam);
      setCreateModalOpen(true);
    }
  }, [searchParams]);

  // Selected Ticket Details Drawer
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [replies, setReplies] = useState<TicketReply[]>([]);
  const [repliesLoading, setRepliesLoading] = useState(false);
  const [newReplyMessage, setNewReplyMessage] = useState("");
  const [sendingReply, setSendingReply] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const openTicketDetails = async (ticket: Ticket) => {
    setSelectedTicket(ticket);
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

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 15 * 1024 * 1024) {
      alert("File size exceeds 15 MB limit.");
      return;
    }

    setUploadingFile(true);
    try {
      const { publicUrl } = await uploadAccountMedia("chat-media", file);
      if (publicUrl) {
        setAttachmentUrls((prev) => [...prev, publicUrl]);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to upload file";
      alert("Upload failed: " + msg);
    } finally {
      setUploadingFile(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !description.trim()) return;

    setSubmitting(true);
    setSubmitError(null);
    setSubmitSuccess(null);

    try {
      const res = await fetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject,
          category,
          priority,
          description,
          attachment_urls: attachmentUrls,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to submit ticket");
      }

      setSubmitSuccess(
        `Ticket #${data.ticket?.ticket_number || "Created"} successfully submitted! A priority notification has been emailed to info@cloudmasa.com.`
      );
      setSubject("");
      setDescription("");
      setAttachmentUrls([]);
      fetchTickets(true);

      setTimeout(() => {
        setCreateModalOpen(false);
        setSubmitSuccess(null);
      }, 2500);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "An error occurred";
      setSubmitError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicket || !newReplyMessage.trim()) return;

    setSendingReply(true);
    try {
      const res = await fetch(`/api/tickets/${selectedTicket.id}/replies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: newReplyMessage.trim(),
        }),
      });

      const data = await res.json();
      if (res.ok && data.reply) {
        setReplies((prev) => [...prev, data.reply]);
        setNewReplyMessage("");
      } else {
        alert(data.error || "Failed to send reply");
      }
    } catch (err) {
      console.error("Failed to send reply:", err);
      alert("Failed to send reply");
    } finally {
      setSendingReply(false);
    }
  };

  // Filtered tickets
  const filteredTickets = useMemo(() => {
    return tickets.filter((t) => {
      const matchesSearch =
        search === "" ||
        t.subject.toLowerCase().includes(search.toLowerCase()) ||
        t.ticket_number.toLowerCase().includes(search.toLowerCase()) ||
        t.description.toLowerCase().includes(search.toLowerCase());

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
                Support & Help Desk
              </h1>
              <p className="text-xs sm:text-sm text-muted-foreground">
                Submit and track escalations directly with the CloudMaSa Super Admin team (
                <span className="font-semibold text-primary">info@cloudmasa.com</span>).
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
            Refresh
          </Button>

          <Button
            size="sm"
            onClick={() => setCreateModalOpen(true)}
            className="bg-primary text-primary-foreground hover:bg-primary/90 font-medium shadow-sm"
          >
            <Plus className="h-4 w-4 mr-1.5" />
            New Support Ticket
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
                Good news: <strong>Email alerts to info@cloudmasa.com are already active and working!</strong> To persist tickets and display them in this dashboard, run the SQL from <code className="bg-black/30 px-1.5 py-0.5 rounded font-mono text-white">supabase/migrations/061_support_ticketing_system.sql</code> in your Supabase SQL Editor.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Metrics Banner */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 my-6">
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Total Tickets
          </div>
          <div className="mt-2 text-2xl font-bold text-foreground">{stats.total}</div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-amber-500">
            <Clock className="h-3.5 w-3.5" /> Open / Awaiting
          </div>
          <div className="mt-2 text-2xl font-bold text-foreground">{stats.open}</div>
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

      {/* Filters & Search Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between bg-card border border-border/80 rounded-xl p-3 shadow-sm mb-6">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by ticket #, subject, or description…"
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
            <p className="text-xs text-muted-foreground">Loading your tickets…</p>
          </div>
        </div>
      ) : filteredTickets.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-border py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/60 text-muted-foreground mb-4">
            <LifeBuoy className="h-7 w-7" />
          </div>
          <h3 className="text-base font-semibold text-foreground">No Support Tickets Found</h3>
          <p className="text-xs text-muted-foreground max-w-sm mt-1 mb-5">
            {tickets.length === 0
              ? "You haven't submitted any support requests yet. If you encounter any technical issues or need assistance, open a ticket."
              : "No tickets match your active filter criteria."}
          </p>
          <Button size="sm" onClick={() => setCreateModalOpen(true)}>
            <Plus className="h-4 w-4 mr-1.5" />
            Create Your First Ticket
          </Button>
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
                    <MessageSquare className="h-5 w-5" />
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
                      <span>Submitted by {ticket.created_by_name || ticket.created_by_email}</span>
                      <span>&bull;</span>
                      <span>{new Date(ticket.created_at).toLocaleDateString()}</span>
                      {ticket.projects?.name && (
                        <>
                          <span>&bull;</span>
                          <span className="inline-flex items-center gap-1 text-primary/80">
                            <Building className="h-3 w-3" />
                            {ticket.projects.name}
                          </span>
                        </>
                      )}
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

      {/* CREATE TICKET MODAL */}
      {createModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="relative w-full max-w-xl rounded-2xl border border-border bg-card p-6 shadow-2xl my-8">
            <button
              onClick={() => setCreateModalOpen(false)}
              className="absolute right-4 top-4 rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="flex items-center gap-3 mb-5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20">
                <LifeBuoy className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-foreground">Raise Support Ticket</h3>
                <p className="text-xs text-muted-foreground">
                  An instant high-priority alert will be dispatched to{" "}
                  <strong className="text-primary font-semibold">info@cloudmasa.com</strong>.
                </p>
              </div>
            </div>

            {submitSuccess && (
              <div className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs font-medium text-emerald-400">
                {submitSuccess}
              </div>
            )}

            {submitError && (
              <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-xs font-medium text-red-400">
                {submitError}
              </div>
            )}

            <form onSubmit={handleCreateTicket} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                  Subject / Summary *
                </label>
                <Input
                  required
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="e.g. WhatsApp QR Gateway Disconnecting After Pairing"
                  className="bg-background/60 border-border text-sm"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                    Category *
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full h-10 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    {CATEGORIES.map((cat) => (
                      <option key={cat.value} value={cat.value}>
                        {cat.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                    Urgency / Priority *
                  </label>
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value)}
                    className="w-full h-10 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
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
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                  Detailed Description *
                </label>
                <textarea
                  required
                  rows={5}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Please describe the steps to reproduce, error codes, and what you need assistance with..."
                  className="w-full rounded-md border border-border bg-background/60 p-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-y"
                />
              </div>

              {/* Attachments Section */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                  Attach Screenshots or Error Logs (Optional)
                </label>

                <div className="flex items-center gap-2">
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileUpload}
                    className="hidden"
                    accept="image/*,.pdf,.docx,.txt,.csv"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingFile}
                    className="border-dashed border-border"
                  >
                    <Paperclip className="h-4 w-4 mr-1.5" />
                    {uploadingFile ? "Uploading File…" : "Upload Attachment"}
                  </Button>
                  <span className="text-xs text-muted-foreground">PNG, JPG, PDF up to 15MB</span>
                </div>

                {attachmentUrls.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    {attachmentUrls.map((url, idx) => (
                      <div
                        key={idx}
                        className="inline-flex items-center gap-1.5 bg-muted/60 border border-border px-2.5 py-1 rounded-md text-xs text-foreground"
                      >
                        <FileText className="h-3.5 w-3.5 text-primary" />
                        <span className="max-w-[140px] truncate">
                          {url.split("/").pop() || `File #${idx + 1}`}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setAttachmentUrls((prev) => prev.filter((_, i) => i !== idx))
                          }
                          className="text-muted-foreground hover:text-red-400 ml-1"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-border">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setCreateModalOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={submitting || !subject.trim() || !description.trim()}
                  className="bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  {submitting ? "Submitting & Sending Mail…" : "Submit Support Ticket"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* TICKET DETAILS DIALOG */}
      {selectedTicket && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="relative w-full max-w-2xl rounded-2xl border border-border bg-card p-6 shadow-2xl my-8 max-h-[90vh] flex flex-col">
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
                  <span className="font-mono text-sm font-bold text-primary">
                    #{selectedTicket.ticket_number}
                  </span>
                  <Badge variant="outline" className="text-xs uppercase">
                    {selectedTicket.status.replace("_", " ")}
                  </Badge>
                </div>
                <h3 className="text-lg font-bold text-foreground mt-1">
                  {selectedTicket.subject}
                </h3>
                <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                  <span>
                    Category:{" "}
                    <strong>
                      {CATEGORIES.find((c) => c.value === selectedTicket.category)?.label ||
                        selectedTicket.category}
                    </strong>
                  </span>
                  <span>&bull;</span>
                  <span>Priority: {selectedTicket.priority.toUpperCase()}</span>
                </div>
              </div>
            </div>

            {/* Content Body (Scrollable) */}
            <div className="flex-1 overflow-y-auto space-y-4 pr-1">
              {/* Description Box */}
              <div className="rounded-xl border border-border bg-background/50 p-4">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                  Initial Problem Statement
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

              {/* Resolution Notes if Resolved */}
              {selectedTicket.resolution_notes && (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
                  <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-emerald-400 mb-1">
                    <CheckCircle2 className="h-4 w-4" />
                    Resolution Summary
                  </div>
                  <p className="text-xs text-emerald-200 whitespace-pre-wrap leading-relaxed">
                    {selectedTicket.resolution_notes}
                  </p>
                </div>
              )}

              {/* Conversation Replies Thread */}
              <div className="space-y-3 pt-2">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Conversation & Support Replies ({replies.length})
                </div>

                {repliesLoading ? (
                  <div className="py-6 text-center text-xs text-muted-foreground">
                    Loading conversation…
                  </div>
                ) : replies.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                    No replies yet. The Super Admin team has been notified at{" "}
                    <strong>info@cloudmasa.com</strong>.
                  </div>
                ) : (
                  replies.map((reply) => {
                    const isSuperAdmin = reply.user_role === "super_admin";
                    return (
                      <div
                        key={reply.id}
                        className={`rounded-xl p-3.5 border ${
                          isSuperAdmin
                            ? "bg-primary/5 border-primary/30"
                            : "bg-muted/40 border-border"
                        }`}
                      >
                        <div className="flex items-center justify-between text-xs mb-1.5">
                          <span className="font-semibold text-foreground flex items-center gap-1.5">
                            {reply.user_name || reply.user_email}
                            {isSuperAdmin && (
                              <Badge className="bg-primary/20 text-primary border-primary/30 text-[10px] py-0">
                                CloudMaSa Support
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

            {/* Reply Composer */}
            <form onSubmit={handleSendReply} className="mt-4 pt-3 border-t border-border flex gap-2">
              <Input
                value={newReplyMessage}
                onChange={(e) => setNewReplyMessage(e.target.value)}
                placeholder="Type a message or update for the support team…"
                className="flex-1 bg-background text-sm"
              />
              <Button
                type="submit"
                size="sm"
                disabled={sendingReply || !newReplyMessage.trim()}
                className="bg-primary text-primary-foreground"
              >
                <Send className="h-4 w-4 mr-1.5" />
                {sendingReply ? "Sending…" : "Reply"}
              </Button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function TicketsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center bg-background">
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <p className="text-xs text-muted-foreground">Loading support desk…</p>
          </div>
        </div>
      }
    >
      <TicketsPageContent />
    </Suspense>
  );
}
