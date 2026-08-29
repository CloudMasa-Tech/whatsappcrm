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
} from "lucide-react";
import { toast } from "sonner";

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

export default function EmailCampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
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
    // `ignore` drops the response if the effect re-runs or the component
    // unmounts before the fetch settles, so a slow earlier request can
    // never overwrite newer state.
    let ignore = false;

    async function fetchCampaigns() {
      try {
        const res = await fetch("/api/email/campaigns");
        if (!res.ok) throw new Error("Failed to load");
        const data = await res.json();
        if (!ignore) setCampaigns(data.campaigns ?? []);
      } catch (err) {
        if (ignore) return;
        console.error("[email-campaigns] load error:", err);
        toast.error("Failed to load campaigns");
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    void fetchCampaigns();

    return () => {
      ignore = true;
    };
  }, [reloadKey]);

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
      // Blank recipients means "everyone with an email address", which
      // the API resolves from contacts.
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
          ...(list.length > 0 ? { recipients: list } : {}),
        }),
      });
      const data = await res.json();

      if (!res.ok) {
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
            Send tracked email. Opens, clicks and replies create leads in your inbox.
          </p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New Campaign
        </Button>
      </div>

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
        <div className="divide-y rounded-lg border">
          {campaigns.map((c) => (
            <div
              key={c.id}
              className="flex flex-col gap-3 p-4 transition-colors hover:bg-muted/30 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate font-semibold">{c.name}</p>
                  <Badge
                    className={cn(
                      "border text-[10px] capitalize",
                      STATUS_STYLES[c.status] ?? STATUS_STYLES.draft,
                    )}
                  >
                    {c.status}
                  </Badge>
                </div>
                <p className="truncate text-sm text-muted-foreground">{c.subject}</p>
              </div>

              <div className="flex items-center gap-4 text-sm">
                <span
                  className="flex items-center gap-1 text-muted-foreground"
                  title="Sent"
                >
                  <Send className="h-3.5 w-3.5" />
                  {c.sent_count}/{c.total_recipients}
                </span>
                <span className="flex items-center gap-1 text-indigo-500" title="Opened">
                  <Eye className="h-3.5 w-3.5" />
                  {c.opened_count}
                </span>
                <span className="flex items-center gap-1 text-violet-500" title="Clicked">
                  <MousePointerClick className="h-3.5 w-3.5" />
                  {c.clicked_count}
                </span>
                <span className="flex items-center gap-1 text-emerald-500" title="Replied">
                  <Reply className="h-3.5 w-3.5" />
                  {c.replied_count}
                </span>

                {c.status === "draft" && (
                  <Button
                    size="sm"
                    onClick={() => void handleSend(c)}
                    disabled={sendingId === c.id}
                  >
                    {sendingId === c.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <Send className="mr-1.5 h-3.5 w-3.5" />
                        Send
                      </>
                    )}
                  </Button>
                )}

                <button
                  type="button"
                  onClick={() => void handleDelete(c)}
                  className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  aria-label={`Delete campaign ${c.name}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={handleCreate}>
            <DialogHeader>
              <DialogTitle>New Email Campaign</DialogTitle>
              <DialogDescription>
                Opens and clicks are tracked per recipient and fire automations.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="campaign-name">Campaign name *</Label>
                <Input
                  id="campaign-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="August newsletter"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="campaign-subject">Subject *</Label>
                <Input
                  id="campaign-subject"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Hello {{name}}, here's what's new"
                  required
                />
                <p className="text-xs text-muted-foreground">
                  {"{{name}}"} and {"{{email}}"} are replaced per recipient.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="campaign-body">Body (HTML) *</Label>
                <Textarea
                  id="campaign-body"
                  value={bodyHtml}
                  onChange={(e) => setBodyHtml(e.target.value)}
                  placeholder="<p>Hi {{name}},</p><p><a href='https://example.com'>See the offer</a></p>"
                  className="min-h-32 font-mono text-xs"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="campaign-recipients">Recipients</Label>
                <Textarea
                  id="campaign-recipients"
                  value={recipients}
                  onChange={(e) => setRecipients(e.target.value)}
                  placeholder="one@example.com, two@example.com"
                  className="min-h-20 font-mono text-xs"
                />
                <p className="text-xs text-muted-foreground">
                  Leave empty to mail every contact that has an email address.
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Create draft
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
