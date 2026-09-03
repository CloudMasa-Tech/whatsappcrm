"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
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
  Film,
  Image as ImageIcon,
  Send,
  UploadCloud,
  Layers,
  Heart,
  MessageCircle,
  Bookmark,
  Share2,
  MoreHorizontal,
  Music,
  Trash2,
  Play,
  Pause,
  Search,
  CheckCheck,
  Users,
  UserCheck,
  Grid,
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
  followers_count?: number | null;
  following_count?: number | null;
  posts_count?: number | null;
  biography?: string | null;
  is_verified?: boolean;
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

const HASHTAG_SUGGESTIONS = [
  "#business",
  "#growth",
  "#innovation",
  "#marketing",
  "#tech",
  "#reels",
  "#viral",
  "#crm",
  "#sales",
  "#trending",
];

export function InstagramConfig({ canDisconnect = true }: InstagramConfigProps) {
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [syncingProfile, setSyncingProfile] = useState(false);
  const [tableMissing, setTableMissing] = useState(false);
  const [config, setConfig] = useState<InstagramStatus | null>(null);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [defaultVerifyToken, setDefaultVerifyToken] = useState("");

  // Direct login form state
  const [directAuthType, setDirectAuthType] = useState<"password" | "session_id">("password");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [validatedAccount, setValidatedAccount] = useState<{
    username: string;
    name: string;
    profilePictureUrl?: string;
    isVerified?: boolean;
    followersCount?: number | null;
  } | null>(null);
  const [validatingAccount, setValidatingAccount] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Quick DM Composer state
  const [quickDmRecipient, setQuickDmRecipient] = useState("");
  const [quickDmText, setQuickDmText] = useState("");
  const [quickDmSending, setQuickDmSending] = useState(false);

  // Post & Reel Publishing state
  const [publishType, setPublishType] = useState<"reel" | "post">("reel");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [mediaPreviewUrl, setMediaPreviewUrl] = useState<string>("");
  const [publishCaption, setPublishCaption] = useState("");
  const [publishShareToFeed, setPublishShareToFeed] = useState(true);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [activeActionTab, setActiveActionTab] = useState<"publish" | "dm">("publish");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const validateDebounceTimer = useRef<NodeJS.Timeout | null>(null);

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
      if (!res.ok) return;
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
      // Ignore background fetch error
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfig();
  }, []);

  // Sync Instagram Profile Details
  const handleSyncProfile = async () => {
    try {
      setSyncingProfile(true);
      const res = await fetch("/api/instagram/sync-profile", { method: "POST" });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to sync profile");
      }
      toast.success(`Refreshed details for @${data.username}!`);
      await fetchConfig();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to sync profile.");
    } finally {
      setSyncingProfile(false);
    }
  };

  // Validate Instagram Username Handler
  const handleValidateAccount = async (inputHandle: string) => {
    const raw = inputHandle.trim();
    if (!raw) {
      setValidatedAccount(null);
      setValidationError(null);
      return;
    }

    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
      setValidationError(
        "It looks like you entered an email address. Please enter your Instagram handle/username (e.g. cloudmasa_innovation) instead."
      );
      setValidatedAccount(null);
      return;
    }

    try {
      setValidatingAccount(true);
      setValidationError(null);
      const res = await fetch("/api/instagram/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: raw }),
      });
      if (!res.ok) {
        setValidatedAccount(null);
        return;
      }
      const data = await res.json();
      if (data.error) {
        setValidationError(data.error || "Could not find Instagram account.");
        setValidatedAccount(null);
      } else {
        setValidatedAccount(data);
        setValidationError(null);
      }
    } catch {
      // Ignore background preview validation error
    } finally {
      setValidatingAccount(false);
    }
  };

  const handleUsernameChange = (val: string) => {
    setUsername(val);
    setValidatedAccount(null);
    setValidationError(null);

    if (validateDebounceTimer.current) {
      clearTimeout(validateDebounceTimer.current);
    }

    if (val.trim().length >= 3) {
      validateDebounceTimer.current = setTimeout(() => {
        handleValidateAccount(val);
      }, 700);
    }
  };

  // Direct Login Submit
  const handleDirectLogin = async (e: React.FormEvent) => {
    e.preventDefault();

    if (directAuthType === "session_id") {
      if (!sessionId.trim()) {
        toast.error("Please enter your Instagram Session ID.");
        return;
      }
    } else {
      if (!username.trim() || !password) {
        toast.error("Please enter your Instagram username and password.");
        return;
      }

      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username.trim())) {
        toast.error("Please enter your Instagram handle/username (e.g. cloudmasa_innovation) instead of your email address.");
        return;
      }
    }

    try {
      setActionLoading(true);
      const res = await fetch("/api/instagram/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "login",
          username: username.trim() || undefined,
          password: directAuthType === "password" ? password : undefined,
          session_id: directAuthType === "session_id" ? sessionId.trim() : undefined,
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
      setSessionId("");
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
          connection_method: "cloud_api",
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
        throw new Error(data.error || "Failed to save Instagram Cloud API configuration");
      }

      toast.success("Instagram Meta Cloud API connected successfully!");
      setAccessToken("");
      await fetchConfig();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to configure Instagram Cloud API.");
    } finally {
      setActionLoading(false);
    }
  };

  // Disconnect Handler
  const handleDisconnect = async () => {
    if (!confirm("Are you sure you want to disconnect this Instagram account?")) return;

    try {
      setActionLoading(true);
      const res = await fetch("/api/instagram/config", {
        method: "DELETE",
      });

      if (!res.ok) throw new Error("Failed to disconnect Instagram");

      toast.success("Instagram account disconnected.");
      await fetchConfig();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to disconnect.");
    } finally {
      setActionLoading(false);
    }
  };

  // Quick DM Handler
  const handleSendQuickDm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickDmRecipient.trim()) {
      toast.error("Please enter a recipient username.");
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

  // Handle File Selection
  const handleFileSelect = (file: File) => {
    if (!file) return;

    const isVideo = file.type.startsWith("video/");
    const isImage = file.type.startsWith("image/");

    if (!isVideo && !isImage) {
      toast.error("Please select a valid video (MP4/MOV) or image (JPG/PNG/WEBP) file.");
      return;
    }

    if (isVideo && publishType !== "reel") {
      setPublishType("reel");
    } else if (isImage && publishType !== "post") {
      setPublishType("post");
    }

    setSelectedFile(file);
    const objectUrl = URL.createObjectURL(file);
    setMediaPreviewUrl(objectUrl);
    toast.success(`Loaded ${file.name} (${(file.size / (1024 * 1024)).toFixed(1)} MB)`);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  };

  const handleRemoveMedia = () => {
    if (mediaPreviewUrl && mediaPreviewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(mediaPreviewUrl);
    }
    setSelectedFile(null);
    setMediaPreviewUrl("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const addHashtag = (tag: string) => {
    if (publishCaption.includes(tag)) return;
    setPublishCaption((prev) => (prev ? `${prev} ${tag}` : tag));
  };

  const toggleVideoPlayback = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play();
      setIsPlaying(true);
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  };

  // Post & Reel Publishing Handler
  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile && !mediaPreviewUrl) {
      toast.error("Please upload a video or photo to publish.");
      return;
    }

    try {
      setPublishing(true);
      let targetPublicUrl = mediaPreviewUrl;

      // If user picked a local file, upload it to storage first
      if (selectedFile) {
        setUploadingMedia(true);
        const formData = new FormData();
        formData.append("file", selectedFile);

        const uploadRes = await fetch("/api/instagram/upload", {
          method: "POST",
          body: formData,
        });

        const uploadData = await uploadRes.json();
        setUploadingMedia(false);

        if (!uploadRes.ok || uploadData.error) {
          throw new Error(uploadData.error || "Failed to upload media file.");
        }

        targetPublicUrl = uploadData.url;
      }

      // Publish to Instagram
      const res = await fetch("/api/instagram/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: publishType,
          mediaUrl: targetPublicUrl,
          caption: publishCaption.trim(),
          shareToFeed: publishShareToFeed,
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to publish media.");
      }

      if (data.direct) {
        toast.info(data.message);
        handleOpenWebCreator();
      } else {
        toast.success(data.message || `Published ${publishType === "reel" ? "Reel" : "Post"} successfully to Instagram!`);
        handleRemoveMedia();
        setPublishCaption("");
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to publish to Instagram.");
    } finally {
      setPublishing(false);
      setUploadingMedia(false);
    }
  };

  const handleOpenWebCreator = () => {
    const popup = window.open(
      "https://www.instagram.com/create/select/",
      "InstagramWebCreator",
      "width=850,height=850,menubar=no,toolbar=no,location=no,status=no,resizable=yes"
    );
    if (popup) {
      toast.success("Instagram Web Creator opened! Drop your video or photo to share.");
    } else {
      window.open("https://www.instagram.com/create/select/", "_blank");
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

          <div className="flex flex-wrap gap-2 pt-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => copyToClipboard(SQL_MIGRATION_TEXT, "sql")}
              className="gap-1.5"
            >
              {copiedSql ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
              {copiedSql ? "Copied SQL!" : "Copy SQL Migration"}
            </Button>
            <a
              href="https://supabase.com/dashboard"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border bg-background hover:bg-muted text-foreground"
            >
              Open Supabase Dashboard <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>
      )}

      {/* Connected Account Card */}
      {isConnected && (
        <div className="p-6 rounded-2xl bg-card border shadow-xs space-y-6">
          <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-5">
            <div className="flex items-start sm:items-center gap-4">
              {config.profile_picture_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={config.profile_picture_url}
                  alt={config.username || "Instagram Account"}
                  referrerPolicy="no-referrer"
                  crossOrigin="anonymous"
                  className="h-20 w-20 rounded-full object-cover border-2 border-pink-500/40 ring-4 ring-pink-500/10 shadow-sm shrink-0"
                />
              ) : (
                <div className="h-20 w-20 rounded-full bg-gradient-to-tr from-yellow-500 via-pink-500 to-purple-600 flex items-center justify-center text-white font-bold text-3xl shadow-sm shrink-0">
                  {(config.name || config.username || "IG").charAt(0).toUpperCase()}
                </div>
              )}
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-xl font-bold text-foreground">
                    {config.name || config.username || "Instagram Account"}
                  </h3>
                  {config.is_verified && (
                    <CheckCircle2 className="h-4 w-4 text-blue-500 fill-blue-500 text-white" />
                  )}
                  <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-xs gap-1 font-semibold">
                    <CheckCircle2 className="h-3 w-3" /> Connected
                  </Badge>
                </div>
                <p className="text-sm font-semibold text-pink-600 dark:text-pink-400">
                  @{config.username || "instagram_user"}
                </p>

                {/* Profile Stats Badges */}
                <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-muted/60 border font-medium">
                    <Users className="h-3.5 w-3.5 text-pink-500" />
                    <strong>{config.followers_count !== null && config.followers_count !== undefined ? config.followers_count.toLocaleString() : "—"}</strong> Followers
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-muted/60 border font-medium">
                    <UserCheck className="h-3.5 w-3.5 text-purple-500" />
                    <strong>{config.following_count !== null && config.following_count !== undefined ? config.following_count.toLocaleString() : "—"}</strong> Following
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-muted/60 border font-medium">
                    <Grid className="h-3.5 w-3.5 text-indigo-500" />
                    <strong>{config.posts_count !== null && config.posts_count !== undefined ? config.posts_count.toLocaleString() : "—"}</strong> Posts
                  </span>
                </div>

                <div className="flex items-center gap-3 text-xs text-muted-foreground pt-1">
                  <span>
                    Method: {config.connection_method === "cloud_api" ? "Meta Cloud API" : "Direct Login (ID & Pass)"}
                  </span>
                  {config.connected_at && (
                    <span>• Connected {new Date(config.connected_at).toLocaleDateString()}</span>
                  )}
                </div>

                {config.biography && (
                  <p className="text-xs text-muted-foreground italic line-clamp-2 max-w-xl pt-1">
                    &ldquo;{config.biography}&rdquo;
                  </p>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 self-start lg:self-center">
              <Button
                variant="outline"
                size="sm"
                onClick={handleSyncProfile}
                disabled={syncingProfile || loading}
                className="font-medium text-xs gap-1.5 border-pink-500/30 text-pink-600 hover:bg-pink-500/10"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${syncingProfile || loading ? "animate-spin" : ""}`} />
                {syncingProfile ? "Syncing..." : "Sync Details"}
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

          {/* Action Switcher Header */}
          <div className="pt-4 border-t border-border">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-6">
              <div className="inline-flex rounded-xl bg-muted/60 p-1 border">
                <button
                  type="button"
                  onClick={() => setActiveActionTab("publish")}
                  className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg transition-all ${
                    activeActionTab === "publish"
                      ? "bg-card text-foreground shadow-xs font-bold"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Film className="h-4 w-4 text-pink-500" />
                  Instagram Studio (Post & Reel)
                </button>
                <button
                  type="button"
                  onClick={() => setActiveActionTab("dm")}
                  className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg transition-all ${
                    activeActionTab === "dm"
                      ? "bg-card text-foreground shadow-xs font-bold"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Send className="h-4 w-4 text-purple-500" />
                  Send Direct Message (DM)
                </button>
              </div>

              <Button
                size="sm"
                variant="outline"
                className="text-xs gap-1.5 border-pink-500/30 text-pink-600 hover:bg-pink-500/10 font-medium"
                onClick={handleOpenWebCreator}
              >
                <UploadCloud className="h-3.5 w-3.5" />
                Open Instagram Web Creator
              </Button>
            </div>

            {/* TAB 1: Complete Instagram Studio (Upload + Edit + Live Simulator) */}
            {activeActionTab === "publish" && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                {/* Left Side: Upload & Composer (7 Cols) */}
                <div className="lg:col-span-7 space-y-5 bg-card/60 rounded-2xl border p-5 shadow-xs">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-base font-bold flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-pink-500" /> Create Post or Reel
                      </h4>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Upload media, craft your caption, preview live, and publish straight to your profile.
                      </p>
                    </div>
                  </div>

                  <form onSubmit={handlePublish} className="space-y-4">
                    {/* Post Format Selector */}
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        1. Select Format
                      </Label>
                      <div className="grid grid-cols-2 gap-3">
                        <button
                          type="button"
                          onClick={() => setPublishType("reel")}
                          className={`flex items-center justify-center gap-2.5 p-3.5 rounded-xl border text-xs font-bold transition-all ${
                            publishType === "reel"
                              ? "bg-gradient-to-r from-pink-500/15 to-purple-500/15 border-pink-500 text-pink-600 dark:text-pink-400 ring-2 ring-pink-500/20 shadow-xs"
                              : "bg-muted/30 border-border text-muted-foreground hover:border-muted-foreground/40"
                          }`}
                        >
                          <Film className="h-4 w-4 text-pink-500" />
                          <span>Instagram Reel</span>
                          <Badge variant="secondary" className="text-[10px] h-4 px-1.5 bg-pink-500/20 text-pink-600">
                            9:16 Video
                          </Badge>
                        </button>
                        <button
                          type="button"
                          onClick={() => setPublishType("post")}
                          className={`flex items-center justify-center gap-2.5 p-3.5 rounded-xl border text-xs font-bold transition-all ${
                            publishType === "post"
                              ? "bg-gradient-to-r from-pink-500/15 to-purple-500/15 border-pink-500 text-pink-600 dark:text-pink-400 ring-2 ring-pink-500/20 shadow-xs"
                              : "bg-muted/30 border-border text-muted-foreground hover:border-muted-foreground/40"
                          }`}
                        >
                          <ImageIcon className="h-4 w-4 text-purple-500" />
                          <span>Photo Post</span>
                          <Badge variant="secondary" className="text-[10px] h-4 px-1.5 bg-purple-500/20 text-purple-600">
                            Feed Image
                          </Badge>
                        </button>
                      </div>
                    </div>

                    {/* Media Dropzone & File Picker */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          2. Upload Media
                        </Label>
                        {mediaPreviewUrl && (
                          <button
                            type="button"
                            onClick={handleRemoveMedia}
                            className="text-xs text-rose-500 hover:text-rose-600 flex items-center gap-1 font-medium"
                          >
                            <Trash2 className="h-3 w-3" /> Remove media
                          </button>
                        )}
                      </div>

                      <input
                        ref={fileInputRef}
                        type="file"
                        accept={publishType === "reel" ? "video/mp4,video/quicktime,video/webm" : "image/jpeg,image/png,image/webp"}
                        className="hidden"
                        onChange={(e) => {
                          if (e.target.files && e.target.files[0]) {
                            handleFileSelect(e.target.files[0]);
                          }
                        }}
                      />

                      {!mediaPreviewUrl ? (
                        <div
                          onDragOver={(e) => {
                            e.preventDefault();
                            setIsDragOver(true);
                          }}
                          onDragLeave={() => setIsDragOver(false)}
                          onDrop={handleDrop}
                          onClick={() => fileInputRef.current?.click()}
                          className={`flex flex-col items-center justify-center p-8 rounded-2xl border-2 border-dashed transition-all cursor-pointer ${
                            isDragOver
                              ? "border-pink-500 bg-pink-500/10 scale-[0.99]"
                              : "border-border/80 bg-muted/20 hover:bg-muted/40 hover:border-pink-500/50"
                          }`}
                        >
                          <div className="h-12 w-12 rounded-full bg-gradient-to-tr from-yellow-500 via-pink-500 to-purple-600 flex items-center justify-center text-white shadow-md mb-3">
                            {publishType === "reel" ? <Film className="h-6 w-6" /> : <ImageIcon className="h-6 w-6" />}
                          </div>
                          <p className="text-sm font-semibold text-foreground">
                            {publishType === "reel" ? "Click or drag & drop video here" : "Click or drag & drop image here"}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1 text-center">
                            {publishType === "reel"
                              ? "Supports MP4, MOV, or WEBM up to 50 MB"
                              : "Supports JPG, PNG, or WEBP high-resolution"}
                          </p>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            className="mt-4 gap-1.5 text-xs font-semibold rounded-lg"
                          >
                            <UploadCloud className="h-3.5 w-3.5" /> Browse Computer
                          </Button>
                        </div>
                      ) : (
                        <div className="relative rounded-2xl overflow-hidden border bg-black/90 flex items-center justify-center max-h-[280px]">
                          {publishType === "reel" ? (
                            <div className="relative w-full h-[260px] flex items-center justify-center">
                              <video
                                ref={videoRef}
                                src={mediaPreviewUrl}
                                className="h-full max-w-full object-contain rounded-xl"
                                onPlay={() => setIsPlaying(true)}
                                onPause={() => setIsPlaying(false)}
                                loop
                              />
                              <button
                                type="button"
                                onClick={toggleVideoPlayback}
                                className="absolute inset-0 m-auto h-12 w-12 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center backdrop-blur-xs transition-all"
                              >
                                {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 ml-0.5" />}
                              </button>
                            </div>
                          ) : (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={mediaPreviewUrl}
                              alt="Upload preview"
                              className="h-[260px] w-full object-contain"
                            />
                          )}

                          <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between px-3 py-1.5 rounded-lg bg-black/70 backdrop-blur-xs text-white text-xs">
                            <span className="truncate max-w-[200px]">
                              {selectedFile ? selectedFile.name : "Selected Media"}
                            </span>
                            <button
                              type="button"
                              onClick={() => fileInputRef.current?.click()}
                              className="underline text-pink-300 hover:text-pink-200 font-medium"
                            >
                              Change
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Caption & Hashtags */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="post-caption" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          3. Caption & Hashtags
                        </Label>
                        <span className="text-[11px] text-muted-foreground">
                          {publishCaption.length} / 2,200
                        </span>
                      </div>
                      <Textarea
                        id="post-caption"
                        rows={3}
                        placeholder="Write a captivating caption with emojis and tags... 🚀✨"
                        value={publishCaption}
                        onChange={(e) => setPublishCaption(e.target.value)}
                        className="text-xs bg-background resize-none focus-visible:ring-pink-500"
                      />

                      {/* Hashtag Quick Chips */}
                      <div className="space-y-1 pt-1">
                        <span className="text-[11px] text-muted-foreground">Trending Hashtags:</span>
                        <div className="flex flex-wrap gap-1.5">
                          {HASHTAG_SUGGESTIONS.map((tag) => (
                            <button
                              key={tag}
                              type="button"
                              onClick={() => addHashtag(tag)}
                              className={`text-[11px] px-2 py-0.5 rounded-full border transition-all ${
                                publishCaption.includes(tag)
                                  ? "bg-pink-500/20 border-pink-500/40 text-pink-600 font-bold"
                                  : "bg-muted/50 border-border text-muted-foreground hover:border-pink-500/40 hover:text-foreground"
                              }`}
                            >
                              {tag}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Reel Options */}
                    {publishType === "reel" && (
                      <div className="p-3 rounded-xl bg-muted/40 border space-y-2">
                        <label className="flex items-center gap-2.5 text-xs font-medium cursor-pointer text-foreground">
                          <input
                            type="checkbox"
                            checked={publishShareToFeed}
                            onChange={(e) => setPublishShareToFeed(e.target.checked)}
                            className="rounded border-border text-pink-600 focus:ring-pink-500 h-4 w-4"
                          />
                          <span>Share Reel to Profile Feed Grid</span>
                        </label>
                      </div>
                    )}

                    {/* Submit Buttons */}
                    <div className="flex gap-2 pt-2">
                      <Button
                        type="submit"
                        size="default"
                        disabled={publishing || uploadingMedia || (!selectedFile && !mediaPreviewUrl)}
                        className="flex-1 bg-gradient-to-r from-pink-600 via-rose-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white font-bold shadow-md h-11"
                      >
                        {uploadingMedia ? (
                          <>
                            <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Uploading Video/Photo...
                          </>
                        ) : publishing ? (
                          <>
                            <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Publishing to Instagram...
                          </>
                        ) : (
                          <>
                            <Sparkles className="h-4 w-4 mr-2" />
                            Publish {publishType === "reel" ? "Reel" : "Post"} Now
                          </>
                        )}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="default"
                        onClick={handleOpenWebCreator}
                        className="h-11 px-4 text-xs font-semibold border-border gap-1.5"
                      >
                        <ExternalLink className="h-4 w-4 text-muted-foreground" />
                        Web Creator
                      </Button>
                    </div>
                  </form>
                </div>

                {/* Right Side: Live Instagram Smartphone Preview Mockup (5 Cols) */}
                <div className="lg:col-span-5 flex flex-col items-center">
                  <div className="w-full max-w-[320px] rounded-[36px] bg-black border-[6px] border-neutral-800 shadow-2xl overflow-hidden relative text-white">
                    {/* Phone Notch */}
                    <div className="absolute top-2 left-1/2 -translate-x-1/2 h-4 w-28 bg-neutral-900 rounded-full z-20" />

                    {/* Instagram Header */}
                    <div className="pt-7 px-4 pb-2 flex items-center justify-between border-b border-neutral-800/80 bg-neutral-950/90 backdrop-blur-xs">
                      <div className="flex items-center gap-2">
                        {config.profile_picture_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={config.profile_picture_url}
                            alt="Avatar"
                            referrerPolicy="no-referrer"
                            crossOrigin="anonymous"
                            className="h-7 w-7 rounded-full object-cover ring-1 ring-pink-500"
                          />
                        ) : (
                          <div className="h-7 w-7 rounded-full bg-gradient-to-tr from-yellow-500 to-pink-500 flex items-center justify-center text-[10px] font-bold">
                            {(config.name || config.username || "IG").charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div>
                          <div className="flex items-center gap-1">
                            <p className="text-xs font-bold truncate max-w-[120px] leading-tight">
                              {config.name || config.username || "cloudmasa_innovation"}
                            </p>
                            {config.is_verified && (
                              <CheckCircle2 className="h-3 w-3 text-blue-500 fill-blue-500 text-white" />
                            )}
                          </div>
                          <p className="text-[10px] text-neutral-400 leading-tight">
                            @{config.username || "cloudmasa_innovation"}
                          </p>
                        </div>
                      </div>
                      <MoreHorizontal className="h-4 w-4 text-neutral-400" />
                    </div>

                    {/* Media Display Area */}
                    <div className="relative aspect-[9/14] bg-neutral-900 flex items-center justify-center overflow-hidden">
                      {mediaPreviewUrl ? (
                        publishType === "reel" ? (
                          <video
                            src={mediaPreviewUrl}
                            className="w-full h-full object-cover"
                            autoPlay
                            muted
                            loop
                            playsInline
                          />
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={mediaPreviewUrl}
                            alt="Mockup preview"
                            className="w-full h-full object-cover"
                          />
                        )
                      ) : (
                        <div className="flex flex-col items-center justify-center p-6 text-center text-neutral-500 space-y-2">
                          {publishType === "reel" ? <Film className="h-10 w-10 stroke-1" /> : <ImageIcon className="h-10 w-10 stroke-1" />}
                          <p className="text-xs font-medium">Your media preview will appear here</p>
                        </div>
                      )}

                      {/* Floating Reel Actions (Right-Side on Reel) */}
                      {publishType === "reel" && (
                        <div className="absolute right-2 bottom-12 flex flex-col items-center gap-3 z-10 text-white drop-shadow-md">
                          <div className="flex flex-col items-center">
                            <Heart className="h-6 w-6 text-white" />
                            <span className="text-[10px] font-medium mt-0.5">2.4k</span>
                          </div>
                          <div className="flex flex-col items-center">
                            <MessageCircle className="h-6 w-6 text-white" />
                            <span className="text-[10px] font-medium mt-0.5">128</span>
                          </div>
                          <div className="flex flex-col items-center">
                            <Share2 className="h-5 w-5 text-white" />
                            <span className="text-[10px] font-medium mt-0.5">Share</span>
                          </div>
                          <Bookmark className="h-5 w-5 text-white" />
                        </div>
                      )}

                      {/* Bottom Caption Overlay */}
                      <div className="absolute bottom-0 inset-x-0 p-3 bg-gradient-to-t from-black/90 via-black/50 to-transparent z-10">
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className="text-xs font-bold text-white">
                            @{config.username || "cloudmasa_innovation"}
                          </span>
                          {publishType === "reel" && (
                            <Badge variant="outline" className="text-[9px] h-3.5 px-1 bg-pink-500/30 border-pink-400 text-pink-200">
                              Follow
                            </Badge>
                          )}
                        </div>
                        <p className="text-[11px] text-neutral-200 line-clamp-2 leading-snug">
                          {publishCaption || "Your caption and #hashtags will display here..."}
                        </p>
                        {publishType === "reel" && (
                          <div className="flex items-center gap-1.5 mt-2 text-[10px] text-neutral-300">
                            <Music className="h-3 w-3 animate-pulse" />
                            <span className="truncate">Original audio • @{config.username || "cloudmasa_innovation"}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Standard Post Bottom Bar (if Feed Post) */}
                    {publishType === "post" && (
                      <div className="p-3 bg-neutral-950 flex items-center justify-between border-t border-neutral-800/60">
                        <div className="flex items-center gap-3">
                          <Heart className="h-5 w-5 text-white cursor-pointer hover:text-pink-500" />
                          <MessageCircle className="h-5 w-5 text-white cursor-pointer" />
                          <Share2 className="h-5 w-5 text-white cursor-pointer" />
                        </div>
                        <Bookmark className="h-5 w-5 text-white cursor-pointer" />
                      </div>
                    )}
                  </div>
                  <span className="text-[11px] text-muted-foreground mt-2 font-medium">
                    📱 Live Instagram Feed & Reel Simulator
                  </span>
                </div>
              </div>
            )}

            {/* TAB 2: Quick Direct Message Composer */}
            {activeActionTab === "dm" && (
              <div className="space-y-4 max-w-lg bg-muted/40 p-5 rounded-2xl border">
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

                <form onSubmit={handleSendQuickDm} className="space-y-3">
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
            )}
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
                  <h3 className="text-lg font-semibold">Connect Instagram Account</h3>
                  <Badge variant="secondary" className="bg-pink-500/10 text-pink-600 text-xs">
                    <Sparkles className="h-3 w-3 mr-1" /> Direct Connect
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  Connect your Instagram account using your credentials or an active browser session cookie.
                </p>

                {/* Sub-selector: Password vs Session Cookie */}
                <div className="flex items-center gap-2 mt-4 p-1 bg-muted/70 rounded-xl w-fit border border-border/50 text-xs">
                  <button
                    type="button"
                    onClick={() => setDirectAuthType("password")}
                    className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                      directAuthType === "password"
                        ? "bg-card text-foreground shadow-xs font-semibold"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Username & Password
                  </button>
                  <button
                    type="button"
                    onClick={() => setDirectAuthType("session_id")}
                    className={`px-3 py-1.5 rounded-lg font-medium transition-all flex items-center gap-1 ${
                      directAuthType === "session_id"
                        ? "bg-card text-foreground shadow-xs font-semibold"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <span>Session Cookie (Instant / 100% Reliable)</span>
                  </button>
                </div>
              </div>

              <form onSubmit={handleDirectLogin} className="space-y-5 max-w-md">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="ig-username" className="text-xs font-semibold">
                      Instagram Handle / Username <span className="text-pink-600 font-normal">(NOT email)</span>
                    </Label>
                    {validatingAccount && (
                      <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                        <RefreshCw className="h-3 w-3 animate-spin text-pink-500" /> Verifying handle...
                      </span>
                    )}
                  </div>

                  <div className="relative">
                    <div className="absolute left-3 top-2.5 text-muted-foreground font-semibold text-sm">@</div>
                    <Input
                      id="ig-username"
                      placeholder="cloudmasa_innovation"
                      value={username}
                      onChange={(e) => handleUsernameChange(e.target.value)}
                      onBlur={() => handleValidateAccount(username)}
                      className={`pl-8 ${
                        validationError
                          ? "border-rose-500 focus-visible:ring-rose-500"
                          : validatedAccount
                          ? "border-emerald-500 focus-visible:ring-emerald-500"
                          : ""
                      }`}
                      disabled={actionLoading}
                      required={directAuthType === "password"}
                    />
                  </div>

                  {/* Inline Email Warning or Error */}
                  {validationError && (
                    <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs flex items-start gap-2">
                      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                      <span>{validationError}</span>
                    </div>
                  )}

                  {/* Validated Account Live Preview Badge */}
                  {validatedAccount && (
                    <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-between gap-3 animate-in fade-in-50">
                      <div className="flex items-center gap-3">
                        {validatedAccount.profilePictureUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={validatedAccount.profilePictureUrl}
                            alt={validatedAccount.username}
                            referrerPolicy="no-referrer"
                            crossOrigin="anonymous"
                            className="h-10 w-10 rounded-full object-cover border border-emerald-500/40"
                          />
                        ) : (
                          <div className="h-10 w-10 rounded-full bg-gradient-to-tr from-yellow-500 to-pink-500 flex items-center justify-center text-white font-bold text-sm">
                            {validatedAccount.username.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div>
                          <div className="flex items-center gap-1">
                            <span className="text-xs font-bold text-foreground">{validatedAccount.name}</span>
                            {validatedAccount.isVerified && (
                              <CheckCircle2 className="h-3.5 w-3.5 text-blue-500 fill-blue-500 text-white" />
                            )}
                          </div>
                          <span className="text-[11px] font-medium text-pink-600 dark:text-pink-400">
                            @{validatedAccount.username}
                          </span>
                        </div>
                      </div>
                      <Badge variant="outline" className="bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/40 text-[10px] gap-1 font-semibold">
                        <Check className="h-3 w-3" /> Account Found
                      </Badge>
                    </div>
                  )}
                </div>

                {directAuthType === "password" ? (
                  <div className="space-y-2">
                    <Label htmlFor="ig-password" className="text-xs font-semibold">Instagram Password</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="ig-password"
                        type="password"
                        placeholder="••••••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="pl-9"
                        disabled={actionLoading}
                        required
                      />
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      If Meta flags your login due to server IP checks or 2FA, switch to the <strong>Session Cookie</strong> tab above for instant 1-click connect.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label htmlFor="ig-sessionid" className="text-xs font-semibold">Instagram Session ID Cookie (`sessionid`)</Label>
                    <div className="relative">
                      <KeyRound className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="ig-sessionid"
                        type="password"
                        placeholder="e.g. 123456789%3AABCdefGHI..."
                        value={sessionId}
                        onChange={(e) => setSessionId(e.target.value)}
                        className="pl-9 font-mono text-xs"
                        disabled={actionLoading}
                        required
                      />
                    </div>
                    <div className="p-2.5 rounded-lg bg-pink-500/10 border border-pink-500/20 text-[11px] text-muted-foreground space-y-1">
                      <p className="font-semibold text-foreground">How to get your session ID in 10 seconds:</p>
                      <ol className="list-decimal list-inside space-y-0.5">
                        <li>Open <a href="https://www.instagram.com" target="_blank" rel="noreferrer" className="text-pink-600 underline font-medium">instagram.com</a> in your browser (where you are logged in).</li>
                        <li>Press <kbd className="px-1 py-0.5 rounded bg-muted font-mono text-[10px]">F12</kbd> (DevTools) → Click <strong>Application</strong> (or Storage) → <strong>Cookies</strong> → <code>instagram.com</code>.</li>
                        <li>Copy the value of the <strong>`sessionid`</strong> cookie and paste it here.</li>
                      </ol>
                    </div>
                  </div>
                )}

                <Button
                  type="submit"
                  disabled={actionLoading || (directAuthType === "password" && (!username.trim() || !!validationError))}
                  className="w-full bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white font-bold h-10 shadow-sm"
                >
                  {actionLoading ? (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Verifying & Connecting...
                    </>
                  ) : (
                    <>
                      <KeyRound className="h-4 w-4 mr-2" /> Connect Instagram Account
                    </>
                  )}
                </Button>
              </form>
            </div>
          </TabsContent>

          {/* TAB 2: Meta Cloud API */}
          <TabsContent value="cloud_api" className="space-y-4">
            <div className="p-6 rounded-2xl bg-card border shadow-sm space-y-6">
              <div>
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <Shield className="h-5 w-5 text-pink-500" /> Meta Graph API Configuration
                </h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Connect your Instagram Professional or Business account using the official Meta Cloud API with high throughput and webhooks.
                </p>
              </div>

              <form onSubmit={handleCloudApiSave} className="space-y-4 max-w-lg">
                <div className="p-3 rounded-xl bg-pink-500/10 border border-pink-500/20 text-xs flex items-center justify-between gap-3">
                  <div>
                    <span className="font-semibold text-foreground">Need a Meta Access Token?</span>
                    <p className="text-[11px] text-muted-foreground mt-0.5">Generate a token in 1 click via Meta Graph API Explorer with Instagram permissions.</p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs gap-1 shrink-0 border-pink-500/30 text-pink-600 dark:text-pink-400 hover:bg-pink-500/10"
                    onClick={() => window.open("https://developers.facebook.com/tools/explorer/", "_blank")}
                  >
                    <ExternalLink className="size-3.5" />
                    Open Explorer
                  </Button>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="ig-access-token" className="text-xs font-semibold">
                    Page / User Access Token <span className="text-pink-600 font-normal">(starts with EAAB...)</span>
                  </Label>
                  <Input
                    id="ig-access-token"
                    type="password"
                    placeholder="EAAB..."
                    value={accessToken}
                    onChange={(e) => setAccessToken(e.target.value)}
                    disabled={actionLoading}
                    required
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Instagram Business ID and Page ID will be automatically detected from your token.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="ig-business-id">Instagram Business Account ID</Label>
                    <Input
                      id="ig-business-id"
                      placeholder="178414..."
                      value={igBusinessId}
                      onChange={(e) => setIgBusinessId(e.target.value)}
                      disabled={actionLoading}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="page-id">Facebook Page ID</Label>
                    <Input
                      id="page-id"
                      placeholder="100923..."
                      value={pageId}
                      onChange={(e) => setPageId(e.target.value)}
                      disabled={actionLoading}
                    />
                  </div>
                </div>

                <Button
                  type="submit"
                  disabled={actionLoading}
                  className="w-full bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white font-medium"
                >
                  {actionLoading ? (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Verifying with Meta...
                    </>
                  ) : (
                    <>
                      <Shield className="h-4 w-4 mr-2" /> Save & Connect Meta Cloud API
                    </>
                  )}
                </Button>
              </form>

              {/* Webhook Settings Box */}
              <div className="p-4 rounded-xl bg-muted/40 border space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Meta Webhook Configuration
                </h4>
                <div className="space-y-2 text-xs">
                  <div>
                    <span className="text-muted-foreground">Callback URL:</span>
                    <div className="flex items-center gap-2 mt-1">
                      <code className="px-2 py-1 rounded bg-background border font-mono text-[11px] select-all flex-1 truncate">
                        {webhookUrl || "https://your-crm.com/api/instagram/webhook"}
                      </code>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        onClick={() => copyToClipboard(webhookUrl, "webhook")}
                      >
                        {copiedWebhook ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                      </Button>
                    </div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Verify Token:</span>
                    <div className="flex items-center gap-2 mt-1">
                      <code className="px-2 py-1 rounded bg-background border font-mono text-[11px] select-all flex-1">
                        {defaultVerifyToken || "masacrm_ig_verify_token"}
                      </code>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        onClick={() => copyToClipboard(defaultVerifyToken, "token")}
                      >
                        {copiedToken ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
