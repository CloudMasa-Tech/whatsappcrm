"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  KeyRound,
  Shield,
  Copy,
  Check,
  RefreshCw,
  Unlink,
  ExternalLink,
  Sparkles,
  Eye,
  EyeOff,
  AlertCircle,
  Info,
} from "lucide-react";
import { FacebookBrandIcon } from "@/components/icons/facebook";
import { toast } from "sonner";
import { sanitizeAccessToken } from "@/lib/instagram/meta-client";

interface FacebookConfigProps {
  canDisconnect?: boolean;
}

interface FacebookStatus {
  id?: string;
  page_id: string | null;
  page_name: string | null;
  profile_picture_url: string | null;
  status: "connected" | "disconnected" | "error";
  last_error?: string | null;
  connected_at?: string | null;
}

const emptySubscribe = () => () => {};

export function FacebookConfig({ canDisconnect = true }: FacebookConfigProps) {
  const browserOrigin = useSyncExternalStore(
    emptySubscribe,
    () => (typeof window !== "undefined" ? window.location.origin : ""),
    () => "",
  );
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [tableMissing, setTableMissing] = useState(false);
  const [config, setConfig] = useState<FacebookStatus | null>(null);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [defaultVerifyToken, setDefaultVerifyToken] = useState("");

  // Form inputs
  const [accessToken, setAccessToken] = useState("");
  const [showAccessToken, setShowAccessToken] = useState(false);
  const [pageId, setPageId] = useState("");
  const [verifyToken, setVerifyToken] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [showAppSecret, setShowAppSecret] = useState(false);

  // Copy states
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);

  const [reloadKey, setReloadKey] = useState(0);
  const fetchConfig = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let ignore = false;

    async function load() {
      try {
        setLoading(true);
        const res = await fetch("/api/facebook/config");
        const data = await res.json();
        if (ignore) return;
        if (data.config) setConfig(data.config);
        setTableMissing(Boolean(data.table_missing));
        if (data.webhook_url) setWebhookUrl(data.webhook_url);
        if (data.default_verify_token) setDefaultVerifyToken(data.default_verify_token);
      } catch {
        if (!ignore) toast.error("Failed to load Facebook connection status.");
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    void load();
    return () => {
      ignore = true;
    };
  }, [reloadKey]);

  const handleConnectPage = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = sanitizeAccessToken(accessToken);
    if (!cleaned) {
      toast.error("Please enter your Facebook Page or User Access Token.");
      return;
    }

    try {
      setActionLoading(true);
      const res = await fetch("/api/facebook/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          access_token: cleaned,
          page_id: pageId.trim() || undefined,
          verify_token: verifyToken.trim() || defaultVerifyToken,
          app_secret: appSecret.trim() || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        if (data.table_missing) setTableMissing(true);
        throw new Error(data.error || "Failed to connect Facebook Page");
      }

      toast.success(
        `Successfully connected Facebook Page: ${data.config?.page_name || data.profile?.name || "Connected"}`,
      );
      setAccessToken("");
      setAppSecret("");
      fetchConfig();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to connect Facebook Page.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm("Are you sure you want to disconnect this Facebook Page?")) return;

    try {
      setActionLoading(true);
      const res = await fetch("/api/facebook/config", { method: "DELETE" });
      const data = await res.json();

      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to disconnect");
      }

      toast.success("Facebook Page disconnected successfully.");
      fetchConfig();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to disconnect Facebook.");
    } finally {
      setActionLoading(false);
    }
  };

  const copyToClipboard = (text: string, type: "webhook" | "token") => {
    navigator.clipboard.writeText(text);
    if (type === "webhook") {
      setCopiedWebhook(true);
      setTimeout(() => setCopiedWebhook(false), 2000);
    } else {
      setCopiedToken(true);
      setTimeout(() => setCopiedToken(false), 2000);
    }
    toast.success("Copied to clipboard!");
  };

  // Discovered pages from 1-Click OAuth / User Token
  const [discoveredPages, setDiscoveredPages] = useState<Array<{
    id: string;
    name: string;
    category?: string;
    accessToken: string;
    profilePictureUrl: string | null;
  }>>([]);
  const [discovering, setDiscovering] = useState(false);
  const [userToken, setUserToken] = useState("");
  const [showUserToken, setShowUserToken] = useState(false);

  const handleConnectDiscoveredPage = async (page: {
    id: string;
    name: string;
    accessToken: string;
    profilePictureUrl: string | null;
  }) => {
    try {
      setActionLoading(true);
      const res = await fetch("/api/facebook/oauth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "connect_page",
          page_id: page.id,
          page_name: page.name,
          access_token: page.accessToken,
          profile_picture_url: page.profilePictureUrl,
          verify_token: verifyToken.trim() || defaultVerifyToken,
          app_secret: appSecret.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        if (data.table_missing) setTableMissing(true);
        throw new Error(data.error || "Failed to connect page");
      }

      toast.success(`Connected to "${page.name}" successfully!`);
      setUserToken("");
      setAppSecret("");
      setDiscoveredPages([]);
      fetchConfig();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to connect Facebook Page.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleDiscoverPages = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = sanitizeAccessToken(userToken);
    if (!cleaned) {
      toast.error("Please enter a Meta User or Page Access Token.");
      return;
    }

    try {
      setDiscovering(true);
      const res = await fetch("/api/facebook/oauth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "discover", token: cleaned }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to discover Facebook Pages");
      }

      if (!data.pages || data.pages.length === 0) {
        toast.info(
          "No Facebook Pages found under this token. Ensure you selected your Page in Graph API Explorer and granted pages_show_list & pages_messaging permissions.",
        );
        setDiscoveredPages([]);
        return;
      }

      setDiscoveredPages(data.pages);
      toast.success(`Found ${data.pages.length} Facebook Page${data.pages.length > 1 ? "s" : ""}!`);

      // If exactly 1 page found, automatically connect it
      if (data.pages.length === 1) {
        await handleConnectDiscoveredPage(data.pages[0]);
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to find Facebook Pages.");
    } finally {
      setDiscovering(false);
    }
  };

  const isConnected = config?.status === "connected";

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="rounded-xl border border-blue-500/20 bg-gradient-to-r from-blue-500/10 via-blue-500/5 to-transparent p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-blue-600 flex items-center justify-center text-white shadow-sm">
              <FacebookBrandIcon className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold text-foreground">Facebook Messenger Integration</h3>
                <Badge
                  variant={isConnected ? "default" : "outline"}
                  className={isConnected ? "bg-blue-600 text-white" : "text-muted-foreground"}
                >
                  {loading ? "Checking..." : isConnected ? "Connected" : "Disconnected"}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Connect your Facebook Business Page to send and receive customer Messenger chats directly inside CRM Inbox.
              </p>
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={fetchConfig}
            disabled={loading || actionLoading}
            className="h-8 text-xs gap-1.5 self-start sm:self-auto"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Connected Account Card */}
      {isConnected && (
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-full bg-blue-600/10 flex items-center justify-center text-blue-600 font-bold border border-blue-600/20 overflow-hidden">
                {config?.profile_picture_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={config.profile_picture_url} alt={config.page_name || "Page"} className="h-full w-full object-cover" />
                ) : config?.page_name ? (
                  config.page_name.slice(0, 2).toUpperCase()
                ) : (
                  "FB"
                )}
              </div>
              <div>
                <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  {config?.page_name || "Connected Facebook Page"}
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                </h4>
                <p className="text-xs text-muted-foreground">
                  Page ID: <code className="font-mono text-[11px]">{config?.page_id || "Auto-detected"}</code> • Connected on {config?.connected_at ? new Date(config.connected_at).toLocaleDateString() : "Active"}
                </p>
              </div>
            </div>

            {canDisconnect && (
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDisconnect}
                disabled={actionLoading}
                className="h-8 text-xs gap-1.5"
              >
                <Unlink className="h-3.5 w-3.5" />
                Disconnect Page
              </Button>
            )}
          </div>
        </div>
      )}

      {tableMissing && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-200 flex items-start gap-2.5">
          <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
          <span>
            Database table <code className="font-mono">facebook_config</code> was not found. Apply{" "}
            <code className="font-mono">supabase/migrations/058_facebook_config.sql</code> in Supabase SQL Editor.
          </span>
        </div>
      )}

      {/* 1-Click Page Discovery & Connect (Option 2) */}
      {!isConnected && (
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-blue-600" />
                1-Click Facebook Page Connect (Instant)
              </h4>
              <p className="text-xs text-muted-foreground mt-0.5">
                Paste either a Facebook User Access Token or a direct Page Access Token from Meta Graph API Explorer.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1.5 border-blue-500/30 text-blue-600 hover:bg-blue-500/10 dark:text-blue-400 shrink-0"
              onClick={() => window.open("https://developers.facebook.com/tools/explorer/", "_blank")}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Open Explorer
            </Button>
          </div>

          <form onSubmit={handleDiscoverPages} className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Meta Access Token</Label>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Input
                    type={showUserToken ? "text" : "password"}
                    placeholder="Paste token (starts with EAAB... or EAAG...)"
                    value={userToken}
                    onChange={(e) => setUserToken(e.target.value)}
                    className="font-mono text-xs h-9 pr-9"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowUserToken((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={showUserToken ? "Hide token" : "Show token"}
                  >
                    {showUserToken ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
                <Button
                  type="submit"
                  disabled={discovering || !userToken.trim()}
                  className="bg-blue-600 hover:bg-blue-700 text-white text-xs h-9 gap-1.5 px-4 shrink-0 font-medium"
                >
                  {discovering ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  Find Pages
                </Button>
              </div>
              <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3 text-xs space-y-1.5 text-blue-200">
                <p className="font-semibold text-blue-300 flex items-center gap-1.5">
                  <Info className="h-3.5 w-3.5" /> How to generate the right Facebook token in Graph API Explorer:
                </p>
                <ol className="list-decimal list-inside space-y-1 text-[11px] text-muted-foreground pl-1">
                  <li>
                    Open <strong>Graph API Explorer</strong> and make sure your Meta App is selected.
                  </li>
                  <li>
                    Under <strong>Permissions</strong>, click <em>Add a Permission</em> and select: <code>pages_show_list</code>, <code>pages_read_engagement</code>, and <code>pages_messaging</code>.
                  </li>
                  <li>
                    Click <strong>Generate Access Token</strong> and approve the prompt. Then in the <strong>User or Page</strong> dropdown, choose your <strong>Page</strong> to copy the direct Page Token (or copy the User Token).
                  </li>
                </ol>
              </div>
            </div>
          </form>

          {/* Discovered Pages List */}
          {discoveredPages.length > 0 && (
            <div className="p-4 rounded-xl bg-muted/40 border border-border space-y-3">
              <h5 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Select a Facebook Page to Connect:
              </h5>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {discoveredPages.map((page) => (
                  <div
                    key={page.id}
                    className="flex items-center justify-between p-3 rounded-lg border border-border bg-card shadow-xs gap-3"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="h-9 w-9 rounded-full bg-blue-600/10 text-blue-600 font-bold flex items-center justify-center text-xs shrink-0 overflow-hidden border border-blue-600/20">
                        {page.profilePictureUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={page.profilePictureUrl} alt={page.name} className="h-full w-full object-cover" />
                        ) : (
                          page.name.slice(0, 2).toUpperCase()
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-foreground truncate">{page.name}</p>
                        <p className="text-[10px] text-muted-foreground font-mono truncate">ID: {page.id}</p>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      disabled={actionLoading}
                      onClick={() => handleConnectDiscoveredPage(page)}
                      className="h-7 text-xs bg-blue-600 text-white hover:bg-blue-700 shrink-0 font-medium"
                    >
                      Connect
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Manual Direct Token Form */}
      {!isConnected && (
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-5">
          <div>
            <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-blue-600" />
              Manual Page / Meta Token Setup
            </h4>
            <p className="text-xs text-muted-foreground mt-0.5">
              Or paste a Page Access Token (or User Token with a linked Page) along with your optional App Secret.
            </p>
          </div>

          <form onSubmit={handleConnectPage} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Page / Meta Access Token *</Label>
              <div className="relative">
                <Input
                  type={showAccessToken ? "text" : "password"}
                  placeholder="EAAG..."
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.target.value)}
                  className="font-mono text-xs pr-9"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowAccessToken((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={showAccessToken ? "Hide access token" : "Show access token"}
                >
                  {showAccessToken ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Facebook Page ID (Optional)</Label>
                <Input
                  type="text"
                  placeholder="e.g. 104829384729102"
                  value={pageId}
                  onChange={(e) => setPageId(e.target.value)}
                  className="font-mono text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Meta App Secret (Optional)</Label>
                <div className="relative">
                  <Input
                    type={showAppSecret ? "text" : "password"}
                    placeholder="Required for webhooks"
                    value={appSecret}
                    onChange={(e) => setAppSecret(e.target.value)}
                    className="font-mono text-xs pr-9"
                  />
                  <button
                    type="button"
                    onClick={() => setShowAppSecret((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={showAppSecret ? "Hide app secret" : "Show app secret"}
                  >
                    {showAppSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Custom Webhook Verify Token (Optional)</Label>
                <Input
                  type="text"
                  placeholder={defaultVerifyToken || "masacrm_fb_..."}
                  value={verifyToken}
                  onChange={(e) => setVerifyToken(e.target.value)}
                  className="font-mono text-xs"
                />
              </div>
            </div>

            <Button
              type="submit"
              disabled={actionLoading}
              className="bg-blue-600 hover:bg-blue-700 text-white text-xs h-9 gap-2 shadow-sm font-medium"
            >
              {actionLoading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Shield className="h-3.5 w-3.5" />}
              Verify & Connect Page
            </Button>
          </form>
        </div>
      )}

      {/* Meta Webhook Endpoint Configuration Instructions */}
      <div className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-4">
        <div>
          <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Shield className="h-4 w-4 text-emerald-600" />
            Meta Webhook Configuration
          </h4>
          <p className="text-xs text-muted-foreground mt-0.5">
            Configure these parameters in your Meta App Dashboard under <strong>Messenger → Settings → Webhooks</strong>. Webhooks also require a public HTTPS URL and your Meta App Secret.
          </p>
        </div>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs font-medium">Callback URL</Label>
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={webhookUrl || (browserOrigin ? `${browserOrigin}/api/facebook/webhook` : "Loading webhook URL...")}
                className="bg-muted/50 font-mono text-xs h-8"
              />
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs shrink-0"
                onClick={() =>
                  copyToClipboard(
                    webhookUrl || (browserOrigin ? `${browserOrigin}/api/facebook/webhook` : ""),
                    "webhook",
                  )
                }
              >
                {copiedWebhook ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs font-medium">Verify Token</Label>
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={verifyToken.trim() || defaultVerifyToken || "Loading token..."}
                className="bg-muted/50 font-mono text-xs h-8"
              />
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs shrink-0"
                onClick={() =>
                  copyToClipboard(verifyToken.trim() || defaultVerifyToken, "token")
                }
              >
                {copiedToken ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
