"use client";

import { useCallback, useEffect, useState } from "react";
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
} from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
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

interface Campaign {
  id: string;
  name: string;
  subject: string;
  status: string;
  total_recipients: number;
  sent_count: number;
  opened_count: number;
  clicked_count: number;
  replied_count: number;
  failed_count: number;
  created_at: string;
  sent_at: string | null;
}

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-muted text-muted-foreground border-border",
  sending: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  sent: "bg-green-500/10 text-green-600 border-green-500/20",
  failed: "bg-destructive/10 text-destructive border-destructive/20",
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
  ADD COLUMN IF NOT EXISTS sent_at       TIMESTAMPTZ;

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

export default function EmailCampaignsPage() {
  const { activeProjectId } = useAuth();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [tableMissing, setTableMissing] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [recipients, setRecipients] = useState("");

  // Bumped to re-run the fetch effect after a create/send/delete.
  const [reloadKey, setReloadKey] = useState(0);
  const load = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let ignore = false;

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

    void fetchCampaigns();

    return () => {
      ignore = true;
    };
  }, [reloadKey, activeProjectId]);

  const copySql = () => {
    navigator.clipboard.writeText(EMAIL_MIGRATION_SQL);
    setCopiedSql(true);
    toast.success("SQL Migration copied to clipboard!");
    setTimeout(() => setCopiedSql(false), 3000);
  };

  const resetForm = () => {
    setName("");
    setSubject("");
    setBodyHtml("");
    setRecipients("");
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    if (!name.trim() || !subject.trim() || !bodyHtml.trim()) {
      toast.error("Name, subject and body are all required");
      return;
    }

    setSubmitting(true);
    try {
      const list = recipients
        .split(/[\n,;]+/)
        .map((r) => r.trim())
        .filter(Boolean);

      const res = await fetch("/api/email/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          subject: subject.trim(),
          bodyHtml,
          projectId: activeProjectId || undefined,
          ...(list.length > 0 ? { recipients: list } : {}),
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

      toast.success(
        `Draft created with ${data.campaign?.total_recipients ?? 0} recipient(s)`,
      );
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
      const res = await fetch(`/api/email/campaigns/${campaign.id}/send`, {
        method: "POST",
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

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Email Campaigns</h1>
          <p className="text-sm text-muted-foreground">
            Send tracked emails with automatic open/click analytics and lead conversion.
          </p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New Campaign
        </Button>
      </div>

      {tableMissing && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-900 dark:text-amber-200">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
            <div className="space-y-2 flex-1">
              <div className="font-semibold text-sm">
                Database Tables Missing: Email Campaigns Migration Required
              </div>
              <p className="text-xs opacity-90 leading-relaxed">
                The database tables for email campaigns (<code className="bg-amber-500/20 px-1 py-0.5 rounded font-mono">email_campaigns</code> and <code className="bg-amber-500/20 px-1 py-0.5 rounded font-mono">email_campaign_recipients</code>) have not been created yet. Copy and run the SQL migration below in your Supabase SQL Editor.
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs border-amber-500/40 hover:bg-amber-500/20 gap-1.5"
                  onClick={copySql}
                >
                  {copiedSql ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                  {copiedSql ? "Copied SQL!" : "Copy SQL Migration"}
                </Button>
                <a
                  href="https://supabase.com/dashboard"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 hover:underline px-2 py-1.5"
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
            Create one to start tracking email engagement as leads.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {campaigns.map((c) => {
            const isDraft = c.status === "draft";
            const isSending = c.status === "sending";
            return (
              <div
                key={c.id}
                className="flex flex-col justify-between rounded-lg border bg-card p-4 shadow-sm"
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-semibold line-clamp-1">{c.name}</h3>
                      <p className="text-xs text-muted-foreground line-clamp-1">
                        {c.subject}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className={cn("capitalize text-[10px]", STATUS_STYLES[c.status])}
                    >
                      {c.status}
                    </Badge>
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

                <div className="mt-4 flex items-center justify-between border-t pt-3">
                  <span className="text-[11px] text-muted-foreground">
                    {c.total_recipients} recipient{c.total_recipients === 1 ? "" : "s"}
                  </span>
                  <div className="flex gap-1">
                    {isDraft && (
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
                        Send
                      </Button>
                    )}
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      disabled={isSending || sendingId === c.id}
                      onClick={() => void handleDelete(c)}
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

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New Email Campaign</DialogTitle>
            <DialogDescription>
              Draft an email broadcast. Use {"{{name}}"} and {"{{email}}"} for merge fields.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="camp-name">Campaign Name</Label>
              <Input
                id="camp-name"
                placeholder="e.g. Q3 Product Launch"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
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
              <Label htmlFor="camp-body">Email Body (HTML or Plain Text)</Label>
              <Textarea
                id="camp-body"
                rows={6}
                placeholder="<p>Hi {{name}},</p><p>Check out our latest products...</p>"
                value={bodyHtml}
                onChange={(e) => setBodyHtml(e.target.value)}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="camp-recipients">
                Recipients <span className="text-xs text-muted-foreground">(Optional)</span>
              </Label>
              <Textarea
                id="camp-recipients"
                rows={3}
                placeholder="Leave blank to send to all contacts with email, or paste comma/newline separated emails"
                value={recipients}
                onChange={(e) => setRecipients(e.target.value)}
              />
            </div>

            <DialogFooter className="gap-2">
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
              <Button type="submit" disabled={submitting}>
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create Draft
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
