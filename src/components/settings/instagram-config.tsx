"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  User,
  Sparkles,
  Database,
} from "lucide-react";
import { Instagram } from "@/components/icons/instagram";
import { toast } from "sonner";

interface InstagramConfigProps {
  canDisconnect?: boolean;
}

interface InstagramStatus {
  id?: string;
  connection_method: "direct" | "cloud_api";
  username: string | null;
  name: string | null;
  profile_picture_url: string | null;
  status: "connected" | "disconnected" | "2fa_pending" | "error";
  last_error?: string | null;
  instagram_business_id?: string | null;
  connected_at?: string | null;
}

const SQL_MIGRATION_TEXT = `-- 052_instagram_integration.sql
CREATE TABLE IF NOT EXISTS instagram_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  connection_method TEXT NOT NULL DEFAULT 'direct' CHECK (connection_method IN ('direct', 'cloud_api')),
  username TEXT,
  session_data TEXT,
  two_factor_identifier TEXT,
  instagram_business_id TEXT,
  page_id TEXT,
  access_token TEXT,
  verify_token TEXT,
  app_secret TEXT,
  name TEXT,
  profile_picture_url TEXT,
  status TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('connected', 'disconnected', '2fa_pending', 'error')),
  last_error TEXT,
  connected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id)
);

CREATE INDEX IF NOT EXISTS idx_instagram_config_project ON instagram_config(project_id);
CREATE INDEX IF NOT EXISTS idx_instagram_config_account ON instagram_config(account_id);

ALTER TABLE instagram_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "instagram_config_select" ON instagram_config;
CREATE POLICY "instagram_config_select" ON instagram_config FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM project_members pm
      WHERE pm.project_id = instagram_config.project_id
        AND pm.user_id = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.user_id = auth.uid()
        AND p.account_id = instagram_config.account_id
        AND p.account_role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "instagram_config_insert" ON instagram_config;
CREATE POLICY "instagram_config_insert" ON instagram_config FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM project_members pm
      WHERE pm.project_id = instagram_config.project_id
        AND pm.user_id = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.user_id = auth.uid()
        AND p.account_id = instagram_config.account_id
        AND p.account_role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "instagram_config_update" ON instagram_config;
CREATE POLICY "instagram_config_update" ON instagram_config FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM project_members pm
      WHERE pm.project_id = instagram_config.project_id
        AND pm.user_id = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.user_id = auth.uid()
        AND p.account_id = instagram_config.account_id
        AND p.account_role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "instagram_config_delete" ON instagram_config;
CREATE POLICY "instagram_config_delete" ON instagram_config FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.user_id = auth.uid()
        AND p.account_id = instagram_config.account_id
        AND p.account_role IN ('owner', 'admin')
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON instagram_config TO authenticated;
GRANT ALL ON instagram_config TO service_role;

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS instagram_id TEXT,
  ADD COLUMN IF NOT EXISTS instagram_username TEXT,
  ADD COLUMN IF NOT EXISTS channel TEXT DEFAULT 'whatsapp';

CREATE INDEX IF NOT EXISTS idx_contacts_instagram_id ON contacts(instagram_id);
CREATE INDEX IF NOT EXISTS idx_contacts_instagram_username ON contacts(instagram_username);

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS channel TEXT DEFAULT 'whatsapp';

CREATE INDEX IF NOT EXISTS idx_conversations_channel ON conversations(channel);

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS channel TEXT DEFAULT 'whatsapp';

CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel);
`;

