"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  AlertCircle,
  KeyRound,
  Shield,
  Copy,
  Check,
  RefreshCw,
  Unlink,
  ExternalLink,
  Lock,
  Building2,
  Sparkles,
  Database,
  Send,
} from "lucide-react";
import { FacebookBrandIcon } from "@/components/icons/facebook";
import { toast } from "sonner";

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

export function FacebookConfig({ canDisconnect = true }: FacebookConfigProps) {
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [tableMissing, setTableMissing] = useState(false);
  const [config, setConfig] = useState<FacebookStatus | null>(null);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [defaultVerifyToken, setDefaultVerifyToken] = useState("");

  // Form inputs
  const [accessToken, setAccessToken] = useState("");
  const [pageId, setPageId] = useState("");
  const [verifyToken, setVerifyToken] = useState("");

  // Copy states
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);

  const fetchConfig = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/facebook/config");
      const data = await res.json();
      if (data.config) {
        setConfig(data.config);
      }
      if (data.table_missing) {
        setTableMissing(true);
      } else {
        setTableMissing(false);
      }
      if (data.webhook_url) setWebhookUrl(data.webhook_url);
      if (data.default_verify_token) setDefaultVerifyToken(data.default_verify_token);
    } catch {
      toast.error("Failed to load Facebook connection status.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfig();
  }, []);

  const handleConnectPage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken.trim()) {
      toast.error("Please enter your Facebook Page Access Token.");
      return;
    }

    try {
      setActionLoading(true);
      const res = await fetch("/api/facebook/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          access_token: accessToken.trim(),
          page_id: pageId.trim() || undefined,
          verify_token: verifyToken.trim() || defaultVerifyToken,
        }),
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to connect Facebook Page");
      }

      toast.success(`Successfully connected Facebook Page: ${data.config?.page_name || "Connected"}`);
      setAccessToken("");
      await fetchConfig();
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
      await fetchConfig();
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
              <div className="h-12 w-12 rounded-full bg-blue-600/10 flex items-center justify-center text-blue-600 font-bold border border-blue-600/20">
                {config?.page_name ? config.page_name.slice(0, 2).toUpperCase() : "FB"}
              </div>
              <div>
                <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  {config?.page_name || "Connected Page"}
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                </h4>
                <p className="text-xs text-muted-foreground">
                  Page ID: <code className="font-mono text-[11px]">{config?.page_id || "Auto-detected"}</code>
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

      {/* Connection Setup Form */}
      {!isConnected && (
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-5">
          <div>
            <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-blue-600" />
              Connect Facebook Page via Meta Graph API
            </h4>
            <p className="text-xs text-muted-foreground mt-0.5">
              Generate a Page Access Token with <code>pages_messaging</code> permission from the Meta Developer Portal.
            </p>
          </div>

          <form onSubmit={handleConnectPage} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Page Access Token *</Label>
              <Input
                type="password"
                placeholder="EAA..."
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                className="font-mono text-xs"
                required
              />
              <p className="text-[11px] text-muted-foreground">
                Never-expiring Page Access Token from Meta Developer Console → Graph API Explorer.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                <Label className="text-xs font-medium">Custom Webhook Verify Token (Optional)</Label>
                <Input
                  type="text"
                  placeholder={defaultVerifyToken || "wacrm_fb_..."}
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
            Configure these parameters in your Meta App Dashboard under <strong>Messenger → Settings → Webhooks</strong>.
          </p>
        </div>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs font-medium">Callback URL</Label>
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={webhookUrl || "Loading webhook URL..."}
                className="bg-muted/50 font-mono text-xs h-8"
              />
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs shrink-0"
                onClick={() => copyToClipboard(webhookUrl, "webhook")}
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
                value={defaultVerifyToken || "Loading token..."}
                className="bg-muted/50 font-mono text-xs h-8"
              />
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs shrink-0"
                onClick={() => copyToClipboard(defaultVerifyToken, "token")}
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
