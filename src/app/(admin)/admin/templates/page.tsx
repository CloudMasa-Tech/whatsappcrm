"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useTranslations } from "next-intl";
import {
  FileText,
  CheckCircle2,
  XCircle,
  Clock,
  Search,
  Filter,
  Trash2,
  Loader2,
  AlertTriangle,
  RefreshCw,
  FolderKanban,
  User,
  Sparkles,
  ExternalLink,
  MessageSquare,
  ChevronRight,
  Shield,
  Eye,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { MessageTemplate } from "@/types";

interface TemplateWithProject extends MessageTemplate {
  project?: {
    id: string;
    name: string;
    channel_type?: string;
  } | null;
  creator?: {
    user_id: string;
    full_name?: string;
    email?: string;
  } | null;
}

const CATEGORY_STYLES: Record<string, string> = {
  Marketing: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30",
  Utility: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30",
  Authentication: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
};

const SUGGESTED_REASONS = [
  "Contains promotional language in a utility template.",
  "Variable placeholders {{...}} are malformed or missing context.",
  "Message content violates WhatsApp Business messaging policies.",
  "Header or media attachment does not match business use-case.",
  "Buttons contain invalid links or unsupported parameters.",
];

export default function AdminTemplatesPage() {
  const t = useTranslations("Admin.templates");

  const [templates, setTemplates] = useState<TemplateWithProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "PENDING" | "APPROVED" | "REJECTED">("ALL");

  // Rejection modal state
  const [rejectingTemplate, setRejectingTemplate] = useState<TemplateWithProject | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  // Preview modal state
  const [previewTemplate, setPreviewTemplate] = useState<TemplateWithProject | null>(null);

  const loadTemplates = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/admin/templates", { cache: "no-store" });
      if (!res.ok) {
        throw new Error("Failed to load templates");
      }
      const data = await res.json();
      setTemplates(data.templates ?? []);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to load templates");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  // Actions
  async function handleApprove(template: TemplateWithProject) {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/admin/templates/${template.id}/approve`, {
        method: "POST",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to approve template");
      }

      setTemplates((prev) =>
        prev.map((t) =>
          t.id === template.id
            ? { ...t, status: "APPROVED", rejection_reason: undefined, submission_error: undefined }
            : t,
        ),
      );
      toast.success(`Template "${template.name}" approved successfully!`);
    } catch (err: any) {
      toast.error(err.message || "Approval failed");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleConfirmReject() {
    if (!rejectingTemplate) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/admin/templates/${rejectingTemplate.id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: rejectReason }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to reject template");
      }

      setTemplates((prev) =>
        prev.map((t) =>
          t.id === rejectingTemplate.id
            ? { ...t, status: "REJECTED", rejection_reason: rejectReason }
            : t,
        ),
      );
      toast.success(`Template "${rejectingTemplate.name}" rejected.`);
      setRejectingTemplate(null);
      setRejectReason("");
    } catch (err: any) {
      toast.error(err.message || "Rejection failed");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleDelete(template: TemplateWithProject) {
    if (!confirm(`Are you sure you want to delete template "${template.name}"?`)) return;
    try {
      const res = await fetch(`/api/admin/templates/${template.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to delete template");
      }
      setTemplates((prev) => prev.filter((t) => t.id !== template.id));
      toast.success(t("toastDeleted"));
    } catch (err: any) {
      toast.error(err.message || "Delete failed");
    }
  }

  // Derived counts
  const pendingCount = useMemo(
    () => templates.filter((t) => t.status === "PENDING" || !t.status || t.status === "DRAFT").length,
    [templates],
  );
  const approvedCount = useMemo(
    () => templates.filter((t) => t.status === "APPROVED").length,
    [templates],
  );
  const rejectedCount = useMemo(
    () => templates.filter((t) => t.status === "REJECTED").length,
    [templates],
  );

  // Filtered list
  const filteredTemplates = useMemo(() => {
    return templates.filter((tpl) => {
      // Status filter
      if (statusFilter === "PENDING") {
        if (tpl.status !== "PENDING" && tpl.status !== "DRAFT" && Boolean(tpl.status)) return false;
      } else if (statusFilter !== "ALL") {
        if (tpl.status !== statusFilter) return false;
      }

      // Search query
      if (search.trim()) {
        const q = search.toLowerCase();
        const matchName = tpl.name.toLowerCase().includes(q);
        const matchBody = tpl.body_text.toLowerCase().includes(q);
        const matchProject = tpl.project?.name?.toLowerCase().includes(q);
        const matchCreator = tpl.creator?.email?.toLowerCase().includes(q) || tpl.creator?.full_name?.toLowerCase().includes(q);
        if (!matchName && !matchBody && !matchProject && !matchCreator) return false;
      }

      return true;
    });
  }, [templates, statusFilter, search]);

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-6 items-center gap-1.5 rounded-full bg-primary/10 px-2.5 text-xs font-semibold text-primary">
              <Shield className="h-3 w-3" />
              Super Admin Review
            </span>
          </div>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-foreground">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={loadTemplates}
          disabled={loading}
          className="self-start sm:self-auto"
        >
          <RefreshCw className={cn("mr-2 h-4 w-4", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-border bg-card">
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t("totalTemplates")}
              </p>
              <p className="mt-1 text-2xl font-bold text-foreground">{templates.length}</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-foreground">
              <FileText className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card
          className={cn(
            "border-border bg-card transition-colors",
            pendingCount > 0 && "border-amber-500/40 bg-amber-500/5",
          )}
        >
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-amber-500">
                {t("pendingApproval")}
              </p>
              <div className="mt-1 flex items-center gap-2">
                <p className="text-2xl font-bold text-foreground">{pendingCount}</p>
                {pendingCount > 0 && (
                  <span className="inline-flex h-2 w-2 rounded-full bg-amber-500 animate-ping" />
                )}
              </div>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500">
              <Clock className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-emerald-500">
                {t("approved")}
              </p>
              <p className="mt-1 text-2xl font-bold text-foreground">{approvedCount}</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500">
              <CheckCircle2 className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-red-500">
                {t("rejected")}
              </p>
              <p className="mt-1 text-2xl font-bold text-foreground">{rejectedCount}</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-500/10 text-red-500">
              <XCircle className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-card p-1">
          <button
            type="button"
            onClick={() => setStatusFilter("ALL")}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              statusFilter === "ALL"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            All ({templates.length})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter("PENDING")}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-colors flex items-center gap-1.5",
              statusFilter === "PENDING"
                ? "bg-amber-500 text-white shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            Pending
            {pendingCount > 0 && (
              <span className="rounded-full bg-amber-600/30 px-1.5 py-0.2 text-[10px] font-bold text-amber-200">
                {pendingCount}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter("APPROVED")}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              statusFilter === "APPROVED"
                ? "bg-emerald-600 text-white shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            Approved ({approvedCount})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter("REJECTED")}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              statusFilter === "REJECTED"
                ? "bg-red-600 text-white shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            Rejected ({rejectedCount})
          </button>
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t("searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 text-sm"
          />
        </div>
      </div>

      {/* Templates List */}
      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : filteredTemplates.length === 0 ? (
        <Card className="border-dashed border-border bg-card/50">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <FileText className="h-10 w-10 text-muted-foreground/60" />
            <p className="mt-3 text-base font-medium text-foreground">{t("noTemplates")}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {statusFilter === "PENDING"
                ? t("noTemplatesPending")
                : "Templates submitted by project administrators will appear here for review."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {filteredTemplates.map((template) => {
            const isPending = template.status === "PENDING" || !template.status || template.status === "DRAFT";
            const isApproved = template.status === "APPROVED";
            const isRejected = template.status === "REJECTED";

            return (
              <Card
                key={template.id}
                className={cn(
                  "overflow-hidden border transition-all hover:shadow-md",
                  isPending && "border-amber-500/40 bg-card/90",
                  isApproved && "border-emerald-500/30 bg-card",
                  isRejected && "border-red-500/30 bg-card/80",
                )}
              >
                <CardContent className="p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    {/* Template Meta & Content */}
                    <div className="flex-1 space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-bold text-foreground">{template.name}</h3>
                        <Badge
                          variant="outline"
                          className={cn("text-xs font-semibold uppercase tracking-wider", CATEGORY_STYLES[template.category])}
                        >
                          {template.category}
                        </Badge>
                        <Badge variant="secondary" className="text-xs">
                          {template.language || "en_US"}
                        </Badge>
                        {template.header_type && template.header_type !== "text" && (
                          <Badge variant="outline" className="text-xs bg-muted/50 capitalize">
                            Header: {template.header_type}
                          </Badge>
                        )}

                        {/* Status Badge */}
                        {isPending && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-600 dark:text-amber-400 border border-amber-500/30">
                            <Clock className="h-3 w-3" />
                            Pending Approval
                          </span>
                        )}
                        {isApproved && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                            <CheckCircle2 className="h-3 w-3" />
                            Approved
                          </span>
                        )}
                        {isRejected && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2.5 py-0.5 text-xs font-semibold text-red-600 dark:text-red-400 border border-red-500/30">
                            <XCircle className="h-3 w-3" />
                            Rejected
                          </span>
                        )}
                      </div>

                      {/* Project and Submitter Details */}
                      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1.5">
                          <FolderKanban className="h-3.5 w-3.5 text-primary" />
                          <span>Project: <strong className="text-foreground">{template.project?.name || "Global / Default"}</strong></span>
                        </div>
                        {template.creator && (
                          <div className="flex items-center gap-1.5">
                            <User className="h-3.5 w-3.5" />
                            <span>Submitted by: <strong className="text-foreground">{template.creator.full_name || template.creator.email}</strong></span>
                          </div>
                        )}
                        <span>Submitted: {new Date(template.created_at).toLocaleString()}</span>
                      </div>

                      {/* Rejection reason banner */}
                      {isRejected && template.rejection_reason && (
                        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400">
                          <strong>Rejection Note:</strong> {template.rejection_reason}
                        </div>
                      )}

                      {/* Message Preview Container */}
                      <div className="max-w-2xl rounded-xl border border-border/80 bg-muted/30 p-4 font-sans text-sm text-foreground shadow-inner">
                        {/* Header Text or Media Indicator */}
                        {template.header_content && (
                          <p className="mb-2 font-semibold text-foreground border-b border-border/50 pb-1.5">
                            {template.header_content}
                          </p>
                        )}
                        {template.header_media_url && (
                          <div className="mb-2.5 flex items-center gap-2 rounded bg-muted/60 p-2 text-xs text-muted-foreground">
                            <FileText className="h-4 w-4 text-primary" />
                            <span className="truncate">{template.header_media_url}</span>
                          </div>
                        )}

                        {/* Body Text */}
                        <p className="whitespace-pre-wrap leading-relaxed text-foreground/90">
                          {template.body_text}
                        </p>

                        {/* Footer */}
                        {template.footer_text && (
                          <p className="mt-2 text-xs text-muted-foreground">
                            {template.footer_text}
                          </p>
                        )}

                        {/* Buttons Preview */}
                        {Array.isArray(template.buttons) && template.buttons.length > 0 && (
                          <div className="mt-3.5 flex flex-wrap gap-2 border-t border-border/60 pt-3">
                            {template.buttons.map((btn, idx) => (
                              <span
                                key={idx}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1 text-xs font-medium text-primary shadow-sm"
                              >
                                {btn.type === "QUICK_REPLY" && <MessageSquare className="h-3 w-3 text-muted-foreground" />}
                                {btn.type === "URL" && <ExternalLink className="h-3 w-3 text-muted-foreground" />}
                                {btn.text}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex shrink-0 flex-row lg:flex-col items-center gap-2">
                      {!isApproved && (
                        <Button
                          size="sm"
                          onClick={() => handleApprove(template)}
                          disabled={actionLoading}
                          className="w-full bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm"
                        >
                          <CheckCircle2 className="mr-1.5 h-4 w-4" />
                          Approve
                        </Button>
                      )}

                      {!isRejected && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setRejectingTemplate(template);
                            setRejectReason(SUGGESTED_REASONS[0]);
                          }}
                          disabled={actionLoading}
                          className="w-full border-red-500/30 text-red-600 hover:bg-red-500/10 dark:text-red-400"
                        >
                          <XCircle className="mr-1.5 h-4 w-4" />
                          Reject
                        </Button>
                      )}

                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDelete(template)}
                        disabled={actionLoading}
                        className="text-muted-foreground hover:bg-muted hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Reject Confirmation Dialog */}
      <Dialog
        open={Boolean(rejectingTemplate)}
        onOpenChange={(open) => {
          if (!open) {
            setRejectingTemplate(null);
            setRejectReason("");
          }
        }}
      >
        <DialogContent className="sm:max-w-lg bg-card border-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-foreground">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              {t("rejectModalTitle")}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {t("rejectModalDesc")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <p className="text-sm font-medium text-foreground">
                Template: <strong className="text-primary">{rejectingTemplate?.name}</strong>
              </p>
              <p className="text-xs text-muted-foreground">
                Project: {rejectingTemplate?.project?.name || "Global"}
              </p>
            </div>

            {/* Quick Reason Suggestions */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground">
                Quick Reason Presets:
              </Label>
              <div className="flex flex-wrap gap-1.5">
                {SUGGESTED_REASONS.map((preset, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setRejectReason(preset)}
                    className={cn(
                      "rounded-md border border-border px-2.5 py-1 text-xs text-left transition-colors",
                      rejectReason === preset
                        ? "bg-primary/10 border-primary text-primary font-medium"
                        : "bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="rejectReason" className="text-xs font-semibold text-foreground">
                {t("reasonLabel")}
              </Label>
              <Textarea
                id="rejectReason"
                rows={3}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder={t("reasonPlaceholder")}
                className="text-sm"
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => {
                setRejectingTemplate(null);
                setRejectReason("");
              }}
            >
              {t("cancel")}
            </Button>
            <Button
              onClick={handleConfirmReject}
              disabled={actionLoading || !rejectReason.trim()}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {actionLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t("confirmReject")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