export function InstagramConfig({ canDisconnect = true }: InstagramConfigProps) {
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [tableMissing, setTableMissing] = useState(false);
  const [config, setConfig] = useState<InstagramStatus | null>(null);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [defaultVerifyToken, setDefaultVerifyToken] = useState("");

  // Direct login form state
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  // Quick DM Composer state
  const [quickDmRecipient, setQuickDmRecipient] = useState("");
  const [quickDmText, setQuickDmText] = useState("");
  const [quickDmSending, setQuickDmSending] = useState(false);

  // Cloud API form state
  const [accessToken, setAccessToken] = useState("");
  const [igBusinessId, setIgBusinessId] = useState("");
  const [pageId, setPageId] = useState("");
  const [verifyToken, setVerifyToken] = useState("");

  // Copy helpers
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);

  const fetchConfig = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/instagram/config");
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
      toast.error("Failed to load Instagram connection status.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfig();
  }, []);

  // Direct Login Submit
  const handleDirectLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      toast.error("Please enter your Instagram username and password.");
      return;
    }

    try {
      setActionLoading(true);
      const res = await fetch("/api/instagram/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "login",
          username,
          password,
        }),
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        if (data.table_missing) {
          setTableMissing(true);
        }
        throw new Error(data.error || "Login failed");
      }

      toast.success(`Successfully connected Instagram account @${data.username}`);
      setPassword("");
      await fetchConfig();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to connect to Instagram.");
    } finally {
      setActionLoading(false);
    }
  };

  // Cloud API Submit
  const handleCloudApiSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken) {
      toast.error("Please enter your Meta Page/Instagram Access Token.");
      return;
    }

    try {
      setActionLoading(true);
      const res = await fetch("/api/instagram/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          access_token: accessToken,
          instagram_business_id: igBusinessId,
          page_id: pageId,
          verify_token: verifyToken || defaultVerifyToken,
        }),
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        if (data.table_missing) {
          setTableMissing(true);
        }
        throw new Error(data.error || "Failed to save Meta credentials");
      }

      toast.success(`Successfully connected Instagram account @${data.profile?.username || "Account"}`);
      setAccessToken("");
      await fetchConfig();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to verify Meta credentials.");
    } finally {
      setActionLoading(false);
    }
  };

  // Disconnect Instagram
  const handleDisconnect = async () => {
    if (!confirm("Are you sure you want to disconnect this Instagram account?")) return;

    try {
      setActionLoading(true);
      const res = await fetch("/api/instagram/config", { method: "DELETE" });
      const data = await res.json();

      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to disconnect");
      }

      toast.success("Instagram account has been disconnected.");
      await fetchConfig();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to disconnect Instagram.");
    } finally {
      setActionLoading(false);
    }
  };

  // Send Quick Instagram DM
  const handleSendQuickDm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickDmRecipient.trim()) {
      toast.error("Please enter a recipient Instagram username.");
      return;
    }
    if (!quickDmText.trim()) {
      toast.error("Please enter a message.");
      return;
    }

    try {
      setQuickDmSending(true);
      const res = await fetch("/api/inbox/new-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: "instagram",
          recipient: quickDmRecipient.trim(),
          message: quickDmText.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to send Instagram DM");
      }

      toast.success(`Direct message sent to @${data.recipient}! Check Inbox to view conversation.`);
      setQuickDmRecipient("");
      setQuickDmText("");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to send direct message.");
    } finally {
      setQuickDmSending(false);
    }
  };

  const copyToClipboard = (text: string, type: "webhook" | "token" | "sql") => {
    navigator.clipboard.writeText(text);
    if (type === "webhook") {
      setCopiedWebhook(true);
      setTimeout(() => setCopiedWebhook(false), 2000);
    } else if (type === "token") {
      setCopiedToken(true);
      setTimeout(() => setCopiedToken(false), 2000);
    } else {
      setCopiedSql(true);
      setTimeout(() => setCopiedSql(false), 2000);
    }
    toast.success("Copied to clipboard!");
  };

  const isConnected = config?.status === "connected";

  return (
    <div className="space-y-6">
      {/* Database Migration Alert */}
      {tableMissing && (
        <div className="p-6 rounded-2xl bg-amber-500/10 border border-amber-500/30 space-y-4">
          <div className="flex items-start gap-3">
            <Database className="h-6 w-6 text-amber-500 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h3 className="text-base font-semibold text-amber-600 dark:text-amber-400">
                Database Migration Required (One-Time Setup)
              </h3>
              <p className="text-sm text-muted-foreground">
                To enable Instagram channel support in Supabase, run the SQL migration in your Supabase project SQL Editor.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={() => copyToClipboard(SQL_MIGRATION_TEXT, "sql")}
              className="bg-amber-600 hover:bg-amber-500 text-white"
            >
              {copiedSql ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
              {copiedSql ? "Copied SQL to Clipboard!" : "Copy SQL Migration Code"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => window.open("https://supabase.com/dashboard/project/twpuqntljgavimlocplg/sql/new", "_blank")}
            >
              <ExternalLink className="h-4 w-4 mr-2" /> Open Supabase SQL Editor
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={fetchConfig}
            >
              <RefreshCw className="h-4 w-4 mr-2" /> I have executed it (Refresh)
            </Button>
          </div>
        </div>
      )}

      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 rounded-2xl bg-gradient-to-r from-pink-500/10 via-purple-500/10 to-indigo-500/10 border border-pink-500/20">
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 rounded-2xl bg-gradient-to-tr from-yellow-400 via-pink-500 to-purple-600 flex items-center justify-center shadow-lg shadow-pink-500/20 text-white">
            <Instagram className="h-7 w-7" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold">Instagram Direct Messaging</h2>
              {isConnected ? (
                <Badge className="bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/20 border-emerald-500/30">
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Connected
                </Badge>
              ) : (
                <Badge variant="outline" className="text-muted-foreground">
                  Disconnected
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">
              Receive customer DMs, send replies from Inbox, automate with AI, and track conversations.
            </p>
          </div>
        </div>

        {isConnected && (
          <Button
            variant="destructive"
            size="sm"
            onClick={handleDisconnect}
            disabled={actionLoading}
            className="self-start md:self-auto"
          >
            <Unlink className="h-4 w-4 mr-2" /> Disconnect
          </Button>
        )}
      </div>

      {/* Connected Account Overview */}
      {isConnected && config && (
        <div className="p-6 rounded-2xl bg-card border shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              {config.profile_picture_url ? (
                <img
                  src={config.profile_picture_url}
                  alt={config.username || "Instagram Profile"}
                  className="h-16 w-16 rounded-full object-cover border-2 border-pink-500/40 p-0.5"
                />
              ) : (
                <div className="h-16 w-16 rounded-full bg-gradient-to-tr from-pink-500 to-purple-600 flex items-center justify-center text-white text-2xl font-bold">
                  {(config.username || "IG")[0]?.toUpperCase()}
                </div>
              )}
              <div>
                <h3 className="text-lg font-bold flex items-center gap-1.5">
                  {config.name || `@${config.username}`}
                </h3>
                <p className="text-sm text-pink-600 dark:text-pink-400 font-medium">
                  @{config.username}
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant="secondary" className="text-xs">
                    Method: {config.connection_method === "direct" ? "Direct Login (ID & Pass)" : "Meta Cloud API"}
                  </Badge>
                  {config.connected_at && (
                    <span className="text-xs text-muted-foreground">
                      Connected {new Date(config.connected_at).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={fetchConfig}
                disabled={loading}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
                Refresh Status
              </Button>
              <Button
                size="sm"
                className="bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white font-medium shadow-sm"
                onClick={() => (window.location.href = "/inbox")}
              >
                <Instagram className="h-4 w-4 mr-2" /> Open Inbox
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDisconnect}
                disabled={actionLoading}
              >
                <Unlink className="h-4 w-4 mr-2" /> Disconnect
              </Button>
            </div>
          </div>

          {/* Quick Direct Message Composer */}
          <div className="mt-6 pt-6 border-t border-border space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-semibold flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-pink-500" /> Send Direct Message (DM)
                </h4>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Compose and send a direct message to any Instagram user. The conversation will appear in your Inbox.
                </p>
              </div>
            </div>

            <form onSubmit={handleSendQuickDm} className="space-y-3 max-w-lg bg-muted/40 p-4 rounded-xl border">
              <div className="space-y-1.5">
                <Label htmlFor="quick-dm-user" className="text-xs font-medium">Recipient Instagram Username</Label>
                <div className="relative">
                  <div className="absolute left-3 top-2.5 text-muted-foreground font-medium text-xs">@</div>
                  <Input
                    id="quick-dm-user"
                    placeholder="username (e.g. johndoe)"
                    value={quickDmRecipient}
                    onChange={(e) => setQuickDmRecipient(e.target.value)}
                    className="pl-7 text-xs bg-background"
                    required
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="quick-dm-text" className="text-xs font-medium">Message</Label>
                <Input
                  id="quick-dm-text"
                  placeholder="Type your message here..."
                  value={quickDmText}
                  onChange={(e) => setQuickDmText(e.target.value)}
                  className="text-xs bg-background"
                  required
                />
              </div>

              <Button
                type="submit"
                size="sm"
                disabled={quickDmSending}
                className="w-full bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white font-medium"
              >
                {quickDmSending ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Sending DM...
                  </>
                ) : (
                  <>
                    <Instagram className="h-3.5 w-3.5 mr-1.5" /> Send Direct Message
                  </>
                )}
              </Button>
            </form>
          </div>
        </div>
      )}

      {/* Connection Setup Tabs (if disconnected) */}
      {!isConnected && (
        <Tabs defaultValue="direct" className="space-y-6">
          <TabsList className="grid w-full max-w-md grid-cols-2 p-1 bg-muted/60 rounded-xl">
            <TabsTrigger value="direct" className="rounded-lg font-medium flex items-center gap-2">
              <KeyRound className="h-4 w-4" /> Direct Login
            </TabsTrigger>
            <TabsTrigger value="cloud_api" className="rounded-lg font-medium flex items-center gap-2">
              <Shield className="h-4 w-4" /> Meta Cloud API
            </TabsTrigger>
          </TabsList>

          {/* TAB 1: Direct Instagram Login */}
          <TabsContent value="direct" className="space-y-4">
            <div className="p-6 rounded-2xl bg-card border shadow-sm">
              <div className="mb-6">
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-semibold">Log in with Instagram Credentials</h3>
                  <Badge variant="secondary" className="bg-pink-500/10 text-pink-600 text-xs">
                    <Sparkles className="h-3 w-3 mr-1" /> Quick Connect
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  Connect quickly by entering your Instagram username and password.
                </p>
              </div>

              <form onSubmit={handleDirectLogin} className="space-y-4 max-w-lg">
                <div className="space-y-2">
                  <Label htmlFor="ig-username">Instagram Username or Email</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="ig-username"
                      placeholder="e.g. yourbusiness or @yourbusiness"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="pl-9"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="ig-password">Instagram Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="ig-password"
                      type="password"
                      placeholder="••••••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="pl-9"
                      required
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Your credentials are encrypted and stored securely.
                  </p>
                </div>

                <Button
                  type="submit"
                  disabled={actionLoading}
                  className="w-full bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white font-medium shadow-md shadow-pink-500/20"
                >
                  {actionLoading ? (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Connecting...
                    </>
                  ) : (
                    <>
                      <Instagram className="h-4 w-4 mr-2" /> Connect Instagram Account
                    </>
                  )}
                </Button>
              </form>
            </div>
          </TabsContent>

          {/* TAB 2: Meta Cloud API */}
          <TabsContent value="cloud_api" className="space-y-6">
            <div className="p-6 rounded-2xl bg-card border shadow-sm space-y-6">
              <div>
                <h3 className="text-lg font-semibold">Official Meta Developer Graph API Setup</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Connect your Instagram Professional Account via Meta Cloud API using your Page Access Token.
                </p>
              </div>

              {/* Webhook Configuration Info */}
              <div className="p-4 rounded-xl bg-muted/50 border space-y-4">
                <h4 className="text-sm font-medium flex items-center gap-2">
                  <Shield className="h-4 w-4 text-pink-500" /> Webhook Setup in Meta App Dashboard
                </h4>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Webhook Callback URL</Label>
                    <div className="flex items-center gap-2">
                      <Input value={webhookUrl || "Loading..."} readOnly className="text-xs font-mono bg-background" />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => copyToClipboard(webhookUrl, "webhook")}
                      >
                        {copiedWebhook ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Webhook Verify Token</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        value={verifyToken || defaultVerifyToken}
                        onChange={(e) => setVerifyToken(e.target.value)}
                        className="text-xs font-mono bg-background"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => copyToClipboard(verifyToken || defaultVerifyToken, "token")}
                      >
                        {copiedToken ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>

              {/* API Credentials Form */}
              <form onSubmit={handleCloudApiSave} className="space-y-4 max-w-lg">
                <div className="space-y-2">
                  <Label htmlFor="meta-token">Page / Instagram Access Token</Label>
                  <Input
                    id="meta-token"
                    type="password"
                    placeholder="EAAB..."
                    value={accessToken}
                    onChange={(e) => setAccessToken(e.target.value)}
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    Never-expiring Page Access Token with <code>instagram_basic</code> and <code>instagram_manage_messages</code>.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="ig-business-id">Instagram Business Account ID (Optional)</Label>
                  <Input
                    id="ig-business-id"
                    placeholder="178414..."
                    value={igBusinessId}
                    onChange={(e) => setIgBusinessId(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="page-id">Facebook Page ID (Optional)</Label>
                  <Input
                    id="page-id"
                    placeholder="1000..."
                    value={pageId}
                    onChange={(e) => setPageId(e.target.value)}
                  />
                </div>

                <Button
                  type="submit"
                  disabled={actionLoading}
                  className="w-full bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-medium"
                >
                  {actionLoading ? (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Verifying Meta Token...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4 mr-2" /> Save & Connect Meta API
                    </>
                  )}
                </Button>
              </form>
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
