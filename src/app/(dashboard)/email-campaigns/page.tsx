"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  Mail,
  MousePointerClick,
  Eye,
  Reply,
  Send,
  Trash2,
  Plus,
  Loader2,
  AlertTriangle,
  Copy,
  Check,
  ExternalLink,
  UserPlus,
  CopyPlus,
  Sparkles,
  FileText,
  BookmarkPlus,
  Users,
  Search,
  ChevronDown,
  ChevronUp,
  Upload,
  Download,
  X,
  HelpCircle,
  CheckCircle,
  MessageSquare,
  Webhook,
  RefreshCw,
  BellRing,
  CalendarClock,
  Clock,
  Calendar,
  SendHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";

async function getEmailAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  try {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session?.access_token) {
      headers["Authorization"] = `Bearer ${session.access_token}`;
    }
  } catch {
    // Ignore fallback
  }
  return headers;
}

import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  ensureEmailHtml,
  mergeImportedRecipientsText,
  parseEmailImportText,
  parseRecipientInput,
  reconcileRecipientsWithMetadata,
  sanitizeSenderName,
  SAMPLE_EMAIL_IMPORT_CSV,
  STARTER_EMAIL_TEMPLATES,
  type ParsedRecipient,
  type SavedCustomEmailTemplate,
} from "@/lib/email/campaign-helpers";

interface Campaign {
  id: string;
  name: string;
  subject: string;
  body_html: string;
  body_text?: string | null;
  from_name?: string | null;
  status: string;
  total_recipients: number;
  sent_count: number;
  opened_count: number;
  clicked_count: number;
  replied_count: number;
  failed_count: number;
  track_opens?: boolean | null;
  track_clicks?: boolean | null;
  scheduled_at?: string | null;
  parent_campaign_id?: string | null;
  is_followup?: boolean | null;
  followup_type?: string | null;
  created_at: string;
  sent_at: string | null;
}

interface CampaignRecipientRow {
  id: string;
  email: string;
  name: string | null;
  status: string;
  sent_at: string | null;
  open_count: number;
  click_count: number;
  replied_at: string | null;
  error_message: string | null;
}

interface AvailableContact {
  id: string;
  email: string;
  name: string | null;
}

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-muted text-muted-foreground border-border",
  sending: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  sent: "bg-green-500/10 text-green-600 border-green-500/20",
  failed: "bg-destructive/10 text-destructive border-destructive/20",
  pending: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  scheduled: "bg-purple-500/10 text-purple-600 border-purple-500/20",
};

const EMAIL_MIGRATION_SQL = `-- 056_email_campaigns_and_configs.sql
CREATE TABLE IF NOT EXISTS public.email_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
    smtp_host TEXT NOT NULL,
    smtp_port INTEGER NOT NULL DEFAULT 587,
    smtp_secure BOOLEAN NOT NULL DEFAULT false,
    smtp_user TEXT NOT NULL,
    smtp_pass TEXT NOT NULL,
    from_name TEXT NOT NULL DEFAULT 'MaSa CRM',
    from_email TEXT NOT NULL,
    reply_to TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (account_id, project_id)
);

CREATE TABLE IF NOT EXISTS public.email_campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    subject TEXT NOT NULL,
    body_html TEXT NOT NULL,
    body_text TEXT,
    from_name TEXT,
    from_email TEXT,
    reply_to TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    total_recipients INTEGER NOT NULL DEFAULT 0,
    sent_count INTEGER NOT NULL DEFAULT 0,
    delivered_count INTEGER NOT NULL DEFAULT 0,
    opened_count INTEGER NOT NULL DEFAULT 0,
    clicked_count INTEGER NOT NULL DEFAULT 0,
    replied_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    track_opens BOOLEAN NOT NULL DEFAULT true,
    track_clicks BOOLEAN NOT NULL DEFAULT true,
    audience_filter JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ensure nullable project_id and all columns in case table was created with different constraints
ALTER TABLE public.email_campaigns ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE public.email_campaigns
  ADD COLUMN IF NOT EXISTS reply_to      TEXT,
  ADD COLUMN IF NOT EXISTS from_name     TEXT,
  ADD COLUMN IF NOT EXISTS from_email    TEXT,
  ADD COLUMN IF NOT EXISTS body_text     TEXT,
  ADD COLUMN IF NOT EXISTS track_opens   BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS track_clicks  BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS replied_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS scheduled_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sent_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS parent_campaign_id UUID REFERENCES public.email_campaigns(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_followup   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS followup_type TEXT;

CREATE TABLE IF NOT EXISTS public.email_campaign_recipients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES public.email_campaigns(id) ON DELETE CASCADE,
    contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
    email TEXT NOT NULL,
    name TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    tracking_token TEXT,
    error_message TEXT,
    message_id TEXT,
    sent_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    opened_at TIMESTAMPTZ,
    clicked_at TIMESTAMPTZ,
    open_count INTEGER NOT NULL DEFAULT 0,
    click_count INTEGER NOT NULL DEFAULT 0,
    first_opened_at TIMESTAMPTZ,
    first_clicked_at TIMESTAMPTZ,
    replied_at TIMESTAMPTZ,
    conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.email_campaign_recipients
  ADD COLUMN IF NOT EXISTS tracking_token   TEXT,
  ADD COLUMN IF NOT EXISTS open_count       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS click_count      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS first_opened_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS first_clicked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS replied_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS conversation_id  UUID REFERENCES public.conversations(id) ON DELETE SET NULL;

ALTER TABLE public.email_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_campaign_recipients ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE public.email_configs TO service_role, postgres, authenticated;
GRANT ALL ON TABLE public.email_campaigns TO service_role, postgres, authenticated;
GRANT ALL ON TABLE public.email_campaign_recipients TO service_role, postgres, authenticated;

NOTIFY pgrst, 'reload schema';
`;

function wrapPreviewHtml(rawBody: string): string {
  const formatted = ensureEmailHtml(rawBody);
  return `<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;line-height:1.55;color:#111827;background:#ffffff;margin:0;padding:16px;word-break:break-word;">${formatted || "<p style='color:#6b7280'>Preview is empty</p>"}</body></html>`;
}

function getTemplatesStorageKey(projectId: string | null | undefined): string {
  return `masacrm_email_templates_${projectId || "default"}`;
}

const emptySubscribe = () => () => {};

