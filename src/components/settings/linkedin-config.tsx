"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  AlertCircle,
  BarChart3,
  Building2,
  Check,
  CheckCircle2,
  Copy,
  Database,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Image as ImageIcon,
  KeyRound,
  Link2,
  Loader2,
  MessageCircle,
  RefreshCw,
  Send,
  Shield,
  Sparkles,
  Trash2,
  Unlink,
  UploadCloud,
  User,
  Users,
} from "lucide-react";
import { LinkedInBrandIcon } from "@/components/icons/linkedin";
import { toast } from "sonner";
import type {
  LinkedInAnalyticsSummary,
  LinkedInCommentItem,
  LinkedInConfigSafeRow,
  LinkedInOrganizationSummary,
  LinkedInPostItem,
} from "@/lib/linkedin/types";
import { sanitizeLinkedInToken } from "@/lib/linkedin/client";

interface LinkedInConfigProps {
  canDisconnect?: boolean;
}

interface CrmLinkedInLead {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  created_at: string;
}

const SQL_MIGRATION_063 = `-- Run supabase/migrations/063_linkedin_integration.sql in Supabase SQL Editor
CREATE TABLE IF NOT EXISTS public.linkedin_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  connection_method TEXT NOT NULL DEFAULT 'token' CHECK (connection_method IN ('token', 'oauth')),
  account_type TEXT NOT NULL DEFAULT 'person' CHECK (account_type IN ('person', 'organization')),
  member_urn TEXT,
  organization_id TEXT,
  organization_urn TEXT,
  display_name TEXT,
  headline TEXT,
  vanity_name TEXT,
  profile_picture_url TEXT,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  client_id TEXT,
  client_secret TEXT,
  verify_token TEXT,
  granted_scopes TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('connected', 'disconnected', 'error')),
  last_error TEXT,
  connected_at TIMESTAMPTZ,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id)
);
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS linkedin_urn TEXT, ADD COLUMN IF NOT EXISTS linkedin_url TEXT;
GRANT ALL ON TABLE public.linkedin_config TO service_role, postgres, authenticated;`;

const emptySubscribe = () => () => { };

