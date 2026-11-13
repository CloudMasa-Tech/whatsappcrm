"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  Database,
  ExternalLink,
  ImagePlus,
  Inbox,
  KeyRound,
  Loader2,
  MessageCircle,
  RefreshCw,
  Send,
  Shield,
  Trash2,
  Unlink,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { XBrandIcon } from "@/components/icons/x";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { XConfigSafeRow, XMentionItem, XTweetItem } from "@/lib/x/types";
import { cn } from "@/lib/utils";

interface XConfigProps {
  canDisconnect?: boolean;
}

const SQL_MIGRATION_064 = `-- Run supabase/migrations/064_x_integration.sql in Supabase SQL Editor
CREATE TABLE IF NOT EXISTS public.x_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  connection_method TEXT NOT NULL DEFAULT 'oauth' CHECK (connection_method IN ('token', 'oauth')),
  x_user_id TEXT,
  username TEXT,
  display_name TEXT,
  description TEXT,
  profile_image_url TEXT,
  followers_count INTEGER NOT NULL DEFAULT 0,
  following_count INTEGER NOT NULL DEFAULT 0,
  tweet_count INTEGER NOT NULL DEFAULT 0,
  verified BOOLEAN NOT NULL DEFAULT false,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  client_id TEXT,
  client_secret TEXT,
  granted_scopes TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('connected', 'disconnected', 'error')),
  last_error TEXT,
  connected_at TIMESTAMPTZ,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id)
);

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS x_user_id TEXT,
  ADD COLUMN IF NOT EXISTS x_username TEXT,
  ADD COLUMN IF NOT EXISTS x_url TEXT;`;

