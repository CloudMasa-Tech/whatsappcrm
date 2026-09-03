"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Copy, Link2, Loader2, Unlink } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FacebookBrandIcon } from "@/components/icons/facebook";
import { cn } from "@/lib/utils";

interface FacebookConfig {
  page_id?: string | null;
  page_name?: string | null;
  profile_picture_url?: string | null;
  status?: "connected" | "disconnected" | "error";
  last_error?: string | null;
  connected_at?: string | null;
}

/**
 * Connect a Facebook Page to this project.
 *
 * This is the credential half of the integration: the token is verified
 * against the Meta Graph API and then stored encrypted, which is what
 * makes the Page identifiable to the inbox and the readiness strip.
 * It is separate from the in-frame hub below, which is only a browsing
 * window and holds no credentials.
 */
export function FacebookConnect({ onConnected }: { onConnected?: () => void }) {
  const [config, setConfig] = useState<FacebookConfig | null>(null);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [verifyToken, setVerifyToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const [accessToken, setAccessToken] = useState("");
  const [pageId, setPageId] = useState("");
  const [appSecret, setAppSecret] = useState("");

  // Bumped to re-run the fetch effect after connect/disconnect.
  const [reloadKey, setReloadKey] = useState(0);
  const load = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    // Drops a stale response if the effect re-runs or the component
    // unmounts before the fetch settles.
    let ignore = false;

    async function fetchConfig() {
      try {
        const res = await fetch("/api/facebook/config");
        if (!res.ok) return;
        const data = await res.json();
        if (ignore) return;
        setConfig(data.config ?? null);
        setWebhookUrl(data.webhook_url ?? "");
        setVerifyToken(data.default_verify_token ?? "");
      } catch (err) {
        if (!ignore) console.error("[facebook-connect] load error:", err);
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    void fetchConfig();
    return () => {
      ignore = true;
    };
  }, [reloadKey]);

  const connected = config?.status === "connected";

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;

    if (!accessToken.trim()) {
      toast.error("A Page access token is required");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/facebook/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          access_token: accessToken.trim(),
          page_id: pageId.trim() || undefined,
          app_secret: appSecret.trim() || undefined,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        // Meta's own message is the most actionable thing here, so it is
        // surfaced verbatim rather than replaced with generic copy.
        toast.error(data.error ?? "Failed to connect Facebook");
        return;
      }

      toast.success(`Connected to ${data.profile?.name ?? "Facebook Page"}`);
      setAccessToken("");
      setPageId("");
      setAppSecret("");
      setExpanded(false);
      load();
      onConnected?.();
    } catch (err) {
      console.error("[facebook-connect] connect error:", err);
      toast.error("Network error while connecting");
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/facebook/config", { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Failed to disconnect");
        return;
      }
      toast.success("Facebook disconnected");
      load();
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Checking Facebook connection…
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <FacebookBrandIcon className="size-8 shrink-0" />
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
              {connected ? config?.page_name || "Facebook Page" : "Facebook Page"}
              {connected && (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="size-3" /> Connected
                </span>
              )}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {connected
                ? `Page ID ${config?.page_id ?? "—"}`
                : "Not connected — the frame below is view-only until a Page is linked."}
            </p>
            {config?.status === "error" && config.last_error && (
              <p className="mt-0.5 truncate text-xs text-destructive">
                {config.last_error}
              </p>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {connected ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleDisconnect()}
              disabled={saving}
              className="gap-1.5 text-destructive hover:text-destructive"
            >
              <Unlink className="size-3.5" />
              Disconnect
            </Button>
          ) : (
            <Button size="sm" onClick={() => setExpanded((v) => !v)} className="gap-1.5">
              <Link2 className="size-3.5" />
              {expanded ? "Cancel" : "Connect Page"}
            </Button>
          )}
        </div>
      </div>

      {expanded && !connected && (
        <form onSubmit={handleConnect} className="mt-4 space-y-4">
          <div className="flex items-center justify-between gap-3 rounded-lg border border-blue-500/20 bg-blue-500/10 p-3 text-xs">
            <div>
              <span className="font-semibold text-foreground">Need a Meta Page Token?</span>
              <p className="text-[11px] text-muted-foreground mt-0.5">Generate a Page Access Token in 1 click with `pages_messaging` &amp; `pages_show_list`.</p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 shrink-0 gap-1 border-blue-500/30 text-xs text-blue-600 hover:bg-blue-500/10 dark:text-blue-400"
              onClick={() => window.open("https://developers.facebook.com/tools/explorer/", "_blank")}
            >
              Open Explorer
            </Button>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fb-token">Page access token</Label>
            <Input
              id="fb-token"
              type="password"
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              placeholder="EAAG…"
              className="font-mono text-xs"
              autoComplete="off"
              required
            />
            <p className="text-xs text-muted-foreground">
              A <strong>Page</strong> token, not a User token — Meta for Developers
              → your app → Messenger → Generate token. Stored encrypted.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="fb-page-id">Page ID</Label>
              <Input
                id="fb-page-id"
                value={pageId}
                onChange={(e) => setPageId(e.target.value)}
                placeholder="Optional — read from the token"
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fb-app-secret">App secret</Label>
              <Input
                id="fb-app-secret"
                type="password"
                value={appSecret}
                onChange={(e) => setAppSecret(e.target.value)}
                placeholder="Optional — for webhook signatures"
                className="font-mono text-xs"
                autoComplete="off"
              />
            </div>
          </div>

          {webhookUrl && (
            <div className="rounded-md bg-muted/60 p-2.5 text-xs">
              <p className="mb-1 font-medium text-foreground">
                Webhook details for Meta
              </p>
              <CopyRow label="Callback URL" value={webhookUrl} />
              <CopyRow label="Verify token" value={verifyToken} />
            </div>
          )}

          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={saving}>
              {saving && <Loader2 className="mr-2 size-3.5 animate-spin" />}
              Verify &amp; connect
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
      <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground">
        {value}
      </code>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(value);
          toast.success(`${label} copied`);
        }}
        className={cn(
          "shrink-0 rounded p-1 text-muted-foreground transition-colors",
          "hover:bg-muted hover:text-foreground",
        )}
        aria-label={`Copy ${label}`}
      >
        <Copy className="size-3" />
      </button>
    </div>
  );
}