export function LinkedInConfig({ canDisconnect = true }: LinkedInConfigProps) {
  const browserOrigin = useSyncExternalStore(
    emptySubscribe,
    () => (typeof window !== "undefined" ? window.location.origin : ""),
    () => "",
  );

  const [loading, setLoading] = useState(true);
  const [tableMissing, setTableMissing] = useState(false);
  const [config, setConfig] = useState<LinkedInConfigSafeRow | null>(null);
  const [organizations, setOrganizations] = useState<LinkedInOrganizationSummary[]>([]);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [oauthRedirectUri, setOauthRedirectUri] = useState("");
  const [defaultVerifyToken, setDefaultVerifyToken] = useState("");
  const [envOauthConfigured, setEnvOauthConfigured] = useState(false);

  // Connect form state
  const [connectTab, setConnectTab] = useState<"token" | "oauth">("token");
  const [accessToken, setAccessToken] = useState("");
  const [showAccessToken, setShowAccessToken] = useState(false);
  const [organizationId, setOrganizationId] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [showClientSecret, setShowClientSecret] = useState(false);
  const [verifyToken, setVerifyToken] = useState("");
  const [includeOrgScopes, setIncludeOrgScopes] = useState(false);
  const [includeLeadScope, setIncludeLeadScope] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // Action tabs when connected
  const [activeTab, setActiveTab] = useState<
    "publish" | "posts" | "analytics" | "leads" | "setup"
  >("publish");

  // Publish state
  const [postText, setPostText] = useState("");
  const [postVisibility, setPostVisibility] = useState<"PUBLIC" | "CONNECTIONS">("PUBLIC");
  const [postType, setPostType] = useState<"text" | "article" | "image">("text");
  const [articleUrl, setArticleUrl] = useState("");
  const [articleTitle, setArticleTitle] = useState("");
  const [articleDescription, setArticleDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [uploadingImg, setUploadingImg] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [selectedAuthorUrn, setSelectedAuthorUrn] = useState("");

  // Posts & comments state
  const [posts, setPosts] = useState<LinkedInPostItem[]>([]);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [postsError, setPostsError] = useState<string | null>(null);
  const [commentsByPost, setCommentsByPost] = useState<Record<string, LinkedInCommentItem[]>>({});
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [commentLoadingPost, setCommentLoadingPost] = useState<string | null>(null);

  // Analytics state
  const [analytics, setAnalytics] = useState<LinkedInAnalyticsSummary | null>(null);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);

  // Leads state
  const [leads, setLeads] = useState<CrmLinkedInLead[]>([]);
  const [loadingLeads, setLoadingLeads] = useState(false);
  const [syncingLeads, setSyncingLeads] = useState(false);

  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const reloadConfig = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let ignore = false;

    async function load() {
      try {
        setLoading(true);
        const res = await fetch("/api/linkedin/config");
        const data = await res.json();
        if (ignore) return;
        setTableMissing(Boolean(data.table_missing));
        setConfig(data.config ?? null);
        setOrganizations(data.organizations ?? []);
        if (data.webhook_url) setWebhookUrl(data.webhook_url);
        if (data.oauth_redirect_uri) setOauthRedirectUri(data.oauth_redirect_uri);
        if (data.default_verify_token) setDefaultVerifyToken(data.default_verify_token);
        setEnvOauthConfigured(Boolean(data.env_oauth_configured));
        if (data.config?.client_id) setClientId(data.config.client_id);
        if (data.config?.account_type === "organization" && data.config?.organization_urn) {
          setSelectedAuthorUrn(data.config.organization_urn);
        } else if (data.config?.member_urn) {
          setSelectedAuthorUrn(data.config.member_urn);
        }
      } catch {
        if (!ignore) toast.error("Failed to load LinkedIn configuration.");
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    async function handleOauthQueryNotice() {
      if (typeof window === "undefined") return;
      const params = new URLSearchParams(window.location.search);
      const oauth = params.get("oauth");
      const err = params.get("oauth_error");
      if (oauth === "connected") {
        toast.success("LinkedIn account connected via OAuth!");
        window.history.replaceState({}, "", "/linkedin");
      } else if (err) {
        toast.error(err);
        window.history.replaceState({}, "", "/linkedin");
      }
    }

    void load();
    void handleOauthQueryNotice();
    return () => {
      ignore = true;
    };
  }, [reloadKey]);

  const copyValue = (key: string, value: string) => {
    void navigator.clipboard.writeText(value);
    setCopiedKey(key);
    toast.success("Copied to clipboard!");
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleConnectToken = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = sanitizeLinkedInToken(accessToken);
    if (!cleaned) {
      toast.error("Please enter your LinkedIn Access Token.");
      return;
    }

    setConnecting(true);
    try {
      const res = await fetch("/api/linkedin/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          access_token: cleaned,
          organization_id: organizationId.trim() || undefined,
          client_id: clientId.trim() || undefined,
          client_secret: clientSecret.trim() || undefined,
          verify_token: verifyToken.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.table_missing) setTableMissing(true);
        throw new Error(data.error || "Failed to connect LinkedIn");
      }
      toast.success(
        `Connected LinkedIn as ${data.profile?.displayName || "LinkedIn Account"}`,
      );
      setAccessToken("");
      setClientSecret("");
      reloadConfig();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to connect LinkedIn.");
    } finally {
      setConnecting(false);
    }
  };

  const handleStartOauth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!envOauthConfigured && (!clientId.trim() || (!clientSecret.trim() && !config?.has_client_secret))) {
      toast.error("Enter your LinkedIn App Client ID and Client Secret first.");
      return;
    }

    setConnecting(true);
    try {
      if (clientId.trim() || clientSecret.trim() || verifyToken.trim()) {
        const res = await fetch("/api/linkedin/config", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: clientId.trim() || undefined,
            client_secret: clientSecret.trim() || undefined,
            verify_token: verifyToken.trim() || undefined,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          if (data.table_missing) setTableMissing(true);
          throw new Error(data.error || "Failed to save OAuth app settings");
        }
      }

      const scopes = ["openid", "profile", "email", "w_member_social"];
      if (includeOrgScopes) {
        scopes.push("r_organization_social", "w_organization_social", "rw_organization_admin");
      }
      if (includeLeadScope) {
        scopes.push("r_marketing_leadgen_automation");
      }

      window.location.href = `/api/linkedin/oauth?action=authorize&scopes=${encodeURIComponent(
        scopes.join(" "),
      )}`;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to start LinkedIn OAuth");
      setConnecting(false);
    }
  };

  const handleSyncProfile = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/linkedin/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to sync LinkedIn profile");
      toast.success("LinkedIn profile synced!");
      reloadConfig();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to sync LinkedIn profile.");
    } finally {
      setSyncing(false);
    }
  };

  const handleSwitchIdentity = async (
    type: "person" | "organization",
    org?: LinkedInOrganizationSummary,
  ) => {
    try {
      const res = await fetch("/api/linkedin/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_type: type,
          organization_id: org?.id,
          organization_name: org?.name,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to switch posting identity");
      toast.success(
        type === "organization" && org
          ? `Switched active author to ${org.name}`
          : "Switched active author to Personal Profile",
      );
      reloadConfig();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not switch identity.");
    }
  };

  const handleDisconnect = async () => {
    if (!confirm("Disconnect this LinkedIn integration from the project?")) return;
    try {
      const res = await fetch("/api/linkedin/config", { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to disconnect");
      toast.success("LinkedIn disconnected.");
      reloadConfig();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to disconnect LinkedIn.");
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingImg(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/linkedin/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      setImageUrl(data.url);
      toast.success(`Uploaded ${file.name}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Image upload failed");
    } finally {
      setUploadingImg(false);
    }
  };

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!postText.trim()) {
      toast.error("Write your LinkedIn post commentary first.");
      return;
    }

    setPublishing(true);
    try {
      const res = await fetch("/api/linkedin/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: postText.trim(),
          visibility: postVisibility,
          authorUrn: selectedAuthorUrn || undefined,
          articleUrl: postType === "article" ? articleUrl.trim() : undefined,
          articleTitle: postType === "article" ? articleTitle.trim() : undefined,
          articleDescription: postType === "article" ? articleDescription.trim() : undefined,
          imageUrl: postType === "image" ? imageUrl.trim() : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Publish failed");
      toast.success(`Published to LinkedIn! (${data.postUrn})`);
      setPostText("");
      setArticleUrl("");
      setArticleTitle("");
      setArticleDescription("");
      setImageUrl("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to publish post.");
    } finally {
      setPublishing(false);
    }
  };

  const loadPosts = async () => {
    setLoadingPosts(true);
    setPostsError(null);
    try {
      const qs = selectedAuthorUrn
        ? `?authorUrn=${encodeURIComponent(selectedAuthorUrn)}`
        : "";
      const res = await fetch(`/api/linkedin/posts${qs}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load posts");
      setPosts(data.posts ?? []);
    } catch (err) {
      setPostsError(
        err instanceof Error
          ? err.message
          : "Could not load posts (requires Community Management read scope).",
      );
    } finally {
      setLoadingPosts(false);
    }
  };

  const handleDeletePost = async (postUrn: string) => {
    if (!confirm("Delete this LinkedIn post?")) return;
    try {
      const res = await fetch(
        `/api/linkedin/posts?postUrn=${encodeURIComponent(postUrn)}`,
        { method: "DELETE" },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete post");
      toast.success("Post deleted");
      setPosts((prev) => prev.filter((p) => p.urn !== postUrn));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete post.");
    }
  };

  const loadComments = async (postUrn: string) => {
    setCommentLoadingPost(postUrn);
    try {
      const res = await fetch(
        `/api/linkedin/comments?postUrn=${encodeURIComponent(postUrn)}`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load comments");
      setCommentsByPost((prev) => ({ ...prev, [postUrn]: data.comments ?? [] }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load comments.");
    } finally {
      setCommentLoadingPost(null);
    }
  };

  const handleReplyComment = async (postUrn: string) => {
    const text = (replyDrafts[postUrn] || "").trim();
    if (!text) return;
    try {
      const res = await fetch("/api/linkedin/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postUrn, text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to post comment");
      toast.success("Comment posted!");
      setReplyDrafts((prev) => ({ ...prev, [postUrn]: "" }));
      await loadComments(postUrn);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to comment.");
    }
  };

  const loadAnalytics = async () => {
    setLoadingAnalytics(true);
    setAnalyticsError(null);
    try {
      const res = await fetch("/api/linkedin/analytics");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch analytics");
      setAnalytics(data.analytics ?? null);
    } catch (err) {
      setAnalyticsError(
        err instanceof Error ? err.message : "Analytics requires a connected Company Page.",
      );
    } finally {
      setLoadingAnalytics(false);
    }
  };

  const loadLeads = async () => {
    setLoadingLeads(true);
    try {
      const res = await fetch("/api/linkedin/leads");
      const data = await res.json();
      if (res.ok) setLeads(data.leads ?? []);
    } finally {
      setLoadingLeads(false);
    }
  };

  const handleSyncLeads = async () => {
    setSyncingLeads(true);
    try {
      const res = await fetch("/api/linkedin/leads", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lead sync failed");
      toast.success(`Synced ${data.fetched ?? 0} lead(s) (${data.imported ?? 0} new CRM contacts)!`);
      await loadLeads();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to sync LinkedIn leads.");
    } finally {
      setSyncingLeads(false);
    }
  };

  const resolvedWebhook =
    webhookUrl || (browserOrigin ? `${browserOrigin}/api/linkedin/webhook` : "");
  const resolvedRedirectUri =
    oauthRedirectUri || (browserOrigin ? `${browserOrigin}/api/linkedin/oauth` : "");
  const isConnected = config?.status === "connected";

  if (loading && !config) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-[#0A66C2]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="rounded-xl border border-[#0A66C2]/25 bg-gradient-to-r from-[#0A66C2]/15 via-[#0A66C2]/5 to-transparent p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <LinkedInBrandIcon className="h-10 w-10 shrink-0" />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold text-foreground">
                  LinkedIn Marketing &amp; CRM Suite
                </h1>
                <Badge
                  variant={isConnected ? "default" : "outline"}
                  className={isConnected ? "bg-[#0A66C2] text-white" : "text-muted-foreground"}
                >
                  {isConnected ? "Connected" : "Disconnected"}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Publish Profile &amp; Company Page posts, manage comments, view Company analytics, and sync LinkedIn Lead Gen Forms into Contacts.
              </p>
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={reloadConfig}
            disabled={loading}
            className="h-8 gap-1.5 text-xs"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Table Missing SQL Migration Banner */}
      {tableMissing && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-200 flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <Database className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-semibold text-amber-100">
                Database Migration Required: <code className="font-mono">063_linkedin_integration.sql</code>
              </p>
              <p className="opacity-90">
                Run <code className="font-mono">supabase/migrations/063_linkedin_integration.sql</code> in your Supabase SQL Editor to create <code className="font-mono">linkedin_config</code>.
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs border-amber-500/40"
            onClick={() => copyValue("sql", SQL_MIGRATION_063)}
          >
            {copiedKey === "sql" ? <Check className="mr-1.5 h-3.5 w-3.5 text-emerald-400" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}
            {copiedKey === "sql" ? "Copied SQL!" : "Copy Migration SQL"}
          </Button>
        </div>
      )}

      {/* Honest API Notice */}
      <div className="rounded-xl border border-border bg-card/60 p-3.5 text-xs text-muted-foreground flex items-start gap-2.5">
        <AlertCircle className="h-4 w-4 text-[#0A66C2] shrink-0 mt-0.5" />
        <span>
          <strong>LinkedIn API Note:</strong> LinkedIn does not expose a public 1-on-1 DM API. Personal profile publishing (<code className="font-mono">w_member_social</code>) works immediately; Company Page posts/analytics require LinkedIn <strong>Community Management API</strong> approval, and Lead Forms require <strong>Lead Sync API</strong> approval.
        </span>
      </div>

      {/* Disconnected Connect Cards */}
      {!isConnected && (
        <div className="space-y-5">
          <div className="inline-flex rounded-lg border bg-muted/60 p-1 text-xs">
            <button
              type="button"
              onClick={() => setConnectTab("token")}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors ${connectTab === "token"
                  ? "bg-card text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground"
                }`}
            >
              <KeyRound className="h-3.5 w-3.5 text-[#0A66C2]" />
              Access Token (Quick Connect)
            </button>
            <button
              type="button"
              onClick={() => setConnectTab("oauth")}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors ${connectTab === "oauth"
                  ? "bg-card text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground"
                }`}
            >
              <Sparkles className="h-3.5 w-3.5 text-[#0A66C2]" />
              LinkedIn OAuth App
            </button>
          </div>

          {connectTab === "token" ? (
            <form
              onSubmit={handleConnectToken}
              className="rounded-xl border bg-card p-5 space-y-4 shadow-xs"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold">Connect with LinkedIn OAuth Token</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Generate a token via LinkedIn Developer Portal → Auth → OAuth 2.0 tools and paste it here.
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs gap-1.5 shrink-0"
                  onClick={() =>
                    window.open("https://www.linkedin.com/developers/tools/oauth/token-generator", "_blank")
                  }
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Token Generator
                </Button>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium">LinkedIn Access Token *</Label>
                <div className="relative">
                  <Input
                    type={showAccessToken ? "text" : "password"}
                    value={accessToken}
                    onChange={(e) => setAccessToken(e.target.value)}
                    placeholder="AQV... (paste OAuth 2.0 access token)"
                    className="font-mono text-xs pr-9"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowAccessToken((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={showAccessToken ? "Hide token" : "Show token"}
                  >
                    {showAccessToken ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">
                    Company Organization ID <span className="text-muted-foreground">(Optional)</span>
                  </Label>
                  <Input
                    value={organizationId}
                    onChange={(e) => setOrganizationId(e.target.value)}
                    placeholder="e.g. 12345678 (auto-detected if blank)"
                    className="font-mono text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">
                    LinkedIn App Client Secret <span className="text-muted-foreground">(Optional, for webhooks)</span>
                  </Label>
                  <div className="relative">
                    <Input
                      type={showClientSecret ? "text" : "password"}
                      value={clientSecret}
                      onChange={(e) => setClientSecret(e.target.value)}
                      placeholder="For webhook HMAC verification"
                      className="font-mono text-xs pr-9"
                    />
                    <button
                      type="button"
                      onClick={() => setShowClientSecret((v) => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      aria-label={showClientSecret ? "Hide secret" : "Show secret"}
                    >
                      {showClientSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
              </div>

              <Button
                type="submit"
                disabled={connecting}
                className="bg-[#0A66C2] hover:bg-[#09539d] text-white text-xs h-9 gap-1.5"
              >
                {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Shield className="h-3.5 w-3.5" />}
                Verify &amp; Connect LinkedIn
              </Button>
            </form>
          ) : (
            <form
              onSubmit={handleStartOauth}
              className="rounded-xl border bg-card p-5 space-y-4 shadow-xs"
            >
              <div>
                <h2 className="text-sm font-semibold">1-Click LinkedIn OAuth 2.0 Connect</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Add the Redirect URL below to your LinkedIn Developer App under <strong>Auth → Authorized redirect URLs</strong>, save credentials, and authorize.
                </p>
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-medium">Authorized Redirect URL</Label>
                <div className="flex items-center gap-2">
                  <Input
                    readOnly
                    value={resolvedRedirectUri || "Loading..."}
                    className="bg-muted/40 font-mono text-xs h-8"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs shrink-0"
                    onClick={() => copyValue("redirect", resolvedRedirectUri)}
                  >
                    {copiedKey === "redirect" ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Client ID</Label>
                  <Input
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    placeholder={envOauthConfigured ? "(Using server env LINKEDIN_CLIENT_ID)" : "LinkedIn App Client ID"}
                    className="font-mono text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Client Secret</Label>
                  <div className="relative">
                    <Input
                      type={showClientSecret ? "text" : "password"}
                      value={clientSecret}
                      onChange={(e) => setClientSecret(e.target.value)}
                      placeholder={
                        config?.has_client_secret
                          ? "Saved (enter only to replace)"
                          : envOauthConfigured
                            ? "(Using server env secret)"
                            : "LinkedIn App Client Secret"
                      }
                      className="font-mono text-xs pr-9"
                    />
                    <button
                      type="button"
                      onClick={() => setShowClientSecret((v) => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      aria-label={showClientSecret ? "Hide secret" : "Show secret"}
                    >
                      {showClientSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
              </div>

              <div className="space-y-2 rounded-lg border bg-muted/20 p-3 text-xs">
                <p className="font-medium text-foreground">OAuth Scopes</p>
                <div className="flex flex-wrap gap-4">
                  <span className="text-muted-foreground">
                    ✓ Base: <code className="font-mono">openid profile email w_member_social</code>
                  </span>
                  <label className="flex cursor-pointer items-center gap-2">
                    <Checkbox
                      checked={includeOrgScopes}
                      onCheckedChange={(v) => setIncludeOrgScopes(Boolean(v))}
                    />
                    <span>Community Management (Company Pages &amp; Analytics)</span>
                  </label>
                  <label className="flex cursor-pointer items-center gap-2">
                    <Checkbox
                      checked={includeLeadScope}
                      onCheckedChange={(v) => setIncludeLeadScope(Boolean(v))}
                    />
                    <span>Lead Sync API (Lead Gen Forms)</span>
                  </label>
                </div>
              </div>

              <Button
                type="submit"
                disabled={connecting}
                className="bg-[#0A66C2] hover:bg-[#09539d] text-white text-xs h-9 gap-1.5"
              >
                {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
                Save &amp; Authorize with LinkedIn
              </Button>
            </form>
          )}
        </div>
      )}

      {/* Connected Hub */}
      {isConnected && config && (
        <div className="rounded-xl border bg-card p-5 space-y-5 shadow-xs">
          {/* Connected Profile Header */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              {config.profile_picture_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={config.profile_picture_url}
                  alt={config.display_name || "LinkedIn"}
                  className="h-14 w-14 rounded-full object-cover border border-[#0A66C2]/30"
                />
              ) : (
                <div className="h-14 w-14 rounded-full bg-[#0A66C2]/15 text-[#0A66C2] flex items-center justify-center font-bold text-lg">
                  {(config.display_name || "LI").slice(0, 2).toUpperCase()}
                </div>
              )}
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-bold">
                    {config.display_name || "Connected LinkedIn Account"}
                  </h2>
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  <Badge variant="secondary" className="text-[11px] capitalize">
                    {config.account_type === "organization" ? "Company Page" : "Personal Profile"}
                  </Badge>
                  <Badge variant="outline" className="text-[11px]">
                    {config.connection_method === "oauth" ? "OAuth 2.0" : "Access Token"}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground font-mono">
                  {config.account_type === "organization"
                    ? config.organization_urn || `Organization ${config.organization_id}`
                    : config.member_urn || "Authenticated LinkedIn Member"}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={handleSyncProfile}
                disabled={syncing}
                className="h-8 text-xs gap-1.5"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
                Sync Profile
              </Button>
              {canDisconnect && (
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={handleDisconnect}
                  className="h-8 text-xs gap-1.5"
                >
                  <Unlink className="h-3.5 w-3.5" />
                  Disconnect
                </Button>
              )}
            </div>
          </div>

          {/* Author Switcher when both Personal & Organization(s) are available */}
          {(config.member_urn || organizations.length > 0) && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-xs">
              <span className="font-medium text-muted-foreground">Active Posting Identity:</span>
              {config.member_urn && (
                <Button
                  size="sm"
                  variant={config.account_type === "person" ? "default" : "outline"}
                  className="h-7 text-xs gap-1"
                  onClick={() => void handleSwitchIdentity("person")}
                >
                  <User className="h-3 w-3" />
                  Personal Profile
                </Button>
              )}
              {organizations.map((org) => (
                <Button
                  key={org.id}
                  size="sm"
                  variant={
                    config.account_type === "organization" && config.organization_id === org.id
                      ? "default"
                      : "outline"
                  }
                  className="h-7 text-xs gap-1"
                  onClick={() => void handleSwitchIdentity("organization", org)}
                >
                  <Building2 className="h-3 w-3" />
                  {org.name}
                </Button>
              ))}
            </div>
          )}

          {/* Action Tabs */}
          <div className="border-t pt-4">
            <div className="inline-flex flex-wrap rounded-xl border bg-muted/60 p-1 gap-1 mb-5">
              {(
                [
                  { id: "publish", label: "Publish Post", icon: Send },
                  { id: "posts", label: "Posts & Comments", icon: MessageCircle },
                  { id: "analytics", label: "Page Analytics", icon: BarChart3 },
                  { id: "leads", label: "Lead Gen Sync", icon: Users },
                  { id: "setup", label: "Webhooks & OAuth", icon: Shield },
                ] as const
              ).map((tab) => {
                const Icon = tab.icon;
                const active = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => {
                      setActiveTab(tab.id);
                      if (tab.id === "posts") void loadPosts();
                      if (tab.id === "analytics") void loadAnalytics();
                      if (tab.id === "leads") void loadLeads();
                    }}
                    className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${active
                        ? "bg-card text-foreground shadow-xs"
                        : "text-muted-foreground hover:text-foreground"
                      }`}
                  >
                    <Icon className="h-3.5 w-3.5 text-[#0A66C2]" />
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {/* TAB 1: Publish Post */}
            {activeTab === "publish" && (
              <form onSubmit={handlePublish} className="space-y-4 max-w-2xl">
                <div className="flex flex-wrap items-center gap-2">
                  {(
                    [
                      { id: "text", label: "Text Post", icon: FileText },
                      { id: "article", label: "Link / Article Share", icon: Link2 },
                      { id: "image", label: "Image Post", icon: ImageIcon },
                    ] as const
                  ).map((t) => {
                    const Icon = t.icon;
                    return (
                      <Button
                        key={t.id}
                        type="button"
                        size="sm"
                        variant={postType === t.id ? "default" : "outline"}
                        className="h-8 text-xs gap-1.5"
                        onClick={() => setPostType(t.id)}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {t.label}
                      </Button>
                    );
                  })}
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Post Commentary *</Label>
                  <Textarea
                    rows={5}
                    value={postText}
                    onChange={(e) => setPostText(e.target.value)}
                    placeholder="Share an update, RegiBIZ announcement, or product insight on LinkedIn..."
                    className="field-sizing-fixed min-h-[130px] max-h-[260px] resize-y overflow-y-auto text-sm"
                    required
                  />
                </div>

                {postType === "article" && (
                  <div className="grid gap-3 rounded-lg border bg-muted/20 p-3 sm:grid-cols-2">
                    <div className="space-y-1 sm:col-span-2">
                      <Label className="text-xs">Article / Landing URL *</Label>
                      <Input
                        value={articleUrl}
                        onChange={(e) => setArticleUrl(e.target.value)}
                        placeholder="https://regibiz.in"
                        className="text-xs"
                        required
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Title (Optional)</Label>
                      <Input
                        value={articleTitle}
                        onChange={(e) => setArticleTitle(e.target.value)}
                        placeholder="Simplify GST & Company Registration"
                        className="text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Description (Optional)</Label>
                      <Input
                        value={articleDescription}
                        onChange={(e) => setArticleDescription(e.target.value)}
                        placeholder="CA-backed business compliance by CloudMaSa"
                        className="text-xs"
                      />
                    </div>
                  </div>
                )}

                {postType === "image" && (
                  <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
                    <Label className="text-xs">Image URL or Upload Image</Label>
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        value={imageUrl}
                        onChange={(e) => setImageUrl(e.target.value)}
                        placeholder="https://... or upload below"
                        className="flex-1 text-xs"
                        required
                      />
                      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted">
                        {uploadingImg ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <UploadCloud className="h-3.5 w-3.5" />
                        )}
                        Upload
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={handleImageUpload}
                        />
                      </label>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">Visibility:</span>
                    <Button
                      type="button"
                      size="sm"
                      variant={postVisibility === "PUBLIC" ? "secondary" : "ghost"}
                      className="h-7 text-xs"
                      onClick={() => setPostVisibility("PUBLIC")}
                    >
                      Anyone (PUBLIC)
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={postVisibility === "CONNECTIONS" ? "secondary" : "ghost"}
                      className="h-7 text-xs"
                      onClick={() => setPostVisibility("CONNECTIONS")}
                    >
                      Connections Only
                    </Button>
                  </div>

                  <Button
                    type="submit"
                    disabled={publishing}
                    className="bg-[#0A66C2] hover:bg-[#09539d] text-white text-xs h-9 gap-1.5"
                  >
                    {publishing ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Send className="h-3.5 w-3.5" />
                    )}
                    Publish to LinkedIn
                  </Button>
                </div>
              </form>
            )}

            {/* TAB 2: Posts & Comments */}
            {activeTab === "posts" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Recent LinkedIn Posts</h3>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs gap-1.5"
                    onClick={loadPosts}
                    disabled={loadingPosts}
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${loadingPosts ? "animate-spin" : ""}`} />
                    Refresh Posts
                  </Button>
                </div>

                {postsError && (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
                    {postsError}
                  </div>
                )}

                {loadingPosts ? (
                  <div className="py-8 flex justify-center">
                    <Loader2 className="h-5 w-5 animate-spin text-[#0A66C2]" />
                  </div>
                ) : posts.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No posts returned for {selectedAuthorUrn || "this account"} yet.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {posts.map((post) => {
                      const comments = commentsByPost[post.urn];
                      return (
                        <div key={post.urn} className="rounded-lg border bg-background p-4 space-y-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="space-y-1">
                              <p className="text-sm whitespace-pre-wrap">{post.text || "(Media / Article Post)"}</p>
                              {post.articleUrl && (
                                <a
                                  href={post.articleUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-xs text-[#0A66C2] hover:underline inline-flex items-center gap-1"
                                >
                                  {post.articleTitle || post.articleUrl}
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              )}
                              <p className="text-[11px] text-muted-foreground font-mono">
                                {post.createdAt ? new Date(post.createdAt).toLocaleString() : ""} · {post.urn}
                              </p>
                            </div>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                              onClick={() => void handleDeletePost(post.urn)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>

                          <div className="flex items-center gap-2 border-t pt-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs gap-1"
                              onClick={() => void loadComments(post.urn)}
                              disabled={commentLoadingPost === post.urn}
                            >
                              {commentLoadingPost === post.urn ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <MessageCircle className="h-3 w-3" />
                              )}
                              {comments ? `Refresh Comments (${comments.length})` : "Load Comments"}
                            </Button>
                          </div>

                          {comments && (
                            <div className="space-y-2 rounded-md bg-muted/40 p-3 text-xs">
                              {comments.length === 0 ? (
                                <p className="text-muted-foreground">No comments on this post yet.</p>
                              ) : (
                                comments.map((c) => (
                                  <div key={c.urn} className="border-b border-border/50 pb-1.5 last:border-none">
                                    <span className="font-mono text-[10px] text-muted-foreground">
                                      {c.actorUrn}
                                    </span>
                                    <p>{c.text}</p>
                                  </div>
                                ))
                              )}
                              <div className="flex gap-2 pt-1">
                                <Input
                                  value={replyDrafts[post.urn] || ""}
                                  onChange={(e) =>
                                    setReplyDrafts((prev) => ({
                                      ...prev,
                                      [post.urn]: e.target.value,
                                    }))
                                  }
                                  placeholder="Write a comment..."
                                  className="h-8 text-xs"
                                />
                                <Button
                                  size="sm"
                                  className="h-8 text-xs"
                                  onClick={() => void handleReplyComment(post.urn)}
                                >
                                  Comment
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* TAB 3: Company Analytics */}
            {activeTab === "analytics" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Company Page Analytics</h3>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs gap-1.5"
                    onClick={loadAnalytics}
                    disabled={loadingAnalytics}
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${loadingAnalytics ? "animate-spin" : ""}`} />
                    Refresh Metrics
                  </Button>
                </div>

                {analyticsError && (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
                    {analyticsError}
                  </div>
                )}

                {analytics && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      { label: "Followers", val: analytics.followerCount },
                      { label: "Impressions", val: analytics.impressionCount },
                      { label: "Clicks", val: analytics.clickCount },
                      { label: "Likes", val: analytics.likeCount },
                      { label: "Comments", val: analytics.commentCount },
                      { label: "Shares", val: analytics.shareCount },
                      { label: "Unique Reach", val: analytics.uniqueImpressionsCount },
                      {
                        label: "Engagement Rate",
                        val:
                          analytics.engagementRate != null
                            ? `${(analytics.engagementRate * 100).toFixed(2)}%`
                            : null,
                      },
                    ].map((metric) => (
                      <div key={metric.label} className="rounded-lg border bg-background p-3">
                        <p className="text-[11px] text-muted-foreground">{metric.label}</p>
                        <p className="text-lg font-bold mt-1">
                          {metric.val != null ? metric.val.toLocaleString() : "—"}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* TAB 4: Lead Gen Sync */}
            {activeTab === "leads" && (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold">LinkedIn Lead Gen Form Sync</h3>
                    <p className="text-xs text-muted-foreground">
                      Pull Company Page &amp; ad Lead Gen Form submissions into MaSaCRM Contacts &amp; trigger <code className="font-mono">new_contact_created</code> automations.
                    </p>
                  </div>
                  <Button
                    size="sm"
                    className="bg-[#0A66C2] hover:bg-[#09539d] text-white h-8 text-xs gap-1.5"
                    onClick={handleSyncLeads}
                    disabled={syncingLeads}
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${syncingLeads ? "animate-spin" : ""}`} />
                    Sync LinkedIn Leads
                  </Button>
                </div>

                {loadingLeads ? (
                  <div className="py-6 flex justify-center">
                    <Loader2 className="h-5 w-5 animate-spin text-[#0A66C2]" />
                  </div>
                ) : leads.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No LinkedIn leads synced to this project yet.
                  </p>
                ) : (
                  <div className="divide-y rounded-lg border text-xs">
                    {leads.map((l) => (
                      <div key={l.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                        <div>
                          <p className="font-semibold">{l.name || "LinkedIn Lead"}</p>
                          <p className="text-muted-foreground">
                            {[l.email, l.company, l.phone].filter(Boolean).join(" · ")}
                          </p>
                        </div>
                        <span className="text-[11px] text-muted-foreground">
                          {new Date(l.created_at).toLocaleDateString()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* TAB 5: Webhooks & OAuth Setup */}
            {activeTab === "setup" && (
              <div className="space-y-3 max-w-2xl">
                <div className="space-y-1">
                  <Label className="text-xs font-medium">Webhook Callback URL</Label>
                  <div className="flex items-center gap-2">
                    <Input readOnly value={resolvedWebhook} className="font-mono text-xs h-8 bg-muted/40" />
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs"
                      onClick={() => copyValue("wh", resolvedWebhook)}
                    >
                      {copiedKey === "wh" ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Supports LinkedIn challenge validation (<code className="font-mono">GET ?challengeCode=...</code>) and <code className="font-mono">X-LI-Signature</code> HMAC-SHA256 verification using your saved LinkedIn Client Secret.
                  </p>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs font-medium">OAuth 2.0 Redirect URL</Label>
                  <div className="flex items-center gap-2">
                    <Input readOnly value={resolvedRedirectUri} className="font-mono text-xs h-8 bg-muted/40" />
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs"
                      onClick={() => copyValue("oauth", resolvedRedirectUri)}
                    >
                      {copiedKey === "oauth" ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                </div>

                {defaultVerifyToken && (
                  <div className="space-y-1">
                    <Label className="text-xs font-medium">Fallback Webhook Verify Secret</Label>
                    <Input readOnly value={defaultVerifyToken} className="font-mono text-xs h-8 bg-muted/40" />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