function downloadSampleEmailCsv() {
  const blob = new Blob([SAMPLE_EMAIL_IMPORT_CSV], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "email-recipients-sample.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function RecipientImportBar({
  value,
  onChange,
  parsedCount,
  onImportRecipients,
}: {
  value: string;
  onChange: (next: string) => void;
  parsedCount: number;
  onImportRecipients?: (recipients: ParsedRecipient[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (/\.(xlsx|xls)$/i.test(file.name)) {
      toast.error(
        "Excel (.xlsx/.xls) files are binary — save as CSV (.csv) in Excel or Google Sheets and import the .csv file.",
      );
      return;
    }

    try {
      const text = await file.text();
      if (text.startsWith("PK\u0003\u0004") || text.startsWith("\uFFFD")) {
        toast.error("Unsupported binary file — please upload a UTF-8 .csv, .tsv, or .txt file.");
        return;
      }

      const result = parseEmailImportText(text);
      if (result.recipients.length === 0) {
        toast.error("No valid email addresses found in the uploaded file.");
        return;
      }

      onImportRecipients?.(result.recipients);
      onChange(mergeImportedRecipientsText(value, result.recipients));
      toast.success(
        `Imported ${result.recipients.length} email(s) from ${file.name}` +
          (result.skippedCount > 0 ? ` (${result.skippedCount} duplicate/invalid skipped)` : ""),
      );
    } catch {
      toast.error("Failed to read uploaded file.");
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.txt,.tsv,text/csv,text/plain"
          className="hidden"
          onChange={handleFileChange}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 px-2.5 text-xs gap-1.5"
          onClick={() => inputRef.current?.click()}
        >
          <Upload className="h-3.5 w-3.5" />
          Import CSV / TXT
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground"
          onClick={downloadSampleEmailCsv}
          title="Download sample CSV with name,email,company_name columns"
        >
          <Download className="h-3 w-3" />
          Sample CSV
        </Button>
        {value.trim() && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-destructive"
            onClick={() => {
              onChange("");
              onImportRecipients?.([]);
            }}
          >
            <X className="h-3 w-3" />
            Clear
          </Button>
        )}
      </div>
      {value.trim() && (
        <span className="text-xs text-muted-foreground">
          {parsedCount} valid email{parsedCount === 1 ? "" : "s"} detected
        </span>
      )}
    </div>
  );
}

export default function EmailCampaignsPage() {
  const { activeProjectId } = useAuth();
  const isLocalhost = useSyncExternalStore(
    emptySubscribe,
    () => typeof window !== "undefined" && window.location.hostname === "localhost",
    () => false,
  );

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [tableMissing, setTableMissing] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);

  // Saved templates UI & modal state
  const [showTemplates, setShowTemplates] = useState(true);
  const [savedTemplates, setSavedTemplates] = useState<SavedCustomEmailTemplate[]>([]);

  // New / Reuse Campaign modal state
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [bodyMode, setBodyMode] = useState<"write" | "preview">("write");

  const [defaultSenderName, setDefaultSenderName] = useState("");
  const [defaultFromEmail, setDefaultFromEmail] = useState("");
  const [name, setName] = useState("");
  const [fromName, setFromName] = useState("");
  const [subject, setSubject] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [recipients, setRecipients] = useState("");
  const [importedRecipients, setImportedRecipients] = useState<ParsedRecipient[]>([]);
  const [trackOpens, setTrackOpens] = useState(true);
  const [trackClicks, setTrackClicks] = useState(true);

  // Send Again / Add Emails modal state
  const [sendMoreCampaign, setSendMoreCampaign] = useState<Campaign | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [campaignRecipients, setCampaignRecipients] = useState<CampaignRecipientRow[]>([]);
  const [availableContacts, setAvailableContacts] = useState<AvailableContact[]>([]);
  const [addEmailsText, setAddEmailsText] = useState("");
  const [importedSendMoreRecipients, setImportedSendMoreRecipients] = useState<ParsedRecipient[]>([]);
  const [selectedContactIds, setSelectedContactIds] = useState<Set<string>>(new Set());
  const [contactSearch, setContactSearch] = useState("");
  const [allowResendExisting, setAllowResendExisting] = useState(false);
  const [showTemplatePreviewInModal, setShowTemplatePreviewInModal] = useState(false);
  const [addingRecipients, setAddingRecipients] = useState(false);
  const [recordingLeadId, setRecordingLeadId] = useState<string | null>(null);
  const [showLeadHelp, setShowLeadHelp] = useState(false);
  const [showInboundModal, setShowInboundModal] = useState(false);
  const [testInboundEmail, setTestInboundEmail] = useState("");
  const [testInboundSubject, setTestInboundSubject] = useState("Re: Quick question about our onboarding");
  const [testInboundText, setTestInboundText] = useState("Hello! We received your outreach and would love to move forward with your team.");
  const [testingInbound, setTestingInbound] = useState(false);
  const [inboundTestResult, setInboundTestResult] = useState<{
    success: boolean;
    leadRecorded?: boolean;
    message: string;
    conversationId?: string;
  } | null>(null);
  const [copiedWebhookUrl, setCopiedWebhookUrl] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [syncingMailbox, setSyncingMailbox] = useState(false);

  // Follow-Up & Reminder state
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [followUpParentCampaign, setFollowUpParentCampaign] = useState<Campaign | null>(null);
  const [loadingFollowUpStats, setLoadingFollowUpStats] = useState(false);
  const [submittingFollowUp, setSubmittingFollowUp] = useState(false);
  const [followUpFilter, setFollowUpFilter] = useState<"non_repliers" | "unopened" | "opened_not_replied">("non_repliers");
  const [followUpTiming, setFollowUpTiming] = useState<"now" | "scheduled">("now");
  const [followUpScheduledAt, setFollowUpScheduledAt] = useState("");
  const [followUpName, setFollowUpName] = useState("");
  const [followUpSubject, setFollowUpSubject] = useState("");
  const [followUpBodyHtml, setFollowUpBodyHtml] = useState("");
  const [followUpBodyMode, setFollowUpBodyMode] = useState<"write" | "preview">("write");
  const [followUpKeepThread, setFollowUpKeepThread] = useState(true);
  const [followUpStats, setFollowUpStats] = useState<{
    counts: {
      totalSent: number;
      nonRepliers: number;
      unopened: number;
      openedNotReplied: number;
      replied: number;
    };
    recipients: Array<{
      id: string;
      email: string;
      name: string | null;
      openCount: number;
      repliedAt: string | null;
      status: string;
    }>;
  } | null>(null);
  const [selectedFollowUpIds, setSelectedFollowUpIds] = useState<Set<string>>(new Set());
  const [followUpSearch, setFollowUpSearch] = useState("");
  const [showFollowUpRecipientsList, setShowFollowUpRecipientsList] = useState(false);

  // Bumped to re-run the fetch effect after a create/send/delete.
  const [reloadKey, setReloadKey] = useState(0);
  const load = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let ignore = false;

    // Sweep due scheduled reminders in background
    void fetch("/api/email/campaigns/scheduled", { method: "POST" })
      .then((r) => r.json())
      .then((data) => {
        if (data.processed > 0 && !ignore) {
          toast.info(`Dispatched ${data.processed} due scheduled reminder(s)`);
          setReloadKey((k) => k + 1);
        }
      })
      .catch(() => {});

    async function fetchCampaigns() {
      try {
        setLoading(true);
        const url = activeProjectId
          ? `/api/email/campaigns?projectId=${encodeURIComponent(activeProjectId)}`
          : "/api/email/campaigns";
        const res = await fetch(url);
        const data = await res.json();
        if (!ignore) {
          setTableMissing(Boolean(data.table_missing));
          setCampaigns(data.campaigns ?? []);
        }
      } catch (err) {
        if (ignore) return;
        console.error("[email-campaigns] load error:", err);
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    async function fetchEmailConfig() {
      try {
        const configUrl =
          activeProjectId && activeProjectId !== "all"
            ? `/api/email/config?project_id=${encodeURIComponent(activeProjectId)}`
            : "/api/email/config";
        const res = await fetch(configUrl);
        if (!res.ok) return;
        const data = await res.json();
        if (!ignore) {
          setDefaultSenderName(data?.configured ? data?.config?.fromName || "" : "");
          setDefaultFromEmail(data?.configured ? data?.config?.fromEmail || "" : "");
        }
      } catch {
        // Ignore email config preview errors
      }
    }

    async function loadSavedTemplates() {
      try {
        const raw = localStorage.getItem(getTemplatesStorageKey(activeProjectId));
        const parsed = raw ? (JSON.parse(raw) as SavedCustomEmailTemplate[]) : [];
        if (!ignore) {
          setSavedTemplates(Array.isArray(parsed) ? parsed : []);
        }
      } catch {
        if (!ignore) setSavedTemplates([]);
      }
    }

    void fetchCampaigns();
    void fetchEmailConfig();
    void loadSavedTemplates();

    return () => {
      ignore = true;
    };
  }, [reloadKey, activeProjectId]);

  const persistSavedTemplates = (next: SavedCustomEmailTemplate[]) => {
    setSavedTemplates(next);
    try {
      localStorage.setItem(getTemplatesStorageKey(activeProjectId), JSON.stringify(next));
    } catch {
      // Ignore storage quota errors
    }
  };

  const copySql = () => {
    navigator.clipboard.writeText(EMAIL_MIGRATION_SQL);
    setCopiedSql(true);
    toast.success("SQL Migration copied to clipboard!");
    setTimeout(() => setCopiedSql(false), 3000);
  };

  const resetForm = () => {
    setName("");
    setFromName(defaultSenderName);
    setSubject("");
    setBodyHtml("");
    setRecipients("");
    setImportedRecipients([]);
    setTrackOpens(true);
    setTrackClicks(true);
    setBodyMode("write");
  };

  const openNewWithTemplate = (template: {
    name?: string;
    fromName?: string | null;
    subject: string;
    bodyHtml: string;
    trackOpens?: boolean;
    trackClicks?: boolean;
  }) => {
    setName(template.name ?? "");
    setFromName(template.fromName ?? defaultSenderName);
    setSubject(template.subject);
    setBodyHtml(template.bodyHtml);
    setRecipients("");
    setTrackOpens(template.trackOpens !== false);
    setTrackClicks(template.trackClicks !== false);
    setBodyMode("write");
    setOpen(true);
  };

  const applyTemplateIntoOpenModal = (template: {
    defaultCampaignName?: string;
    fromName?: string | null;
    subject: string;
    bodyHtml: string;
  }) => {
    if (!name.trim() && template.defaultCampaignName) {
      setName(template.defaultCampaignName);
    }
    if (template.fromName !== undefined) {
      setFromName(template.fromName || defaultSenderName);
    }
    setSubject(template.subject);
    setBodyHtml(template.bodyHtml);
    setBodyMode("write");
    toast.success("Template loaded into editor");
  };

  const handleSaveAsTemplate = () => {
    const cleanSubject = subject.trim();
    const cleanBody = bodyHtml.trim();
    if (!cleanSubject || !cleanBody) {
      toast.error("Enter a subject line and body first to save as a template");
      return;
    }

    const templateName = name.trim() || cleanSubject.slice(0, 50);
    const cleanSender = sanitizeSenderName(fromName);
    const nextItem: SavedCustomEmailTemplate = {
      id: `custom-${Date.now()}`,
      name: templateName,
      subject: cleanSubject,
      bodyHtml,
      ...(cleanSender ? { fromName: cleanSender } : {}),
      updatedAt: new Date().toISOString(),
    };
    const next = [nextItem, ...savedTemplates.filter((t) => t.name !== templateName)];
    persistSavedTemplates(next);
    toast.success(`Saved "${templateName}" to your Email Templates`);
  };

  const handleDeleteSavedTemplate = (id: string) => {
    persistSavedTemplates(savedTemplates.filter((t) => t.id !== id));
    toast.success("Removed saved template");
  };

  const parsedNewEmails = useMemo(() => parseRecipientInput(recipients), [recipients]);

  const detectedCustomTags = useMemo(() => {
    const tags = new Set<string>();
    for (const r of importedRecipients) {
      if (r.metadata) {
        for (const k of Object.keys(r.metadata)) {
          if (/^[a-zA-Z0-9_]+$/.test(k)) {
            tags.add(k.toLowerCase());
          }
        }
      }
    }
    tags.delete("email");
    tags.delete("name");
    return Array.from(tags);
  }, [importedRecipients]);

  const insertMergeTag = (tag: string) => {
    const textToInsert = `{{${tag}}}`;
    setBodyHtml((prev) => (prev ? `${prev} ${textToInsert}` : textToInsert));
    toast.success(`Inserted {{${tag}}} into email body`);
  };

  const submitNewCampaign = async (sendImmediately: boolean) => {
    if (submitting) return;

    if (!name.trim() || !subject.trim() || !bodyHtml.trim()) {
      toast.error("Name, subject and body are all required");
      return;
    }

    setSubmitting(true);
    try {
      const audience = reconcileRecipientsWithMetadata(recipients, importedRecipients);

      const authHeaders = await getEmailAuthHeaders();
      const cleanSenderName = sanitizeSenderName(fromName);
      const res = await fetch("/api/email/campaigns", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          name: name.trim(),
          subject: subject.trim(),
          bodyHtml,
          trackOpens,
          trackClicks,
          projectId: activeProjectId || undefined,
          ...(cleanSenderName ? { fromName: cleanSenderName } : {}),
          ...(audience.length > 0 ? { recipients: audience } : {}),
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        if (data.table_missing) {
          setTableMissing(true);
        }
        toast.error(data.error ?? "Failed to create campaign");
        return;
      }

      const createdCampaign = data.campaign as Campaign | undefined;
      if (sendImmediately && createdCampaign?.id) {
        if ((createdCampaign.total_recipients ?? 0) === 0) {
          toast.warning("Draft created, but 0 valid recipients were found to send.");
        } else {
          const sendRes = await fetch(`/api/email/campaigns/${createdCampaign.id}/send`, {
            method: "POST",
            headers: authHeaders,
          });
          const sendData = await sendRes.json();
          if (!sendRes.ok) {
            toast.error(sendData.error ?? "Draft created, but sending failed");
          } else {
            toast.success(
              `Sent ${sendData.sent} of ${sendData.total} — ${sendData.failed} failed`,
            );
          }
        }
      } else {
        toast.success(
          `Draft created with ${createdCampaign?.total_recipients ?? 0} recipient(s)`,
        );
      }

      setOpen(false);
      resetForm();
      void load();
    } catch (err) {
      console.error("[email-campaigns] create error:", err);
      toast.error("Network error while creating campaign");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSend = async (campaign: Campaign) => {
    if (sendingId) return;
    setSendingId(campaign.id);
    try {
      const authHeaders = await getEmailAuthHeaders();
      const res = await fetch(`/api/email/campaigns/${campaign.id}/send`, {
        method: "POST",
        headers: authHeaders,
      });
      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error ?? "Failed to send campaign");
        return;
      }

      toast.success(`Sent ${data.sent} of ${data.total} — ${data.failed} failed`);
      void load();
    } catch (err) {
      console.error("[email-campaigns] send error:", err);
      toast.error("Network error while sending");
    } finally {
      setSendingId(null);
    }
  };

  const handleDelete = async (campaign: Campaign) => {
    try {
      const res = await fetch(`/api/email/campaigns/${campaign.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Failed to delete campaign");
        return;
      }
      toast.success("Campaign deleted");
      void load();
    } catch {
      toast.error("Network error while deleting");
    }
  };

  const openFollowUpDialog = async (c: Campaign) => {
    setFollowUpParentCampaign(c);
    setFollowUpFilter("non_repliers");
    setFollowUpTiming("now");
    setFollowUpKeepThread(true);
    setFollowUpBodyMode("write");
    setShowFollowUpRecipientsList(false);
    setFollowUpSearch("");
    setFollowUpName(`${c.name} — Quick Follow-Up`);
    setFollowUpSubject(c.subject.startsWith("Re:") ? c.subject : `Re: ${c.subject}`);

    // Default scheduled time to tomorrow at 10:00 AM local time
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(10, 0, 0, 0);
    const tzOffset = tomorrow.getTimezoneOffset() * 60000;
    const localISOTime = new Date(tomorrow.getTime() - tzOffset).toISOString().slice(0, 16);
    setFollowUpScheduledAt(localISOTime);

    // Pre-fill body from starter follow-up template or default bump
    const starterFollowup = STARTER_EMAIL_TEMPLATES.find((t) => t.id === "regibiz-followup");
    if (starterFollowup) {
      setFollowUpBodyHtml(starterFollowup.bodyHtml);
    } else {
      setFollowUpBodyHtml(
        `<p>Hi {{name}},</p>\n<p>Just following up on my previous note regarding <strong>${c.subject}</strong>.</p>\n<p>Wanted to check if you had a chance to review it, and see if you have any questions.</p>\n<p>Would you be open to a quick 5-minute call this week?</p>\n<p>Best regards,<br/>${c.from_name || defaultSenderName || "Our Team"}</p>`
      );
    }

    setFollowUpOpen(true);
    setLoadingFollowUpStats(true);
    try {
      const res = await fetch(`/api/email/campaigns/${c.id}/follow-up`);
      const data = await res.json();
      if (res.ok && data.counts) {
        setFollowUpStats(data);
        const defaultIds = new Set<string>();
        for (const r of data.recipients || []) {
          if (!r.repliedAt) defaultIds.add(r.id);
        }
        setSelectedFollowUpIds(defaultIds);
      } else {
        toast.error(data.error ?? "Could not load follow-up metrics");
      }
    } catch {
      toast.error("Network error while loading follow-up metrics");
    } finally {
      setLoadingFollowUpStats(false);
    }
  };

  const handleFollowUpFilterChange = (filter: "non_repliers" | "unopened" | "opened_not_replied") => {
    setFollowUpFilter(filter);
    if (!followUpStats?.recipients) return;

    const nextIds = new Set<string>();
    for (const r of followUpStats.recipients) {
      if (r.repliedAt) continue;
      if (filter === "unopened" && r.openCount === 0) {
        nextIds.add(r.id);
      } else if (filter === "opened_not_replied" && r.openCount > 0) {
        nextIds.add(r.id);
      } else if (filter === "non_repliers") {
        nextIds.add(r.id);
      }
    }
    setSelectedFollowUpIds(nextIds);
  };

  const setQuickSchedule = (daysFromNow: number, hour = 10) => {
    const d = new Date();
    d.setDate(d.getDate() + daysFromNow);
    d.setHours(hour, 0, 0, 0);
    const tzOffset = d.getTimezoneOffset() * 60000;
    const local = new Date(d.getTime() - tzOffset).toISOString().slice(0, 16);
    setFollowUpScheduledAt(local);
  };

  const submitFollowUp = async () => {
    if (!followUpParentCampaign || submittingFollowUp) return;

    if (!followUpSubject.trim()) {
      toast.error("Please enter a follow-up subject line.");
      return;
    }

    if (!followUpBodyHtml.trim()) {
      toast.error("Please write the follow-up email content.");
      return;
    }

    if (selectedFollowUpIds.size === 0) {
      toast.error("Please select at least 1 recipient to receive this follow-up.");
      return;
    }

    if (followUpTiming === "scheduled" && !followUpScheduledAt) {
      toast.error("Please choose a schedule date & time for the reminder.");
      return;
    }

    setSubmittingFollowUp(true);
    try {
      const res = await fetch(`/api/email/campaigns/${followUpParentCampaign.id}/follow-up`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: followUpName.trim() || `${followUpParentCampaign.name} — Follow-Up`,
          subject: followUpSubject.trim(),
          bodyHtml: followUpBodyHtml,
          fromName: followUpParentCampaign.from_name || defaultSenderName,
          targetFilter: followUpFilter,
          selectedRecipientIds: Array.from(selectedFollowUpIds),
          timing: followUpTiming,
          scheduledAt: followUpTiming === "scheduled" ? new Date(followUpScheduledAt).toISOString() : undefined,
          keepThread: followUpKeepThread,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to create follow-up campaign");
        return;
      }

      if (data.timing === "now") {
        toast.success(`Follow-up sent to ${data.sent} recipient(s)` + (data.failed > 0 ? ` (${data.failed} failed)` : ""));
      } else {
        toast.success(`Follow-up reminder scheduled for ${new Date(followUpScheduledAt).toLocaleString()}`);
      }

      setFollowUpOpen(false);
      void load();
    } catch {
      toast.error("Network error while creating follow-up");
    } finally {
      setSubmittingFollowUp(false);
    }
  };

  const openSendMoreDialog = async (campaign: Campaign) => {
    setSendMoreCampaign(campaign);
    setAddEmailsText("");
    setSelectedContactIds(new Set());
    setContactSearch("");
    setAllowResendExisting(false);
    setShowTemplatePreviewInModal(false);
    setCampaignRecipients([]);
    setAvailableContacts([]);
    setLoadingDetail(true);

    try {
      const res = await fetch(`/api/email/campaigns/${campaign.id}`);
      const data = await res.json();
      if (res.ok) {
        if (data.campaign) setSendMoreCampaign(data.campaign);
        setCampaignRecipients(data.recipients ?? []);
        setAvailableContacts(data.availableContacts ?? []);
      } else {
        toast.error(data.error ?? "Could not load campaign recipients");
      }
    } catch {
      toast.error("Network error while loading campaign details");
    } finally {
      setLoadingDetail(false);
    }
  };

  const recipientStatusByEmail = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of campaignRecipients) {
      const email = r.email.toLowerCase();
      const prev = map.get(email);
      if (prev === "pending" || !prev) {
        map.set(email, r.status);
      } else if (r.status === "sent") {
        map.set(email, "sent");
      }
    }
    return map;
  }, [campaignRecipients]);

  const parsedAddEmails = useMemo(
    () => parseRecipientInput(addEmailsText),
    [addEmailsText],
  );

  const alreadySentConflicts = useMemo(() => {
    if (allowResendExisting) return 0;
    let count = 0;
    for (const parsed of parsedAddEmails) {
      const st = recipientStatusByEmail.get(parsed.email);
      if (st && st !== "pending") count += 1;
    }
    return count;
  }, [parsedAddEmails, recipientStatusByEmail, allowResendExisting]);

  const filteredAvailableContacts = useMemo(() => {
    const q = contactSearch.trim().toLowerCase();
    if (!q) return availableContacts;
    return availableContacts.filter(
      (c) =>
        c.email.toLowerCase().includes(q) ||
        (c.name && c.name.toLowerCase().includes(q)),
    );
  }, [availableContacts, contactSearch]);

  const unsentContacts = useMemo(
    () => availableContacts.filter((c) => !recipientStatusByEmail.has(c.email.toLowerCase())),
    [availableContacts, recipientStatusByEmail],
  );

  const pendingInModal = useMemo(
    () => campaignRecipients.filter((r) => r.status === "pending").length,
    [campaignRecipients],
  );

  const toggleContactId = (id: string) => {
    setSelectedContactIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleQueueAndOptionallySend = async (sendNow: boolean) => {
    if (!sendMoreCampaign || addingRecipients) return;

    const rawLines = addEmailsText
      .split(/[\r\n,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const hasNewInputs = rawLines.length > 0 || selectedContactIds.size > 0;

    if (!hasNewInputs && (!sendNow || pendingInModal === 0)) {
      toast.error("Paste at least one email address or select a CRM contact.");
      return;
    }

    setAddingRecipients(true);
    try {
      let queuedOrPending = pendingInModal;

      if (hasNewInputs) {
        const audience = reconcileRecipientsWithMetadata(addEmailsText, importedSendMoreRecipients);
        const res = await fetch(`/api/email/campaigns/${sendMoreCampaign.id}/recipients`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recipients: audience.length > 0 ? audience : rawLines,
            contactIds: Array.from(selectedContactIds),
            allowResendExisting,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          toast.error(data.error ?? "Failed to queue recipients");
          return;
        }

        queuedOrPending = data.pendingCount ?? data.addedCount ?? 0;

        if ((data.addedCount ?? 0) === 0 && !sendNow) {
          toast.warning(
            data.skippedAlreadySent > 0
              ? `Skipped ${data.skippedAlreadySent} already-sent address(es). Check "Allow resending" to send again.`
              : "No new recipients were added.",
          );
          return;
        }

        if ((data.addedCount ?? 0) === 0 && queuedOrPending === 0) {
          toast.warning(
            data.skippedAlreadySent > 0
              ? `All ${data.skippedAlreadySent} entered address(es) already received this campaign. Enable "Allow resending" below to send again.`
              : "No pending recipients to send.",
          );
          return;
        }

        if (!sendNow) {
          toast.success(
            `Queued ${data.addedCount} email(s)` +
              (data.skippedAlreadySent > 0
                ? ` (${data.skippedAlreadySent} already sent skipped)`
                : ""),
          );
        }
      }

      if (sendNow) {
        const sendRes = await fetch(`/api/email/campaigns/${sendMoreCampaign.id}/send`, {
          method: "POST",
        });
        const sendData = await sendRes.json();
        if (!sendRes.ok) {
          toast.error(sendData.error ?? "Failed to send campaign");
          return;
        }
        toast.success(`Sent ${sendData.sent} of ${sendData.total} — ${sendData.failed} failed`);
        setSendMoreCampaign(null);
      } else {
        await openSendMoreDialog(sendMoreCampaign);
      }

      void load();
    } catch (err) {
      console.error("[email-campaigns] add & send error:", err);
      toast.error("Network error while updating campaign recipients");
    } finally {
      setAddingRecipients(false);
    }
  };

  const handleRecordLead = async (campaignId: string, recipientId: string, email: string) => {
    if (recordingLeadId) return;
    setRecordingLeadId(recipientId);
    try {
      const res = await fetch(`/api/email/campaigns/${campaignId}/record-lead`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientId, email }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to record lead");
        return;
      }
      toast.success(data.message || `Lead recorded for ${email}!`);
      // Update local recipient status to replied
      setCampaignRecipients((prev) =>
        prev.map((r) =>
          r.id === recipientId
            ? { ...r, status: "replied", replied_at: new Date().toISOString() }
            : r,
        ),
      );
      // Update campaign in list and in modal
      setCampaigns((prev) =>
        prev.map((c) =>
          c.id === campaignId ? { ...c, replied_count: (c.replied_count || 0) + 1 } : c,
        ),
      );
      setSendMoreCampaign((prev) =>
        prev && prev.id === campaignId
          ? { ...prev, replied_count: (prev.replied_count || 0) + 1 }
          : prev,
      );
    } catch {
      toast.error("Network error recording lead");
    } finally {
      setRecordingLeadId(null);
    }
  };

  const handleTestInbound = async () => {
    if (!testInboundEmail || !testInboundEmail.includes("@")) {
      toast.error("Please enter a valid email address to test");
      return;
    }
    setTestingInbound(true);
    setInboundTestResult(null);
    try {
      const res = await fetch("/api/email/inbound/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromEmail: testInboundEmail.trim(),
          subject: testInboundSubject.trim(),
          text: testInboundText.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Inbound webhook test failed");
        setInboundTestResult({ success: false, message: data.error || "Inbound test failed" });
        return;
      }
      toast.success(data.message || "Inbound email reply recorded!");
      setInboundTestResult({
        success: true,
        leadRecorded: data.inboundResult?.leadRecorded,
        conversationId: data.inboundResult?.conversationId,
        message: data.message,
      });
      void load();
      if (sendMoreCampaign) {
        void openSendMoreDialog(sendMoreCampaign);
      }
    } catch {
      toast.error("Network error testing inbound webhook");
      setInboundTestResult({ success: false, message: "Network connection failed" });
    } finally {
      setTestingInbound(false);
    }
  };

  const handleSyncMailbox = async () => {
    if (syncingMailbox) return;
    setSyncingMailbox(true);
    try {
      const res = await fetch("/api/email/sync-mailbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to sync mailbox");
        return;
      }
      toast.success(
        data.message ||
          `Mailbox synced (${data.scannedCount} emails scanned, ${data.newLeadsCount} new leads)!`,
      );
      void load();
      if (sendMoreCampaign) {
        void openSendMoreDialog(sendMoreCampaign);
      }
    } catch {
      toast.error("Network error syncing mailbox");
    } finally {
      setSyncingMailbox(false);
    }
  };

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Email Campaigns</h1>
          <p className="text-sm text-muted-foreground">
            Send tracked emails with reusable templates, repeat batches, and lead conversion.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="default"
            onClick={handleSyncMailbox}
            disabled={syncingMailbox}
            className="bg-emerald-600 text-white hover:bg-emerald-500 shadow-sm"
            title="Scan info@cloudmasa.com Gmail inbox directly to fetch customer replies and record Leads"
          >
            {syncingMailbox ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            {syncingMailbox ? "Syncing Gmail..." : "Sync Mailbox (Fetch Replies)"}
          </Button>
          <Button
            variant="outline"
            onClick={() => setShowInboundModal(true)}
            className="border-primary/40 text-primary hover:bg-primary/10"
          >
            <Webhook className="mr-2 h-4 w-4" />
            Inbound Webhook (Option 2)
          </Button>
          <Button
            variant="outline"
            onClick={() => setShowLeadHelp(true)}
            className="border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400"
          >
            <HelpCircle className="mr-2 h-4 w-4 text-emerald-500" />
            How Leads & Tracking Work
          </Button>
          <Button
            variant="outline"
            onClick={() => setShowTemplates((v) => !v)}
          >
            <FileText className="mr-2 h-4 w-4" />
            {showTemplates ? "Hide Templates" : "Templates"}
          </Button>
          <Button
            onClick={() => {
              resetForm();
              setOpen(true);
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            New Campaign
          </Button>
        </div>
      </div>

      {showTemplates && (
        <div className="space-y-3 rounded-xl border bg-card/60 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold">Reusable Email Templates</h2>
              <span className="text-xs text-muted-foreground">
                Load a RegiBIZ starter or saved template straight into a campaign
              </span>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            {STARTER_EMAIL_TEMPLATES.map((tpl) => (
              <div
                key={tpl.id}
                className="flex flex-col justify-between rounded-lg border bg-background p-3 text-sm"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium line-clamp-1">{tpl.name}</span>
                    <Badge variant="secondary" className="text-[10px]">
                      {tpl.category}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {tpl.description}
                  </p>
                </div>
                <div className="mt-3 flex justify-end">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() =>
                      openNewWithTemplate({
                        name: tpl.defaultCampaignName,
                        subject: tpl.subject,
                        bodyHtml: tpl.bodyHtml,
                      })
                    }
                  >
                    <CopyPlus className="mr-1.5 h-3 w-3" />
                    Use Template
                  </Button>
                </div>
              </div>
            ))}

            {savedTemplates.map((tpl) => (
              <div
                key={tpl.id}
                className="flex flex-col justify-between rounded-lg border border-primary/25 bg-background p-3 text-sm"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium line-clamp-1">{tpl.name}</span>
                    <Badge variant="outline" className="text-[10px]">
                      Saved
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {tpl.subject}
                  </p>
                </div>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={() => handleDeleteSavedTemplate(tpl.id)}
                    title="Delete saved template"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() =>
                      openNewWithTemplate({
                        name: tpl.name,
                        fromName: tpl.fromName,
                        subject: tpl.subject,
                        bodyHtml: tpl.bodyHtml,
                      })
                    }
                  >
                    <CopyPlus className="mr-1.5 h-3 w-3" />
                    Use Template
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tableMissing && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-900 dark:text-amber-200">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-500" />
            <div className="flex-1 space-y-2">
              <div className="text-sm font-semibold">
                Database Tables Missing: Email Campaigns Migration Required
              </div>
              <p className="text-xs leading-relaxed opacity-90">
                The database tables for email campaigns (
                <code className="rounded bg-amber-500/20 px-1 py-0.5 font-mono">
                  email_campaigns
                </code>{" "}
                and{" "}
                <code className="rounded bg-amber-500/20 px-1 py-0.5 font-mono">
                  email_campaign_recipients
                </code>
                ) have not been created yet. Copy and run the SQL migration below in your
                Supabase SQL Editor.
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 border-amber-500/40 text-xs hover:bg-amber-500/20"
                  onClick={copySql}
                >
                  {copiedSql ? (
                    <Check className="h-3.5 w-3.5 text-green-500" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  {copiedSql ? "Copied SQL!" : "Copy SQL Migration"}
                </Button>
                <a
                  href="https://supabase.com/dashboard"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-2 py-1.5 text-xs text-amber-600 hover:underline dark:text-amber-400"
                >
                  Open Supabase Dashboard <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : campaigns.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <Mail className="mx-auto h-10 w-10 text-muted-foreground/50" />
          <p className="mt-3 font-medium">No campaigns yet</p>
          <p className="text-sm text-muted-foreground">
            Pick a RegiBIZ template above or click New Campaign to start.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {campaigns.map((c) => {
            const isSending = c.status === "sending";
            const isScheduled = c.status === "scheduled";
            const pendingCount = Math.max(
              0,
              c.total_recipients - c.sent_count - c.failed_count,
            );
            const awaitingReply = Math.max(0, c.sent_count - (c.replied_count || 0));
            const isFollowUp =
              Boolean(c.is_followup) ||
              c.name.includes("(Follow-Up") ||
              c.name.includes("— Quick Follow-Up") ||
              c.name.includes("— Follow-Up");
            return (
              <div
                key={c.id}
                className="flex flex-col justify-between rounded-lg border bg-card p-4 shadow-sm"
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="line-clamp-1 font-semibold">{c.name}</h3>
                      <p className="line-clamp-1 text-xs text-muted-foreground">
                        {c.subject}
                      </p>
                      {(c.from_name || defaultSenderName) && (
                        <p className="line-clamp-1 text-[11px] text-muted-foreground/80">
                          Sender: {c.from_name || defaultSenderName}
                        </p>
                      )}
                      {c.sent_count > 0 && awaitingReply > 0 && (
                        <div className="flex items-center gap-1.5 pt-0.5 text-[11px] text-amber-600 dark:text-amber-400 font-medium">
                          <Clock className="h-3 w-3 shrink-0" />
                          <span>{awaitingReply} awaiting reply</span>
                          <span className="text-[10px] text-muted-foreground font-normal">
                            ({c.opened_count} opened)
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {isFollowUp && (
                        <Badge
                          variant="outline"
                          className="border-primary/40 bg-primary/10 text-primary text-[10px]"
                        >
                          Follow-Up
                        </Badge>
                      )}
                      {isScheduled && c.scheduled_at && (
                        <Badge
                          variant="outline"
                          className="border-purple-500/40 bg-purple-500/10 text-purple-600 dark:text-purple-400 text-[10px] gap-1"
                          title={`Scheduled for ${new Date(c.scheduled_at).toLocaleString()}`}
                        >
                          <CalendarClock className="h-2.5 w-2.5" />
                          {new Date(c.scheduled_at).toLocaleDateString([], {
                            month: "short",
                            day: "numeric",
                          })}
                        </Badge>
                      )}
                      {pendingCount > 0 && c.sent_count > 0 && (
                        <Badge
                          variant="outline"
                          className={cn("text-[10px]", STATUS_STYLES.pending)}
                        >
                          {pendingCount} pending
                        </Badge>
                      )}
                      <Badge
                        variant="outline"
                        className={cn("text-[10px] capitalize", STATUS_STYLES[c.status])}
                      >
                        {c.status}
                      </Badge>
                    </div>
                  </div>

                  <div className="grid grid-cols-4 gap-2 rounded-md bg-muted/40 p-2 text-center text-xs">
                    <div>
                      <div className="font-medium text-foreground">{c.sent_count}</div>
                      <div className="text-[10px] text-muted-foreground">Sent</div>
                    </div>
                    <div>
                      <div className="flex items-center justify-center gap-1 font-medium text-foreground">
                        <Eye className="h-3 w-3 text-muted-foreground" />
                        {c.opened_count}
                      </div>
                      <div className="text-[10px] text-muted-foreground">Opens</div>
                    </div>
                    <div>
                      <div className="flex items-center justify-center gap-1 font-medium text-foreground">
                        <MousePointerClick className="h-3 w-3 text-muted-foreground" />
                        {c.clicked_count}
                      </div>
                      <div className="text-[10px] text-muted-foreground">Clicks</div>
                    </div>
                    <div>
                      <div className="flex items-center justify-center gap-1 font-medium text-foreground">
                        <Reply className="h-3 w-3 text-muted-foreground" />
                        {c.replied_count ?? 0}
                      </div>
                      <div className="text-[10px] text-muted-foreground">Leads</div>
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                  <button
                    type="button"
                    onClick={() => void openSendMoreDialog(c)}
                    className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground hover:underline"
                    title="View recipients & add more emails"
                  >
                    <Users className="h-3 w-3" />
                    {c.total_recipients} recipient{c.total_recipients === 1 ? "" : "s"}
                  </button>
                  <div className="flex flex-wrap items-center gap-1">
                    {c.sent_count > 0 && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 border-amber-500/40 text-xs text-amber-600 hover:bg-amber-500/10 dark:text-amber-400 font-medium gap-1"
                        disabled={isSending || sendingId === c.id}
                        onClick={() => void openFollowUpDialog(c)}
                        title="Send or schedule a reminder / follow-up email to non-repliers"
                      >
                        <BellRing className="h-3 w-3" />
                        Follow-Up
                      </Button>
                    )}
                    {isScheduled && (
                      <Button
                        size="sm"
                        variant="default"
                        className="h-7 text-xs bg-purple-600 hover:bg-purple-700 text-white gap-1"
                        disabled={isSending || sendingId === c.id}
                        onClick={() => void handleSend(c)}
                        title="Send this scheduled reminder now"
                      >
                        <Send className="h-3 w-3" />
                        Send Now
                      </Button>
                    )}
                    {pendingCount > 0 && !isScheduled && (
                      <Button
                        size="sm"
                        variant="default"
                        className="h-7 text-xs"
                        disabled={isSending || sendingId === c.id}
                        onClick={() => void handleSend(c)}
                      >
                        {sendingId === c.id ? (
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        ) : (
                          <Send className="mr-1 h-3 w-3" />
                        )}
                        {c.sent_count > 0 ? `Send (${pendingCount})` : "Send"}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant={pendingCount === 0 && !isScheduled ? "default" : "outline"}
                      className="h-7 text-xs"
                      disabled={isSending || sendingId === c.id}
                      onClick={() => void openSendMoreDialog(c)}
                      title="Add more email addresses and send this same campaign again"
                    >
                      <UserPlus className="mr-1 h-3 w-3" />
                      Add Emails & Send
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs"
                      onClick={() =>
                        openNewWithTemplate({
                          name: `${c.name} (Copy)`,
                          fromName: c.from_name ?? defaultSenderName,
                          subject: c.subject,
                          bodyHtml: c.body_html,
                          trackOpens: c.track_opens !== false,
                          trackClicks: c.track_clicks !== false,
                        })
                      }
                      title="Create a new campaign pre-filled with this template"
                    >
                      <CopyPlus className="mr-1 h-3 w-3" />
                      Reuse
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      disabled={isSending || sendingId === c.id}
                      onClick={() => void handleDelete(c)}
                      title="Delete campaign"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* New / Reuse Campaign Dialog (internally scrollable, pinned header/footer) */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[90dvh] flex-col overflow-hidden sm:max-w-2xl">
          <DialogHeader className="shrink-0">
            <DialogTitle>New Email Campaign</DialogTitle>
            <DialogDescription>
              Use {"{{name}}"}, {"{{email}}"}, or any spreadsheet column (e.g.{" "}
              {"{{company_name}}"}, {"{{incorporation_date}}"}) for merge fields. Load a
              template or write HTML / plain text.
            </DialogDescription>
          </DialogHeader>

          <form
            id="new-email-campaign-form"
            onSubmit={(e) => {
              e.preventDefault();
              void submitNewCampaign(false);
            }}
            className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden"
          >
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
              {/* Quick Load Template Chips */}
              <div className="space-y-1.5 rounded-lg border bg-muted/30 p-2.5">
                <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
                  <span>Load from existing campaign or preset:</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {STARTER_EMAIL_TEMPLATES.map((tpl) => (
                    <Button
                      key={tpl.id}
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => applyTemplateIntoOpenModal(tpl)}
                    >
                      {tpl.name}
                    </Button>
                  ))}
                  {savedTemplates.map((tpl) => (
                    <Button
                      key={tpl.id}
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 border-primary/30 text-xs"
                      onClick={() =>
                        applyTemplateIntoOpenModal({
                          defaultCampaignName: tpl.name,
                          fromName: tpl.fromName,
                          subject: tpl.subject,
                          bodyHtml: tpl.bodyHtml,
                        })
                      }
                    >
                      ★ {tpl.name}
                    </Button>
                  ))}
                  {campaigns.slice(0, 6).map((c) => (
                    <Button
                      key={c.id}
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="h-7 text-xs"
                      onClick={() =>
                        applyTemplateIntoOpenModal({
                          defaultCampaignName: `${c.name} (Batch 2)`,
                          fromName: c.from_name ?? defaultSenderName,
                          subject: c.subject,
                          bodyHtml: c.body_html,
                        })
                      }
                    >
                      Existing: {c.name}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="camp-name">Campaign Name</Label>
                  <Input
                    id="camp-name"
                    placeholder="e.g. RegiBIZ Outreach Batch 1"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="camp-from-name">Sender Name</Label>
                    {defaultFromEmail && (
                      <span className="truncate text-[11px] text-muted-foreground">
                        &lt;{defaultFromEmail}&gt;
                      </span>
                    )}
                  </div>
                  <Input
                    id="camp-from-name"
                    maxLength={120}
                    placeholder={defaultSenderName || "e.g. Comlaudi or RegiBIZ"}
                    value={fromName}
                    onChange={(e) => setFromName(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="camp-subject">Subject Line</Label>
                <Input
                  id="camp-subject"
                  placeholder="Exclusive update for {{name}}"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="camp-body">Email Body (HTML or Plain Text)</Label>
                  <div className="inline-flex rounded-md border p-0.5 text-xs">
                    <button
                      type="button"
                      onClick={() => setBodyMode("write")}
                      className={cn(
                        "rounded px-2 py-0.5 transition-colors",
                        bodyMode === "write"
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      Write
                    </button>
                    <button
                      type="button"
                      onClick={() => setBodyMode("preview")}
                      className={cn(
                        "rounded px-2 py-0.5 transition-colors",
                        bodyMode === "preview"
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      Preview
                    </button>
                  </div>
                </div>

                {bodyMode === "write" ? (
                  <Textarea
                    id="camp-body"
                    rows={8}
                    className="field-sizing-fixed min-h-[180px] max-h-[260px] resize-y overflow-y-auto font-mono text-xs"
                    placeholder="<p>Hi {{name}},</p><p>Check out our latest services...</p>"
                    value={bodyHtml}
                    onChange={(e) => setBodyHtml(e.target.value)}
                    required
                  />
                ) : (
                  <iframe
                    title="Email template preview"
                    sandbox=""
                    srcDoc={wrapPreviewHtml(bodyHtml)}
                    className="h-[220px] w-full rounded-lg border bg-white"
                  />
                )}
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="camp-recipients">
                    Recipients <span className="text-xs text-muted-foreground">(Optional)</span>
                  </Label>
                </div>
                <RecipientImportBar
                  value={recipients}
                  onChange={setRecipients}
                  onImportRecipients={setImportedRecipients}
                  parsedCount={parsedNewEmails.length}
                />
                {detectedCustomTags.length > 0 && (
                  <div className="rounded-md border border-purple-500/30 bg-purple-500/10 p-2 text-xs">
                    <div className="mb-1 flex items-center justify-between text-purple-300">
                      <span className="font-semibold">Spreadsheet columns detected:</span>
                      <span className="text-[11px] text-muted-foreground">Click to insert into body</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {detectedCustomTags.map((tag) => (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => insertMergeTag(tag)}
                          className="rounded bg-purple-500/20 px-1.5 py-0.5 font-mono text-[11px] text-purple-200 transition-colors hover:bg-purple-500/30"
                        >
                          {`{{${tag}}}`}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <Textarea
                  id="camp-recipients"
                  rows={3}
                  className="field-sizing-fixed min-h-[76px] max-h-[140px] resize-y overflow-y-auto text-xs"
                  placeholder='Leave blank to send to all CRM contacts with email, import a CSV/TXT file above, or paste emails (e.g. "Priya <priya@company.com>")'
                  value={recipients}
                  onChange={(e) => setRecipients(e.target.value)}
                />
              </div>

              <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
                <div className="flex flex-wrap gap-4 text-xs">
                  <label className="flex cursor-pointer items-center gap-2">
                    <Checkbox
                      checked={trackOpens}
                      onCheckedChange={(v) => setTrackOpens(Boolean(v))}
                    />
                    <span>Track opens</span>
                  </label>
                  <label className="flex cursor-pointer items-center gap-2">
                    <Checkbox
                      checked={trackClicks}
                      onCheckedChange={(v) => setTrackClicks(Boolean(v))}
                    />
                    <span>Track link clicks</span>
                  </label>
                </div>
                {isLocalhost && trackClicks && (
                  <p className="text-[11px] text-amber-500">
                    Tip: You are on localhost — click tracking rewrites HTTPS links through
                    localhost:3000. Uncheck &ldquo;Track link clicks&rdquo; if testing links
                    with external inboxes.
                  </p>
                )}
              </div>
            </div>

            <DialogFooter className="shrink-0 flex-wrap justify-between gap-2 sm:justify-between">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleSaveAsTemplate}
                title="Save Subject and Body as a reusable template"
              >
                <BookmarkPlus className="mr-1.5 h-3.5 w-3.5" />
                Save as Template
              </Button>
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setOpen(false);
                    resetForm();
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" variant="outline" disabled={submitting}>
                  {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Create Draft
                </Button>
                <Button
                  type="button"
                  disabled={submitting}
                  onClick={() => void submitNewCampaign(true)}
                >
                  {submitting ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="mr-2 h-4 w-4" />
                  )}
                  Create &amp; Send
                </Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Send Again / Add More Emails from Existing Campaign Modal */}
      <Dialog
        open={Boolean(sendMoreCampaign)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setSendMoreCampaign(null);
        }}
      >
        <DialogContent className="flex max-h-[90dvh] flex-col overflow-hidden sm:max-w-2xl">
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2 pr-6">
              <UserPlus className="h-4 w-4 text-primary" />
              <span>Send Existing Template: {sendMoreCampaign?.name}</span>
            </DialogTitle>
            <DialogDescription className="line-clamp-1">
              Subject: {sendMoreCampaign?.subject}
            </DialogDescription>
          </DialogHeader>

          {sendMoreCampaign && (
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
              {/* Summary + Quick Actions */}
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-xs">
                <div className="flex flex-wrap items-center gap-3">
                  {(sendMoreCampaign.from_name || defaultSenderName) && (
                    <span>
                      Sender:{" "}
                      <strong>{sendMoreCampaign.from_name || defaultSenderName}</strong>
                    </span>
                  )}
                  <span>
                    <strong>{sendMoreCampaign.sent_count}</strong> sent
                  </span>
                  <span>
                    <strong>{pendingInModal}</strong> pending
                  </span>
                  <span>
                    <strong>{sendMoreCampaign.opened_count}</strong> opens
                  </span>
                  <span>
                    <strong>{sendMoreCampaign.clicked_count}</strong> clicks
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={() => setShowTemplatePreviewInModal((v) => !v)}
                  >
                    {showTemplatePreviewInModal ? (
                      <ChevronUp className="mr-1 h-3.5 w-3.5" />
                    ) : (
                      <ChevronDown className="mr-1 h-3.5 w-3.5" />
                    )}
                    {showTemplatePreviewInModal ? "Hide Template" : "Preview Template"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => {
                      const c = sendMoreCampaign;
                      setSendMoreCampaign(null);
                      openNewWithTemplate({
                        name: `${c.name} (Copy)`,
                        fromName: c.from_name ?? defaultSenderName,
                        subject: c.subject,
                        bodyHtml: c.body_html,
                        trackOpens: c.track_opens !== false,
                        trackClicks: c.track_clicks !== false,
                      });
                    }}
                  >
                    <CopyPlus className="mr-1 h-3 w-3" />
                    Edit Copy as New
                  </Button>
                </div>
              </div>

              {showTemplatePreviewInModal && (
                <iframe
                  title="Existing campaign template preview"
                  sandbox=""
                  srcDoc={wrapPreviewHtml(sendMoreCampaign.body_html)}
                  className="h-[190px] w-full rounded-lg border bg-white"
                />
              )}

              {/* Paste or Import Bulk Email Input */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="add-emails-input">Add Email Addresses</Label>
                </div>
                <RecipientImportBar
                  value={addEmailsText}
                  onChange={setAddEmailsText}
                  onImportRecipients={setImportedSendMoreRecipients}
                  parsedCount={parsedAddEmails.length}
                />
                <Textarea
                  id="add-emails-input"
                  rows={3}
                  className="field-sizing-fixed min-h-[90px] max-h-[160px] resize-y overflow-y-auto text-xs"
                  placeholder='Import a CSV/TXT list above or paste emails separated by comma/newline (e.g. "Priya <priya@startup.in>")'
                  value={addEmailsText}
                  onChange={(e) => setAddEmailsText(e.target.value)}
                />
                {alreadySentConflicts > 0 && (
                  <p className="text-xs text-amber-500">
                    {alreadySentConflicts} pasted address
                    {alreadySentConflicts === 1 ? " was" : "es were"} already sent earlier.
                    Enable &ldquo;Allow resending&rdquo; below to send to them again.
                  </p>
                )}
              </div>

              {/* Pick from CRM Contacts */}
              {availableContacts.length > 0 && (
                <div className="space-y-2 rounded-lg border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Label className="text-xs font-semibold">
                      Or Pick from CRM Contacts ({availableContacts.length})
                    </Label>
                    <div className="flex items-center gap-1.5">
                      {unsentContacts.length > 0 && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-6 px-2 text-[11px]"
                          onClick={() =>
                            setSelectedContactIds(new Set(unsentContacts.map((c) => c.id)))
                          }
                        >
                          Select Unsent ({unsentContacts.length})
                        </Button>
                      )}
                      {selectedContactIds.size > 0 && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-[11px]"
                          onClick={() => setSelectedContactIds(new Set())}
                        >
                          Clear ({selectedContactIds.size})
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="relative">
                    <Search className="pointer-events-none absolute top-2 left-2.5 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      value={contactSearch}
                      onChange={(e) => setContactSearch(e.target.value)}
                      placeholder="Filter contacts by name or email..."
                      className="h-8 pl-8 text-xs"
                    />
                  </div>
                  <div className="max-h-[140px] space-y-1 overflow-y-auto pr-1">
                    {filteredAvailableContacts.map((c) => {
                      const prevStatus = recipientStatusByEmail.get(c.email.toLowerCase());
                      const disabled = Boolean(
                        prevStatus &&
                          (prevStatus === "pending" || !allowResendExisting),
                      );
                      return (
                        <label
                          key={c.id}
                          className={cn(
                            "flex items-center justify-between gap-2 rounded px-2 py-1 text-xs hover:bg-muted/50",
                            disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
                          )}
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <Checkbox
                              checked={selectedContactIds.has(c.id)}
                              disabled={disabled}
                              onCheckedChange={() => toggleContactId(c.id)}
                            />
                            <span className="truncate font-medium">
                              {c.name || c.email}
                            </span>
                            {c.name && (
                              <span className="truncate text-muted-foreground">
                                {c.email}
                              </span>
                            )}
                          </span>
                          {prevStatus && (
                            <Badge
                              variant="outline"
                              className={cn(
                                "shrink-0 text-[10px] capitalize",
                                STATUS_STYLES[prevStatus],
                              )}
                            >
                              {prevStatus}
                            </Badge>
                          )}
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              <label className="flex cursor-pointer items-center gap-2 rounded-lg border bg-muted/20 p-2.5 text-xs">
                <Checkbox
                  checked={allowResendExisting}
                  onCheckedChange={(v) => setAllowResendExisting(Boolean(v))}
                />
                <span>
                  Allow resending to emails that already received this campaign
                </span>
              </label>

              {/* Recipient History */}
              <div className="space-y-1.5">
                <div className="text-xs font-semibold text-muted-foreground">
                  Campaign Recipients ({campaignRecipients.length})
                </div>
                {loadingDetail ? (
                  <div className="flex items-center justify-center py-6 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                  </div>
                ) : campaignRecipients.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No recipients yet.</p>
                ) : (
                  <div className="max-h-[160px] divide-y overflow-y-auto rounded-lg border text-xs">
                    {campaignRecipients.map((r) => (
                      <div
                        key={r.id}
                        className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                      >
                        <div className="min-w-0">
                          <div className="truncate font-medium">
                            {r.name ? `${r.name} <${r.email}>` : r.email}
                          </div>
                          {r.error_message && (
                            <div className="truncate text-[11px] text-destructive">
                              {r.error_message}
                            </div>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <span className="text-[11px] text-muted-foreground">
                            {r.open_count}o · {r.click_count}c
                          </span>
                          {r.status === "replied" ? (
                            <Badge
                              variant="outline"
                              className="border-emerald-500/40 bg-emerald-500/10 text-[10px] font-semibold text-emerald-500"
                            >
                              ✓ Lead
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className={cn("text-[10px] capitalize", STATUS_STYLES[r.status])}
                            >
                              {r.status}
                            </Badge>
                          )}
                          {r.status === "replied" ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-6 px-2 text-[10px] text-primary hover:underline"
                              onClick={() => {
                                window.location.href = "/inbox";
                              }}
                              title="Open reply thread in Unified Inbox"
                            >
                              <MessageSquare className="mr-1 h-3 w-3" />
                              Inbox
                            </Button>
                          ) : (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-6 px-2 text-[10px] border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400"
                              disabled={recordingLeadId === r.id}
                              onClick={() =>
                                void handleRecordLead(sendMoreCampaign.id, r.id, r.email)
                              }
                              title="Mark as Lead / Customer Replied (increments Leads and creates Inbox conversation)"
                            >
                              {recordingLeadId === r.id ? (
                                <Loader2 className="mr-1 h-2.5 w-2.5 animate-spin" />
                              ) : (
                                <CheckCircle className="mr-1 h-2.5 w-2.5" />
                              )}
                              Mark Lead
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          <DialogFooter className="shrink-0 flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setSendMoreCampaign(null)}
            >
              Close
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={addingRecipients}
              onClick={() => void handleQueueAndOptionallySend(false)}
            >
              {addingRecipients && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Queue Emails
            </Button>
            <Button
              type="button"
              disabled={addingRecipients}
              onClick={() => void handleQueueAndOptionallySend(true)}
            >
              {addingRecipients ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="mr-1.5 h-3.5 w-3.5" />
              )}
              {addEmailsText.trim() || selectedContactIds.size > 0
                ? "Add Emails & Send Now"
                : pendingInModal > 0
                  ? `Send ${pendingInModal} Pending`
                  : "Send Now"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Help Modal: How Leads & Email Tracking Work */}
      <Dialog open={showLeadHelp} onOpenChange={setShowLeadHelp}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <HelpCircle className="h-5 w-5 text-emerald-500" />
              <span>How Leads &amp; Mailbox Tracking Work</span>
            </DialogTitle>
            <DialogDescription>
              Understand how MasaCRM tracks Opens, Clicks, and converts customer replies into Leads.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 text-xs leading-relaxed">
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 space-y-1.5 text-foreground">
              <div className="font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5 text-sm">
                <Reply className="h-4 w-4" /> What is a &ldquo;Lead&rdquo; in Email Campaigns?
              </div>
              <p>
                In MasaCRM, <strong>Leads</strong> are prospects who replied to your campaign email or showed direct interest. Each reply increments the Leads count on the campaign card and starts a thread in your Unified Inbox.
              </p>
            </div>

            <div className="space-y-2 rounded-lg border p-3">
              <div className="font-semibold text-sm flex items-center gap-1.5">
                <Eye className="h-4 w-4 text-blue-500" /> Opens &amp; Clicks Tracking
              </div>
              <p className="text-muted-foreground">
                • <strong>Opens:</strong> MasaCRM embeds a tiny 1×1 transparent tracking pixel. When the recipient opens the email in Gmail/Outlook, the pixel loads from your server and increments Opens.
              </p>
              <p className="text-muted-foreground">
                • <strong>Clicks:</strong> Links inside the email are wrapped in redirect tracking links. When a recipient clicks any link, the click is logged before redirecting to the target page.
              </p>
              <div className="rounded bg-muted/50 p-2 text-[11px] text-muted-foreground">
                <strong>Why Opens/Clicks show 0 on localhost:</strong> External email providers (Gmail, Yahoo, Outlook) cannot load images or links from <code className="font-mono">http://localhost:3000</code>. On your public domain (<code className="font-mono">https://masacrm.cloudmasa.com</code>), all opens and clicks are tracked automatically in real-time.
              </div>
            </div>

            <div className="space-y-2 rounded-lg border p-3">
              <div className="font-semibold text-sm flex items-center gap-1.5">
                <CheckCircle className="h-4 w-4 text-emerald-500" /> How to Record Replies &amp; Leads
              </div>
              <div className="space-y-2 text-muted-foreground">
                <div>
                  <strong>1. Instant 1-Click &ldquo;Mark Lead&rdquo;:</strong>
                  <p className="mt-0.5">
                    Click <strong>&ldquo;Add Emails &amp; Send&rdquo;</strong> on any campaign card to view the recipient list. Next to any customer who replied, click the <strong>&ldquo;Mark Lead&rdquo;</strong> button. This instantly increments the campaign&rsquo;s <strong>Leads</strong> count, syncs them to CRM Contacts, and opens a thread in your <strong>Unified Inbox</strong>.
                  </p>
                </div>
                <div>
                  <strong>2. Automated Inbound Email Webhook:</strong>
                  <p className="mt-0.5">
                    Configure your mail provider (Mailgun, SendGrid, Postmark, AWS SES, or Cloudflare Email Routing) to forward incoming replies to MasaCRM&rsquo;s Inbound Webhook:
                  </p>
                  <code className="block mt-1 rounded bg-muted p-2 font-mono text-[11px] select-all break-all text-foreground">
                    https://masacrm.cloudmasa.com/api/email/inbound
                  </code>
                  <p className="mt-1">
                    Incoming replies are automatically matched to the recipient, the Lead counter is incremented, and the message appears directly in your Unified Inbox so your sales team can reply immediately!
                  </p>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button onClick={() => setShowLeadHelp(false)}>Got it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Option 2: Automated Inbound Webhook Modal */}
      <Dialog open={showInboundModal} onOpenChange={setShowInboundModal}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Webhook className="h-5 w-5 text-primary" />
              <span>Option 2: Automated Inbound Email Webhook</span>
            </DialogTitle>
            <DialogDescription>
              Incoming email replies from customers are automatically captured, recorded as Leads, and routed to your Unified Inbox.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 text-xs leading-relaxed">
            {/* Live Webhook URL & Secret */}
            <div className="space-y-3 rounded-lg border border-primary/20 bg-card p-4">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-foreground text-sm">Your Webhook Endpoint</span>
                <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-500">
                  Active
                </Badge>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Inbound Webhook URL (POST)</Label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded-md border bg-muted/60 p-2 font-mono text-[11px] select-all break-all text-foreground">
                    {(typeof window !== "undefined" ? window.location.origin : "https://masacrm.cloudmasa.com") +
                      "/api/email/inbound?secret=masacrm_inbound_sec_4d8e9f2a7b1c3e5a"}
                  </code>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 shrink-0"
                    onClick={() => {
                      const url =
                        (typeof window !== "undefined" ? window.location.origin : "https://masacrm.cloudmasa.com") +
                        "/api/email/inbound?secret=masacrm_inbound_sec_4d8e9f2a7b1c3e5a";
                      navigator.clipboard.writeText(url);
                      setCopiedWebhookUrl(true);
                      toast.success("Webhook URL copied to clipboard!");
                      setTimeout(() => setCopiedWebhookUrl(false), 2000);
                    }}
                  >
                    {copiedWebhookUrl ? (
                      <Check className="mr-1.5 h-3.5 w-3.5 text-emerald-500" />
                    ) : (
                      <Copy className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    {copiedWebhookUrl ? "Copied" : "Copy URL"}
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Inbound Secret Token</Label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded-md border bg-muted/60 p-2 font-mono text-[11px] select-all text-foreground">
                    masacrm_inbound_sec_4d8e9f2a7b1c3e5a
                  </code>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 shrink-0"
                    onClick={() => {
                      navigator.clipboard.writeText("masacrm_inbound_sec_4d8e9f2a7b1c3e5a");
                      setCopiedSecret(true);
                      toast.success("Secret copied!");
                      setTimeout(() => setCopiedSecret(false), 2000);
                    }}
                  >
                    {copiedSecret ? (
                      <Check className="mr-1.5 h-3.5 w-3.5 text-emerald-500" />
                    ) : (
                      <Copy className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    {copiedSecret ? "Copied" : "Copy Secret"}
                  </Button>
                </div>
              </div>
            </div>

            {/* Live Webhook Simulator / Test Panel */}
            <div className="rounded-lg border border-dashed border-primary/30 bg-muted/20 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="font-semibold text-foreground text-sm flex items-center gap-1.5">
                  <Sparkles className="h-4 w-4 text-primary" /> Live Inbound Reply Simulator
                </div>
                <span className="text-[11px] text-muted-foreground">Test Option 2 end-to-end</span>
              </div>

              <p className="text-muted-foreground">
                Enter any recipient email (e.g. one from your campaign) and send a simulated reply to verify that your Leads count increments and the conversation appears in your Inbox.
              </p>

              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="test-sender-email" className="text-xs">
                    Customer Reply Email *
                  </Label>
                  <Input
                    id="test-sender-email"
                    type="email"
                    placeholder="e.g. saravanasiva143@gmail.com"
                    value={testInboundEmail}
                    onChange={(e) => setTestInboundEmail(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="test-reply-subject" className="text-xs">
                    Email Subject
                  </Label>
                  <Input
                    id="test-reply-subject"
                    placeholder="Re: Quick question"
                    value={testInboundSubject}
                    onChange={(e) => setTestInboundSubject(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="test-reply-text" className="text-xs">
                  Customer Reply Message
                </Label>
                <Textarea
                  id="test-reply-text"
                  rows={2}
                  value={testInboundText}
                  onChange={(e) => setTestInboundText(e.target.value)}
                  className="field-sizing-fixed min-h-[60px] text-xs"
                />
              </div>

              {inboundTestResult && (
                <div
                  className={cn(
                    "rounded-lg border p-3 text-xs flex items-start gap-2.5",
                    inboundTestResult.success
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                      : "border-destructive/40 bg-destructive/10 text-destructive",
                  )}
                >
                  {inboundTestResult.success ? (
                    <CheckCircle className="h-4 w-4 shrink-0 text-emerald-500 mt-0.5" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 shrink-0 text-destructive mt-0.5" />
                  )}
                  <div className="flex-1 space-y-1">
                    <div className="font-semibold">{inboundTestResult.message}</div>
                    {inboundTestResult.success && (
                      <div className="flex items-center gap-2 pt-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs border-emerald-500/40 text-emerald-500 hover:bg-emerald-500/20"
                          onClick={() => {
                            window.location.href = "/inbox";
                          }}
                        >
                          <MessageSquare className="mr-1.5 h-3 w-3" />
                          View in Unified Inbox
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <Button
                type="button"
                onClick={handleTestInbound}
                disabled={testingInbound}
                className="w-full sm:w-auto"
              >
                {testingInbound ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Send className="mr-2 h-4 w-4" />
                )}
                Simulate Customer Reply &amp; Test Webhook
              </Button>
            </div>

            {/* Provider Configuration Guides */}
            <div className="space-y-3 rounded-lg border p-4">
              <div className="font-semibold text-sm">Provider Setup Instructions</div>
              <div className="space-y-2 text-muted-foreground">
                <div className="rounded border bg-muted/30 p-2.5">
                  <strong className="text-foreground">Method A: Gmail / Google Workspace Auto-Forwarding</strong>
                  <p className="mt-1">
                    1. In Gmail (<code className="font-mono">info@cloudmasa.com</code>), go to <strong>Settings → Forwarding and POP/IMAP</strong>.<br />
                    2. Add a forwarding rule or filter for incoming replies.<br />
                    3. For automated webhook forwarding from Gmail, you can use a free Cloudflare Email Worker, Zapier Gmail trigger, or Mailgun Inbound route.
                  </p>
                </div>
                <div className="rounded border bg-muted/30 p-2.5">
                  <strong className="text-foreground">Method B: Cloudflare Email Routing (Recommended &amp; 100% Free)</strong>
                  <p className="mt-1">
                    If your domain DNS is on Cloudflare:
                    Go to <strong>Email Routing → Email Workers</strong>, create a worker that forwards incoming customer emails directly to your MasaCRM webhook endpoint above.
                  </p>
                </div>
                <div className="rounded border bg-muted/30 p-2.5">
                  <strong className="text-foreground">Method C: SendGrid Inbound Parse / Mailgun Routes / Postmark</strong>
                  <p className="mt-1">
                    Under your provider&rsquo;s Inbound Settings, paste the Webhook URL above as your Destination URL. Every reply will be parsed and posted into MasaCRM in real time!
                  </p>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button onClick={() => setShowInboundModal(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Follow-Up & Reminder Dialog */}
      <Dialog open={followUpOpen} onOpenChange={setFollowUpOpen}>
        <DialogContent className="flex max-h-[92dvh] flex-col overflow-hidden sm:max-w-2xl">
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <BellRing className="h-5 w-5 text-amber-500" />
              <span>Campaign Follow-Up &amp; Reminder</span>
            </DialogTitle>
            <DialogDescription>
              Re-engage recipients from &ldquo;{followUpParentCampaign?.name}&rdquo; who have not replied yet, or schedule an automated reminder sequence.
            </DialogDescription>
          </DialogHeader>

          {loadingFollowUpStats ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin text-amber-500" />
              <span className="text-xs">Analyzing campaign response metrics &amp; non-repliers...</span>
            </div>
          ) : (
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
              {/* Step 1: Target Audience Selection */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    1. Select Follow-Up Audience
                  </Label>
                  {followUpStats && (
                    <span className="text-[11px] text-muted-foreground">
                      {selectedFollowUpIds.size} recipient(s) selected
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {/* Card 1: Non-Repliers */}
                  <button
                    type="button"
                    onClick={() => handleFollowUpFilterChange("non_repliers")}
                    className={cn(
                      "flex flex-col text-left p-3 rounded-lg border transition-all text-xs relative",
                      followUpFilter === "non_repliers"
                        ? "border-amber-500 bg-amber-500/10 text-foreground ring-1 ring-amber-500"
                        : "border-border bg-card/50 hover:bg-muted/50 text-muted-foreground",
                    )}
                  >
                    <div className="flex items-center justify-between w-full mb-1">
                      <span className="font-semibold text-foreground flex items-center gap-1">
                        🎯 All Non-Repliers
                      </span>
                      <Badge variant="outline" className="text-[9px] border-amber-500/40 text-amber-500 bg-amber-500/10">
                        Recommended
                      </Badge>
                    </div>
                    <div className="text-base font-bold text-foreground">
                      {followUpStats?.counts.nonRepliers ?? 0}
                    </div>
                    <p className="text-[11px] mt-0.5 text-muted-foreground line-clamp-2">
                      Recipients who have not replied yet.
                    </p>
                  </button>

                  {/* Card 2: Opened but No Reply */}
                  <button
                    type="button"
                    onClick={() => handleFollowUpFilterChange("opened_not_replied")}
                    className={cn(
                      "flex flex-col text-left p-3 rounded-lg border transition-all text-xs relative",
                      followUpFilter === "opened_not_replied"
                        ? "border-amber-500 bg-amber-500/10 text-foreground ring-1 ring-amber-500"
                        : "border-border bg-card/50 hover:bg-muted/50 text-muted-foreground",
                    )}
                  >
                    <div className="flex items-center justify-between w-full mb-1">
                      <span className="font-semibold text-foreground flex items-center gap-1">
                        💬 Opened, No Reply
                      </span>
                      <Badge variant="outline" className="text-[9px] border-blue-500/40 text-blue-500 bg-blue-500/10">
                        Hot Leads
                      </Badge>
                    </div>
                    <div className="text-base font-bold text-foreground">
                      {followUpStats?.counts.openedNotReplied ?? 0}
                    </div>
                    <p className="text-[11px] mt-0.5 text-muted-foreground line-clamp-2">
                      Viewed email but haven&rsquo;t converted yet.
                    </p>
                  </button>

                  {/* Card 3: Unopened */}
                  <button
                    type="button"
                    onClick={() => handleFollowUpFilterChange("unopened")}
                    className={cn(
                      "flex flex-col text-left p-3 rounded-lg border transition-all text-xs relative",
                      followUpFilter === "unopened"
                        ? "border-amber-500 bg-amber-500/10 text-foreground ring-1 ring-amber-500"
                        : "border-border bg-card/50 hover:bg-muted/50 text-muted-foreground",
                    )}
                  >
                    <div className="flex items-center justify-between w-full mb-1">
                      <span className="font-semibold text-foreground flex items-center gap-1">
                        👁️ Unopened Only
                      </span>
                      <Badge variant="outline" className="text-[9px] border-muted-foreground/30 text-muted-foreground">
                        Re-engage
                      </Badge>
                    </div>
                    <div className="text-base font-bold text-foreground">
                      {followUpStats?.counts.unopened ?? 0}
                    </div>
                    <p className="text-[11px] mt-0.5 text-muted-foreground line-clamp-2">
                      Missed your initial message completely.
                    </p>
                  </button>
                </div>

                {/* Recipient list toggle */}
                <div className="pt-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs px-2 gap-1 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowFollowUpRecipientsList(!showFollowUpRecipientsList)}
                  >
                    {showFollowUpRecipientsList ? (
                      <ChevronUp className="h-3 w-3" />
                    ) : (
                      <ChevronDown className="h-3 w-3" />
                    )}
                    {showFollowUpRecipientsList ? "Hide" : "Customize"} Recipients ({selectedFollowUpIds.size})
                  </Button>

                  {showFollowUpRecipientsList && followUpStats?.recipients && (
                    <div className="mt-2 rounded-lg border bg-muted/20 p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <Input
                          placeholder="Search recipients by name or email..."
                          value={followUpSearch}
                          onChange={(e) => setFollowUpSearch(e.target.value)}
                          className="h-7 text-xs flex-1"
                        />
                        <div className="flex gap-1 shrink-0">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 text-[11px] px-2"
                            onClick={() => {
                              const allIds = new Set<string>();
                              for (const r of followUpStats.recipients) {
                                if (!r.repliedAt) allIds.add(r.id);
                              }
                              setSelectedFollowUpIds(allIds);
                            }}
                          >
                            Select All
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-7 text-[11px] px-2"
                            onClick={() => setSelectedFollowUpIds(new Set())}
                          >
                            Clear
                          </Button>
                        </div>
                      </div>

                      <div className="max-h-36 overflow-y-auto space-y-1 text-xs divide-y divide-border/50">
                        {followUpStats.recipients
                          .filter((r) => {
                            if (r.repliedAt) return false;
                            const q = followUpSearch.toLowerCase().trim();
                            if (!q) return true;
                            return (
                              r.email.toLowerCase().includes(q) ||
                              (r.name && r.name.toLowerCase().includes(q))
                            );
                          })
                          .map((r) => {
                            const isSelected = selectedFollowUpIds.has(r.id);
                            return (
                              <label
                                key={r.id}
                                className="flex items-center justify-between gap-2 py-1.5 px-1 hover:bg-muted/40 rounded cursor-pointer"
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <Checkbox
                                    checked={isSelected}
                                    onCheckedChange={(checked) => {
                                      setSelectedFollowUpIds((prev) => {
                                        const next = new Set(prev);
                                        if (checked) next.add(r.id);
                                        else next.delete(r.id);
                                        return next;
                                      });
                                    }}
                                  />
                                  <div className="min-w-0 truncate">
                                    <span className="font-medium text-foreground">{r.email}</span>
                                    {r.name && (
                                      <span className="text-[11px] text-muted-foreground ml-1.5 truncate">
                                        ({r.name})
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <div className="shrink-0 flex items-center gap-1.5 text-[11px]">
                                  {r.openCount > 0 ? (
                                    <span className="text-emerald-500 font-medium">
                                      Opened {r.openCount}x
                                    </span>
                                  ) : (
                                    <span className="text-muted-foreground">Unopened</span>
                                  )}
                                </div>
                              </label>
                            );
                          })}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Step 2: Schedule & Timing */}
              <div className="space-y-2 rounded-lg border bg-card p-3">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  2. Choose Timing &amp; Schedule
                </Label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setFollowUpTiming("now")}
                    className={cn(
                      "flex items-center justify-center gap-2 p-2.5 rounded-lg border text-xs font-medium transition-all",
                      followUpTiming === "now"
                        ? "border-amber-500 bg-amber-500/10 text-foreground ring-1 ring-amber-500"
                        : "border-border bg-card hover:bg-muted text-muted-foreground",
                    )}
                  >
                    <Send className="h-3.5 w-3.5 text-amber-500" />
                    <span>Send Follow-Up Now</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFollowUpTiming("scheduled")}
                    className={cn(
                      "flex items-center justify-center gap-2 p-2.5 rounded-lg border text-xs font-medium transition-all",
                      followUpTiming === "scheduled"
                        ? "border-purple-500 bg-purple-500/10 text-foreground ring-1 ring-purple-500"
                        : "border-border bg-card hover:bg-muted text-muted-foreground",
                    )}
                  >
                    <CalendarClock className="h-3.5 w-3.5 text-purple-500" />
                    <span>Schedule Auto-Reminder</span>
                  </button>
                </div>

                {followUpTiming === "scheduled" && (
                  <div className="space-y-2 pt-2 border-t mt-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] text-muted-foreground">Quick Presets:</span>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-6 text-[11px] px-2"
                        onClick={() => setQuickSchedule(1, 10)}
                      >
                        Tomorrow 10 AM
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-6 text-[11px] px-2"
                        onClick={() => setQuickSchedule(2, 10)}
                      >
                        In 2 Days
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-6 text-[11px] px-2"
                        onClick={() => setQuickSchedule(3, 10)}
                      >
                        In 3 Days
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-6 text-[11px] px-2"
                        onClick={() => setQuickSchedule(7, 10)}
                      >
                        In 1 Week
                      </Button>
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor="followup-schedule-time" className="text-xs text-muted-foreground">
                        Exact Send Date &amp; Time
                      </Label>
                      <Input
                        id="followup-schedule-time"
                        type="datetime-local"
                        value={followUpScheduledAt}
                        onChange={(e) => setFollowUpScheduledAt(e.target.value)}
                        className="h-8 text-xs font-mono"
                        required
                      />
                    </div>
                    <p className="text-[11px] text-purple-500/90 leading-tight">
                      ⏰ Automated reminder: MasaCRM will automatically dispatch this follow-up on {followUpScheduledAt ? new Date(followUpScheduledAt).toLocaleString() : "the scheduled date"} to any recipient who has not replied.
                    </p>
                  </div>
                )}
              </div>

              {/* Step 3: Follow-Up Message Content */}
              <div className="space-y-3 rounded-lg border bg-card p-3">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    3. Follow-Up Email Details
                  </Label>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-6 text-[11px] gap-1 border-amber-500/30 text-amber-500 hover:bg-amber-500/10"
                    onClick={() => {
                      const tpl = STARTER_EMAIL_TEMPLATES.find((t) => t.id === "regibiz-followup");
                      if (tpl) {
                        setFollowUpSubject(tpl.subject);
                        setFollowUpBodyHtml(tpl.bodyHtml);
                        toast.success("Loaded RegiBIZ Quick Follow-Up template!");
                      }
                    }}
                  >
                    <Sparkles className="h-3 w-3" />
                    Load RegiBIZ Follow-Up Template
                  </Button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label htmlFor="followup-name" className="text-xs">
                      Follow-Up Batch Name
                    </Label>
                    <Input
                      id="followup-name"
                      value={followUpName}
                      onChange={(e) => setFollowUpName(e.target.value)}
                      placeholder="e.g. Complaudi — Follow-up 1"
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="followup-subject" className="text-xs">
                      Subject Line *
                    </Label>
                    <Input
                      id="followup-subject"
                      value={followUpSubject}
                      onChange={(e) => setFollowUpSubject(e.target.value)}
                      placeholder="Re: Your previous email subject"
                      className="h-8 text-xs"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Follow-Up Message Body *</Label>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant={followUpBodyMode === "write" ? "secondary" : "ghost"}
                        className="h-6 px-2 text-[11px]"
                        onClick={() => setFollowUpBodyMode("write")}
                      >
                        Write
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={followUpBodyMode === "preview" ? "secondary" : "ghost"}
                        className="h-6 px-2 text-[11px]"
                        onClick={() => setFollowUpBodyMode("preview")}
                      >
                        Preview
                      </Button>
                    </div>
                  </div>

                  {followUpBodyMode === "write" ? (
                    <Textarea
                      rows={5}
                      value={followUpBodyHtml}
                      onChange={(e) => setFollowUpBodyHtml(e.target.value)}
                      placeholder="Hi {{name}}, just following up on our previous note..."
                      className="field-sizing-fixed min-h-[110px] text-xs font-sans"
                      required
                    />
                  ) : (
                    <div className="rounded-md border bg-white p-3 text-black text-xs min-h-[110px] max-h-48 overflow-y-auto">
                      <div
                        dangerouslySetInnerHTML={{
                          __html: wrapPreviewHtml(followUpBodyHtml),
                        }}
                      />
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-1 pt-1 text-[11px] text-muted-foreground">
                    <span>Merge tags:</span>
                    {["{{name}}", "{{email}}", "{{company_name}}"].map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => {
                          setFollowUpBodyHtml((prev) => prev + " " + tag);
                          toast.success(`Inserted ${tag}`);
                        }}
                        className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono hover:bg-muted/80 text-foreground"
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Threading Header Option */}
                <div className="flex items-start gap-2 pt-1">
                  <Checkbox
                    id="followup-keep-thread"
                    checked={followUpKeepThread}
                    onCheckedChange={(checked) => setFollowUpKeepThread(Boolean(checked))}
                  />
                  <div className="space-y-0.5">
                    <Label
                      htmlFor="followup-keep-thread"
                      className="text-xs font-medium cursor-pointer"
                    >
                      Keep in same email thread (In-Reply-To header)
                    </Label>
                    <p className="text-[11px] text-muted-foreground">
                      Email clients like Gmail and Outlook will group this follow-up inside the original email conversation thread.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="shrink-0 gap-2 border-t pt-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setFollowUpOpen(false)}
              disabled={submittingFollowUp}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={
                loadingFollowUpStats ||
                submittingFollowUp ||
                selectedFollowUpIds.size === 0 ||
                !followUpSubject.trim() ||
                !followUpBodyHtml.trim()
              }
              className={cn(
                followUpTiming === "scheduled"
                  ? "bg-purple-600 hover:bg-purple-700 text-white"
                  : "bg-amber-600 hover:bg-amber-700 text-white",
              )}
              onClick={() => void submitFollowUp()}
            >
              {submittingFollowUp ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {followUpTiming === "scheduled" ? "Scheduling..." : "Sending Follow-Up..."}
                </>
              ) : followUpTiming === "scheduled" ? (
                <>
                  <CalendarClock className="mr-2 h-4 w-4" />
                  Schedule Reminder ({selectedFollowUpIds.size})
                </>
              ) : (
                <>
                  <Send className="mr-2 h-4 w-4" />
                  Send Follow-Up Now ({selectedFollowUpIds.size})
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