export function XConfig({ canDisconnect = true }: XConfigProps) {
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<XConfigSafeRow | null>(null);
  const [tableMissing, setTableMissing] = useState(false);
  const [oauthRedirectUri, setOauthRedirectUri] = useState("");
  const [envOAuthConfigured, setEnvOAuthConfigured] = useState(false);

  // Auth setup inputs
  const [authTab, setAuthTab] = useState<"oauth" | "token">("oauth");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [savingCreds, setSavingCreds] = useState(false);
  const [connectingToken, setConnectingToken] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Hub workspace tabs
  const [hubTab, setHubTab] = useState<"compose" | "dm" | "mentions">("compose");
  const [tweetText, setTweetText] = useState("");
  const [mediaUrls, setMediaUrls] = useState<string[]>([]);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [posting, setPosting] = useState(false);

  // Direct Messages & Campaign state
  const [dmRecipients, setDmRecipients] = useState("");
  const [dmText, setDmText] = useState("");
  const [dmSending, setDmSending] = useState(false);
  const [dmBatchResults, setDmBatchResults] = useState<
    Array<{ recipient: string; status: "sent" | "failed"; error?: string; messageId?: string }>
  | null>(null);
  const [syncingDms, setSyncingDms] = useState(false);

  const [postsLoading, setPostsLoading] = useState(false);
  const [posts, setPosts] = useState<XTweetItem[]>([]);
  const [mentionsLoading, setMentionsLoading] = useState(false);
  const [mentions, setMentions] = useState<XMentionItem[]>([]);
  const [syncingContacts, setSyncingContacts] = useState(false);
  const [replyOpenId, setReplyOpenId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [replySending, setReplySending] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const parsedDmRecipients = dmRecipients
    .split(/[\n,;]+/)
    .map((s) => s.trim().replace(/^@+/, ""))
    .filter(Boolean);

  const applyConfigPayload = useCallback(
    (json: {
      config?: XConfigSafeRow;
      table_missing?: boolean;
      oauth_redirect_uri?: string;
      env_oauth_configured?: boolean;
    }) => {
      setConfig(json.config ?? null);
      setTableMissing(Boolean(json.table_missing));
      setOauthRedirectUri(json.oauth_redirect_uri ?? "");
      setEnvOAuthConfigured(Boolean(json.env_oauth_configured));
      if (json.config?.client_id) {
        setClientId(json.config.client_id);
      }
    },
    [],
  );

  const refreshConfig = useCallback(async () => {
    try {
      const res = await fetch("/api/x/config", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to load X configuration");
      applyConfigPayload(json);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load X settings");
    } finally {
      setLoading(false);
    }
  }, [applyConfigPayload]);

  const loadPosts = useCallback(async () => {
    setPostsLoading(true);
    try {
      const res = await fetch("/api/x/posts", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to load X posts");
      setPosts((json.posts ?? []) as XTweetItem[]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load X timeline");
    } finally {
      setPostsLoading(false);
    }
  }, []);

  const loadMentions = useCallback(async () => {
    setMentionsLoading(true);
    try {
      const res = await fetch("/api/x/mentions", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to load X mentions");
      setMentions((json.mentions ?? []) as XMentionItem[]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load X mentions");
    } finally {
      setMentionsLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/x/config", { cache: "no-store" })
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        applyConfigPayload(json);
        if (json?.config?.status === "connected") {
          fetch("/api/x/posts", { cache: "no-store" })
            .then((r) => r.json())
            .then((pJson) => {
              if (!cancelled && Array.isArray(pJson?.posts)) {
                setPosts(pJson.posts);
              }
            })
            .catch(() => {});
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    // Surface OAuth query notifications if redirected back from callback
    if (typeof window !== "undefined") {
      const sp = new URLSearchParams(window.location.search);
      const oauthState = sp.get("oauth");
      const oauthErr = sp.get("oauth_error");
      if (oauthState === "connected") {
        toast.success("X account connected via OAuth 2.0!");
      } else if (oauthErr) {
        toast.error(oauthErr);
      }
    }

    return () => {
      cancelled = true;
    };
  }, [applyConfigPayload]);

  const copyValue = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Copy failed");
    }
  };

  const handleSaveOAuthAndConnect = async () => {
    if (!clientId.trim() && !envOAuthConfigured) {
      toast.error("Enter your X OAuth 2.0 Client ID first.");
      return;
    }

    setSavingCreds(true);
    try {
      if (clientId.trim() || clientSecret.trim()) {
        const res = await fetch("/api/x/config", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: clientId.trim() || undefined,
            client_secret: clientSecret.trim() || undefined,
          }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Failed to save X OAuth credentials");
      }

      window.location.href = "/api/x/oauth?action=authorize";
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start X OAuth");
      setSavingCreds(false);
    }
  };

  const handleConnectWithToken = async () => {
    if (!accessToken.trim()) {
      toast.error("Paste an X User Access Token first.");
      return;
    }
    setConnectingToken(true);
    try {
      const res = await fetch("/api/x/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          access_token: accessToken.trim(),
          client_id: clientId.trim() || undefined,
          client_secret: clientSecret.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to connect X account");
      setConfig(json.config);
      setAccessToken("");
      toast.success(`Connected X account @${json.profile?.username || "connected"}`);
      void loadPosts();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Connection failed");
    } finally {
      setConnectingToken(false);
    }
  };

  const handleSyncProfile = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/x/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync" }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Sync failed");
      setConfig(json.config);
      toast.success("X profile refreshed");
      void loadPosts();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to refresh X profile");
    } finally {
      setSyncing(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      const res = await fetch("/api/x/config", { method: "DELETE" });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error || "Disconnect failed");
      }
      await refreshConfig();
      setPosts([]);
      setMentions([]);
      toast.success("X account disconnected");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to disconnect X");
    } finally {
      setDisconnecting(false);
    }
  };

  const handleSyncInboxDms = async () => {
    setSyncingDms(true);
    try {
      const res = await fetch("/api/x/sync-inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ max_results: 50 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to sync X direct messages");
      toast.success(
        data.synced > 0
          ? `Synced ${data.synced} X direct message(s) to CRM inbox!`
          : "CRM inbox is already up to date with X DMs.",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to sync X direct messages");
    } finally {
      setSyncingDms(false);
    }
  };

  const handleSendDm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (parsedDmRecipients.length === 0 || !dmText.trim()) return;

    setDmSending(true);
    setDmBatchResults(null);
    try {
      const res = await fetch("/api/x/dm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipients: parsedDmRecipients,
          text: dmText.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to send X direct message");

      if (Array.isArray(data.results)) {
        setDmBatchResults(data.results);
      }

      if (data.sentCount > 0) {
        toast.success(
          parsedDmRecipients.length > 1
            ? `DM Campaign delivered to ${data.sentCount}/${parsedDmRecipients.length} users!`
            : `Direct message sent to @${parsedDmRecipients[0]}!`,
        );
        setDmText("");
        if (data.failedCount === 0) {
          setDmRecipients("");
        }
      } else if (data.failedCount > 0) {
        toast.error(
          `Could not deliver DM: ${
            data.results?.[0]?.error || "Please verify handle and permissions"
          }`,
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send X direct message");
    } finally {
      setDmSending(false);
    }
  };

  const handleUploadMedia = async (files: FileList) => {
    if (mediaUrls.length + files.length > 4) {
      toast.error("X supports up to 4 images or 1 video per post.");
      return;
    }
    setUploadingMedia(true);
    try {
      const nextUrls: string[] = [];
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/x/upload", { method: "POST", body: fd });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || `Failed uploading ${file.name}`);
        nextUrls.push(json.url as string);
      }
      setMediaUrls((prev) => [...prev, ...nextUrls]);
      toast.success(`Uploaded ${nextUrls.length} media file(s)`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploadingMedia(false);
    }
  };

  const handlePublishPost = async () => {
    if (!tweetText.trim() && mediaUrls.length === 0) {
      toast.error("Write a post or attach media first.");
      return;
    }
    setPosting(true);
    try {
      const res = await fetch("/api/x/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: tweetText.trim(),
          mediaUrls,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to publish X post");
      toast.success("Post published on X!");
      setTweetText("");
      setMediaUrls([]);
      void loadPosts();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to publish post");
    } finally {
      setPosting(false);
    }
  };

  const handleDeletePost = async (id: string) => {
    try {
      const res = await fetch(`/api/x/posts?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to delete post");
      setPosts((prev) => prev.filter((p) => p.id !== id));
      toast.success("Post deleted on X");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const handleReplyToMention = async (tweetId: string) => {
    if (!replyText.trim()) return;
    setReplySending(true);
    try {
      const res = await fetch("/api/x/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: replyText.trim(),
          replyToTweetId: tweetId,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to post reply");
      toast.success("Reply published on X!");
      setReplyOpenId(null);
      setReplyText("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Reply failed");
    } finally {
      setReplySending(false);
    }
  };

  const handleSyncMentionsToContacts = async () => {
    setSyncingContacts(true);
    try {
      const res = await fetch("/api/x/mentions", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Contact sync failed");
      toast.success(
        `Synced ${json.fetchedCount ?? 0} mention(s) — ${json.importedCount ?? 0} new CRM contact(s) added.`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed syncing X mentions");
    } finally {
      setSyncingContacts(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const isConnected = config?.status === "connected";

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 pb-12">
      {/* Page Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <XBrandIcon className="h-9 w-9 shrink-0" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                X (Twitter)
              </h1>
              <Badge
                variant="outline"
                className={cn(
                  "text-[11px]",
                  isConnected
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                    : "border-zinc-700 bg-zinc-900 text-zinc-400",
                )}
              >
                {isConnected ? "Connected" : "Not Connected"}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Connect X API v2 (OAuth 2.0 PKCE or User Access Token) to publish posts, attach media,
              track mentions, and include X in Social Campaigns.
            </p>
          </div>
        </div>

        {isConnected && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleSyncProfile()}
              disabled={syncing}
            >
              <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", syncing && "animate-spin")} />
              Sync Profile
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleSyncInboxDms()}
              disabled={syncingDms}
              className="border-purple-500/30 text-purple-600 dark:text-purple-400 hover:bg-purple-500/10 font-medium text-xs gap-1.5"
            >
              <Inbox className={cn("h-3.5 w-3.5", syncingDms && "animate-spin")} />
              {syncingDms ? "Syncing DMs..." : "Sync DMs"}
            </Button>
            <Button
              type="button"
              size="sm"
              className="bg-violet-600 hover:bg-violet-500 text-white font-medium text-xs shadow-xs"
              onClick={() => (window.location.href = "/inbox")}
            >
              <XBrandIcon className="mr-1.5 h-3.5 w-3.5" /> Open Inbox
            </Button>
            {canDisconnect && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="border-red-500/30 text-red-400 hover:bg-red-500/10"
                onClick={() => void handleDisconnect()}
                disabled={disconnecting}
              >
                <Unlink className="mr-1.5 h-3.5 w-3.5" />
                Disconnect
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Missing SQL Migration Notice */}
      {tableMissing && (
        <section className="space-y-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <Database className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
              <div>
                <h2 className="text-sm font-semibold text-amber-200">
                  Run Migration 064 in Supabase First
                </h2>
                <p className="text-xs text-amber-200/80">
                  The <code>x_config</code> table has not been applied to this database yet. Copy the
                  SQL below into Supabase SQL Editor, then refresh this page.
                </p>
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => void copyValue("sql", SQL_MIGRATION_064)}
            >
              {copiedKey === "sql" ? <Check className="mr-1.5 h-3.5 w-3.5" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}
              Copy SQL
            </Button>
          </div>
        </section>
      )}

      {/* Connected Profile Overview */}
      {isConnected && config && (
        <section className="grid gap-4 rounded-xl border border-border/60 bg-card/60 p-4 sm:grid-cols-4">
          <div className="flex items-center gap-3 sm:col-span-2">
            {config.profile_image_url ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={config.profile_image_url}
                alt={config.display_name || "X Avatar"}
                className="h-12 w-12 rounded-full border border-border object-cover"
              />
            ) : (
              <XBrandIcon className="h-12 w-12" />
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="truncate font-semibold text-foreground">
                  {config.display_name || "X Account"}
                </p>
                {config.verified && <CheckCircle2 className="h-4 w-4 text-sky-400" />}
              </div>
              <p className="truncate text-xs text-muted-foreground">
                @{config.username}
              </p>
              {config.description && (
                <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                  {config.description}
                </p>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-border/50 bg-background/50 p-3">
            <p className="text-[11px] text-muted-foreground">Followers / Following</p>
            <p className="mt-1 text-lg font-bold text-foreground">
              {config.followers_count.toLocaleString()}{" "}
              <span className="text-xs font-normal text-muted-foreground">
                / {config.following_count.toLocaleString()}
              </span>
            </p>
          </div>

          <div className="rounded-lg border border-border/50 bg-background/50 p-3">
            <p className="text-[11px] text-muted-foreground">Total Posts</p>
            <p className="mt-1 text-lg font-bold text-foreground">
              {config.tweet_count.toLocaleString()}
            </p>
          </div>
        </section>
      )}

      {/* Connection Setup Section (shown prominently if disconnected, collapsible if connected) */}
      {!isConnected && (
        <section className="space-y-4 rounded-xl border border-border/60 bg-card/60 p-5">
          <div className="flex flex-wrap items-center gap-2 border-b border-border/50 pb-3">
            <button
              type="button"
              onClick={() => setAuthTab("oauth")}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                authTab === "oauth"
                  ? "bg-violet-600 text-white"
                  : "bg-background/60 text-muted-foreground hover:text-foreground",
              )}
            >
              <Shield className="mr-1.5 inline h-3.5 w-3.5" />
              OAuth 2.0 PKCE (Recommended)
            </button>
            <button
              type="button"
              onClick={() => setAuthTab("token")}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                authTab === "token"
                  ? "bg-violet-600 text-white"
                  : "bg-background/60 text-muted-foreground hover:text-foreground",
              )}
            >
              <KeyRound className="mr-1.5 inline h-3.5 w-3.5" />
              Direct User Access Token
            </button>
          </div>

          {authTab === "oauth" ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-border/60 bg-background/50 p-3 text-xs text-muted-foreground">
                <p className="font-medium text-foreground">Callback / Redirect URL for X Developer Portal:</p>
                <div className="mt-1.5 flex items-center justify-between gap-2 rounded border border-border/50 bg-background px-2.5 py-1.5 font-mono text-[11px]">
                  <span className="truncate">{oauthRedirectUri}</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-xs"
                    onClick={() => void copyValue("redirect", oauthRedirectUri)}
                  >
                    {copiedKey === "redirect" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  </Button>
                </div>
                <p className="mt-2">
                  Enable <strong>OAuth 2.0</strong> (Type of App: Web App) with{" "}
                  <strong>Read and write</strong> permissions and scopes:{" "}
                  <code>tweet.read tweet.write users.read media.write offline.access</code>.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="x-client-id" className="text-xs">
                    X OAuth 2.0 Client ID {envOAuthConfigured ? "(or use server env)" : "*"}
                  </Label>
                  <Input
                    id="x-client-id"
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    placeholder="e.g. Q1p2R3s4T5u6V7w8..."
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="x-client-secret" className="text-xs">
                    X Client Secret (Confidential Client / Optional for Public PKCE)
                  </Label>
                  <Input
                    id="x-client-secret"
                    type="password"
                    value={clientSecret}
                    onChange={(e) => setClientSecret(e.target.value)}
                    placeholder={config?.has_client_secret ? "•••••••• (saved)" : "Optional for confidential apps"}
                  />
                </div>
              </div>

              <Button
                type="button"
                onClick={() => void handleSaveOAuthAndConnect()}
                disabled={savingCreds}
                className="bg-zinc-900 text-white hover:bg-zinc-800 border border-zinc-700"
              >
                {savingCreds ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <XBrandIcon className="mr-2 h-4 w-4" />
                )}
                Connect with X (OAuth 2.0)
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="x-access-token" className="text-xs">
                  X OAuth 2.0 User Context Access Token
                </Label>
                <Textarea
                  id="x-access-token"
                  rows={3}
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.target.value)}
                  placeholder="Paste your OAuth 2.0 User Context Bearer token..."
                  className="font-mono text-xs"
                />
                <p className="text-[11px] text-muted-foreground">
                  Must be a User Context token (not an App-Only Bearer token) with{" "}
                  <code>tweet.read</code>, <code>tweet.write</code>, <code>users.read</code>, and{" "}
                  <code>media.write</code>.
                </p>
              </div>
              <Button
                type="button"
                onClick={() => void handleConnectWithToken()}
                disabled={connectingToken}
              >
                {connectingToken ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <KeyRound className="mr-2 h-4 w-4" />
                )}
                Verify &amp; Save Token
              </Button>
            </div>
          )}

          {config?.last_error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{config.last_error}</span>
            </div>
          )}
        </section>
      )}

      {/* Connected Hub: Compose, Timeline, Mentions */}
      {isConnected && (
        <section className="space-y-4 rounded-xl border border-border/60 bg-card/60 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setHubTab("compose")}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-medium",
                  hubTab === "compose"
                    ? "bg-violet-600 text-white font-bold"
                    : "bg-background/50 text-muted-foreground hover:text-foreground",
                )}
              >
                Studio (Post / Media)
              </button>
              <button
                type="button"
                onClick={() => setHubTab("dm")}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-medium flex items-center gap-1.5",
                  hubTab === "dm"
                    ? "bg-violet-600 text-white font-bold"
                    : "bg-background/50 text-muted-foreground hover:text-foreground",
                )}
              >
                <Send className="h-3.5 w-3.5 text-sky-400" />
                Direct Messages
              </button>
              <button
                type="button"
                onClick={() => {
                  setHubTab("mentions");
                  if (mentions.length === 0) void loadMentions();
                }}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-medium flex items-center gap-1.5",
                  hubTab === "mentions"
                    ? "bg-violet-600 text-white font-bold"
                    : "bg-background/50 text-muted-foreground hover:text-foreground",
                )}
              >
                <MessageCircle className="h-3.5 w-3.5" />
                Mentions &amp; CRM Sync
              </button>
            </div>

            {hubTab === "dm" && (
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void handleSyncInboxDms()}
                  disabled={syncingDms}
                  className="text-xs"
                >
                  <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", syncingDms && "animate-spin")} />
                  {syncingDms ? "Syncing..." : "Sync DMs"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="bg-violet-600 text-white hover:bg-violet-500 text-xs shadow-xs"
                  onClick={() => (window.location.href = "/inbox")}
                >
                  Open Inbox
                </Button>
              </div>
            )}
          </div>

          {hubTab === "compose" && (
            <div className="space-y-6">
              {/* Quick Post Composer */}
              <div className="space-y-3 rounded-lg border border-border/60 bg-background/40 p-4">
                <div className="flex items-center justify-between">
                  <Label htmlFor="x-composer-text" className="text-xs font-semibold">
                    Publish Post to @{config?.username}
                  </Label>
                  <span
                    className={cn(
                      "text-xs",
                      tweetText.length > 280 ? "text-amber-400" : "text-muted-foreground",
                    )}
                  >
                    {tweetText.length} / 280 chars
                  </span>
                </div>
                <Textarea
                  id="x-composer-text"
                  rows={4}
                  value={tweetText}
                  onChange={(e) => setTweetText(e.target.value)}
                  placeholder="What's happening? Post an update directly to X..."
                />

                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/*,video/*"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.length) void handleUploadMedia(e.target.files);
                    e.target.value = "";
                  }}
                />

                {mediaUrls.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {mediaUrls.map((url, idx) => (
                      <div
                        key={url}
                        className="relative flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs"
                      >
                        <span className="max-w-[180px] truncate">{url.split("/").pop()}</span>
                        <button
                          type="button"
                          onClick={() =>
                            setMediaUrls((prev) => prev.filter((_, i) => i !== idx))
                          }
                          className="text-muted-foreground hover:text-red-400"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={uploadingMedia || mediaUrls.length >= 4}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {uploadingMedia ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ImagePlus className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    Attach Photo / Video
                  </Button>

                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void handlePublishPost()}
                    disabled={posting || uploadingMedia}
                    className="bg-violet-600 text-white hover:bg-violet-500"
                  >
                    {posting ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Send className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    Post to X
                  </Button>
                </div>
              </div>

              {/* Recent X Posts */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-foreground">Recent Posts</h3>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => void loadPosts()}
                    disabled={postsLoading}
                  >
                    <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", postsLoading && "animate-spin")} />
                    Refresh
                  </Button>
                </div>

                {postsLoading && posts.length === 0 ? (
                  <div className="flex h-24 items-center justify-center">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : posts.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No recent posts returned.</p>
                ) : (
                  <div className="space-y-2.5">
                    {posts.map((post) => (
                      <div
                        key={post.id}
                        className="rounded-lg border border-border/60 bg-background/50 p-3.5 text-sm"
                      >
                        <p className="whitespace-pre-wrap text-foreground">{post.text}</p>
                        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                          <div className="flex flex-wrap items-center gap-3">
                            <span>{post.replyCount} replies</span>
                            <span>{post.retweetCount} reposts</span>
                            <span>{post.likeCount} likes</span>
                            <span>{post.impressionCount} views</span>
                            {post.createdAt && (
                              <span>{new Date(post.createdAt).toLocaleString()}</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            {post.permalink && (
                              <a
                                href={post.permalink}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-violet-400 hover:underline"
                              >
                                View <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                            <button
                              type="button"
                              onClick={() => void handleDeletePost(post.id)}
                              className="inline-flex items-center gap-1 text-red-400 hover:text-red-300"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB: Direct Messages & Campaign */}
          {hubTab === "dm" && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Left Column: Direct Message & Campaign Sender */}
              <div className="space-y-4 rounded-xl border border-border/60 bg-background/40 p-5">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold flex items-center gap-2 text-foreground">
                    <Send className="h-4 w-4 text-sky-400" /> Send Direct Message &amp; DM Campaign
                  </h4>
                  {parsedDmRecipients.length > 1 && (
                    <span className="rounded-full bg-sky-500/10 px-2 py-0.5 text-[10px] font-semibold text-sky-400 border border-sky-500/30">
                      🎯 Campaign Mode ({parsedDmRecipients.length} Users)
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Send an instant 1-on-1 direct message or campaign with multiple targeted users by entering handles separated by commas or new lines (e.g. <code>@hari, @alex, @john</code>). Incoming replies stream into the CRM Unified Inbox.
                </p>

                <form onSubmit={handleSendDm} className="space-y-3.5">
                  <div className="space-y-1.5">
                    <Label htmlFor="x-dm-recipients" className="text-xs font-semibold text-foreground">
                      Recipient X Username(s)
                    </Label>
                    <div className="relative">
                      <div className="absolute left-3 top-2.5 text-xs text-muted-foreground">@</div>
                      <Input
                        id="x-dm-recipients"
                        placeholder="username or @user1, @user2, @user3..."
                        value={dmRecipients}
                        onChange={(e) => setDmRecipients(e.target.value)}
                        className="pl-7 text-xs font-mono"
                        required
                      />
                    </div>
                    {parsedDmRecipients.length > 1 && (
                      <div className="flex flex-wrap gap-1 pt-1">
                        {parsedDmRecipients.slice(0, 8).map((handle) => (
                          <span
                            key={handle}
                            className="rounded bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-mono text-sky-300"
                          >
                            @{handle}
                          </span>
                        ))}
                        {parsedDmRecipients.length > 8 && (
                          <span className="text-[10px] text-muted-foreground">
                            +{parsedDmRecipients.length - 8} more
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="x-dm-text" className="text-xs font-semibold text-foreground">
                        Message
                      </Label>
                      <span
                        className={cn(
                          "text-[11px]",
                          dmText.length > 10000 ? "text-amber-400" : "text-muted-foreground",
                        )}
                      >
                        {dmText.length} chars
                      </span>
                    </div>
                    <Textarea
                      id="x-dm-text"
                      rows={4}
                      placeholder="Type your direct message or campaign pitch..."
                      value={dmText}
                      onChange={(e) => setDmText(e.target.value)}
                      className="text-xs resize-none"
                      required
                    />
                  </div>

                  <Button
                    type="submit"
                    size="sm"
                    disabled={dmSending || parsedDmRecipients.length === 0 || !dmText.trim()}
                    className="w-full bg-sky-600 hover:bg-sky-500 text-white font-medium shadow-xs"
                  >
                    {dmSending ? (
                      <>
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        {parsedDmRecipients.length > 1
                          ? `Sending Campaign (${parsedDmRecipients.length} Users)...`
                          : "Sending Direct Message..."}
                      </>
                    ) : (
                      <>
                        <Send className="mr-1.5 h-3.5 w-3.5" />
                        {parsedDmRecipients.length > 1
                          ? `Launch DM Campaign to ${parsedDmRecipients.length} Users`
                          : "Send Direct Message"}
                      </>
                    )}
                  </Button>
                </form>

                {/* Batch Results summary */}
                {dmBatchResults && (
                  <div className="mt-4 space-y-2 rounded-lg border border-border/70 bg-background/60 p-3 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-foreground">
                        Campaign Delivery Summary ({dmBatchResults.filter((r) => r.status === "sent").length}/
                        {dmBatchResults.length} Delivered)
                      </span>
                      <button
                        type="button"
                        onClick={() => setDmBatchResults(null)}
                        className="text-[11px] text-muted-foreground hover:text-foreground"
                      >
                        Clear
                      </button>
                    </div>
                    <div className="max-h-40 space-y-1.5 overflow-y-auto pr-1">
                      {dmBatchResults.map((res) => (
                        <div
                          key={res.recipient}
                          className="flex items-center justify-between rounded border border-border/40 px-2 py-1"
                        >
                          <span className="font-mono text-xs">@{res.recipient}</span>
                          {res.status === "sent" ? (
                            <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-[10px]">
                              <CheckCircle2 className="mr-1 h-3 w-3" /> Delivered
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="border-red-500/30 bg-red-500/10 text-red-400 text-[10px]"
                              title={res.error}
                            >
                              <AlertCircle className="mr-1 h-3 w-3" /> Failed
                            </Badge>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Right Column: Sync Existing X DMs to CRM Inbox */}
              <div className="space-y-4 rounded-xl border border-border/60 bg-background/40 p-5 flex flex-col justify-between">
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold flex items-center gap-2 text-foreground">
                    <Inbox className="h-4 w-4 text-purple-400" /> Sync Existing X DMs to CRM Inbox
                  </h4>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Pull your recent X (Twitter) Direct Message conversations and messages into the Unified Inbox automatically (safe &amp; deduplicated — never creates duplicates).
                  </p>

                  <div className="space-y-2 rounded-lg border border-purple-500/20 bg-purple-500/5 p-3 text-xs text-purple-300">
                    <div className="flex items-center gap-1.5 font-medium">
                      <CheckCircle2 className="h-3.5 w-3.5 text-purple-400" />
                      Two-Way Synchronization
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Inbound and outbound X DMs are synchronized into the CRM. When customers message your handle on X, replies sent from the CRM Unified Inbox dispatch directly back via X API v2.
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 pt-4 border-t border-border/50">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void handleSyncInboxDms()}
                    disabled={syncingDms}
                    className="text-xs gap-1.5 border-purple-500/30 text-purple-400 hover:bg-purple-500/10"
                  >
                    <RefreshCw className={cn("h-3.5 w-3.5", syncingDms && "animate-spin")} />
                    {syncingDms ? "Syncing Direct Messages..." : "Pull Recent DMs Now"}
                  </Button>
                  <Button
                    type="button"
                    onClick={() => (window.location.href = "/inbox")}
                    className="text-xs bg-violet-600 hover:bg-violet-500 text-white font-medium"
                  >
                    Go to Unified Inbox
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* TAB: Mentions & CRM Sync */}
          {hubTab === "mentions" && (
            <div className="space-y-3">
              {mentionsLoading && mentions.length === 0 ? (
                <div className="flex h-28 items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : mentions.length === 0 ? (
                <p className="text-xs text-muted-foreground">No recent X mentions found.</p>
              ) : (
                mentions.map((m) => (
                  <div
                    key={m.id}
                    className="space-y-2 rounded-lg border border-border/60 bg-background/50 p-3.5 text-sm"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-foreground">
                          {m.authorName || `@${m.authorUsername || m.authorId}`}
                        </span>
                        {m.authorUsername && (
                          <span className="text-xs text-muted-foreground">
                            @{m.authorUsername}
                          </span>
                        )}
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => {
                          setReplyOpenId(replyOpenId === m.id ? null : m.id);
                          setReplyText(m.authorUsername ? `@${m.authorUsername} ` : "");
                        }}
                      >
                        Reply
                      </Button>
                    </div>
                    <p className="whitespace-pre-wrap text-xs text-foreground/90">{m.text}</p>
                    {replyOpenId === m.id && (
                      <div className="mt-2 flex gap-2">
                        <Input
                          value={replyText}
                          onChange={(e) => setReplyText(e.target.value)}
                          placeholder="Write reply on X..."
                          className="text-xs"
                        />
                        <Button
                          type="button"
                          size="sm"
                          disabled={replySending}
                          onClick={() => void handleReplyToMention(m.id)}
                        >
                          {replySending ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            "Send"
                          )}
                        </Button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

