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
  Users,
  UserCheck,
  Grid,
  BarChart3,
  Clock,
  Inbox,
  Plus,
  Eye,
  EyeOff,
} from "lucide-react";
import { Instagram } from "@/components/icons/instagram";
import { InstagramMediaFeed } from "@/components/instagram/instagram-media-feed";
import { InstagramCommentsPanel } from "@/components/instagram/instagram-comments-panel";
import { InstagramInsightsPanel } from "@/components/instagram/instagram-insights-panel";
import { toast } from "sonner";

interface InstagramConfigProps {
  canDisconnect?: boolean;
}

interface InstagramStatus {
  id?: string;
  connection_method: "direct" | "cloud_api";
  token_type?: "facebook_page" | "instagram_login" | null;
  username: string | null;
  name: string | null;
  profile_picture_url: string | null;
  status: "connected" | "disconnected" | "2fa_pending" | "error";
  last_error?: string | null;
  instagram_business_id?: string | null;
  page_id?: string | null;
  connected_at?: string | null;
  followers_count?: number | null;
  following_count?: number | null;
  posts_count?: number | null;
  biography?: string | null;
  website?: string | null;
  is_verified?: boolean;
  granted_scopes?: string[];
  has_app_secret?: boolean;
  comment_auto_reply_enabled?: boolean;
  comment_auto_reply_keyword?: string;
  comment_auto_reply_message?: string;
  comment_auto_dm_message?: string;
}

interface CarouselDraftItem {
  file: File;
  previewUrl: string;
  mediaType: "IMAGE" | "VIDEO";
}

const SQL_MIGRATION_TEXT = `-- Run supabase/migrations/052_instagram_integration.sql and 062_instagram_full_suite.sql in your Supabase SQL Editor.`;

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
  const [syncingInbox, setSyncingInbox] = useState(false);
  const [tableMissing, setTableMissing] = useState(false);
  const [config, setConfig] = useState<InstagramStatus | null>(null);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [defaultVerifyToken, setDefaultVerifyToken] = useState("");

  // Direct login & 2FA state
  const [directAuthType, setDirectAuthType] = useState<"password" | "session_id">("password");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [twoFactorPending, setTwoFactorPending] = useState<{
    username: string;
    method: "sms" | "totp" | "email";
    obfuscatedPhone?: string | null;
  } | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [validatedAccount, setValidatedAccount] = useState<{
    username: string;
    name: string;
    profilePictureUrl?: string;
    isVerified?: boolean;
  } | null>(null);
  const [validatingAccount, setValidatingAccount] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Connected Hub Navigation
  const [activeActionTab, setActiveActionTab] = useState<
    "publish" | "feed" | "comments" | "insights" | "dm"
  >("publish");
  const [commentsTargetMediaId, setCommentsTargetMediaId] = useState<string | null>(null);

  // Quick DM Composer state
  const [quickDmRecipient, setQuickDmRecipient] = useState("");
  const [quickDmText, setQuickDmText] = useState("");
  const [quickDmSending, setQuickDmSending] = useState(false);

  // Studio Publishing state (Post, Reel, Carousel, Story)
  const [publishType, setPublishType] = useState<"reel" | "post" | "carousel" | "story">("reel");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [mediaPreviewUrl, setMediaPreviewUrl] = useState<string>("");
  const [carouselItems, setCarouselItems] = useState<CarouselDraftItem[]>([]);
  const [carouselPreviewIndex, setCarouselPreviewIndex] = useState(0);
  const [publishCaption, setPublishCaption] = useState("");
  const [publishShareToFeed, setPublishShareToFeed] = useState(true);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const carouselInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const validateDebounceTimer = useRef<NodeJS.Timeout | null>(null);

  // Meta Cloud API form state
  const [accessToken, setAccessToken] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [showAccessToken, setShowAccessToken] = useState(false);
  const [showAppSecret, setShowAppSecret] = useState(false);
  const [igBusinessId, setIgBusinessId] = useState("");
  const [pageId, setPageId] = useState("");
  const [verifyToken, setVerifyToken] = useState("");
  const [tokenTypeChoice, setTokenTypeChoice] = useState<
    "auto" | "facebook_page" | "instagram_login"
  >("auto");

  // Copy helpers
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);

  const applyConfigPayload = (data: {
    config?: InstagramStatus;
    table_missing?: boolean;
    webhook_url?: string;
    default_verify_token?: string;
  }) => {
    if (data.config) {
      setConfig(data.config);
      if (data.config.status === "2fa_pending" && data.config.username) {
        setTwoFactorPending({
          username: data.config.username,
          method: "totp",
        });
      } else {
        setTwoFactorPending(null);
      }
    }
    setTableMissing(Boolean(data.table_missing));
    if (data.webhook_url) setWebhookUrl(data.webhook_url);
    if (data.default_verify_token) setDefaultVerifyToken(data.default_verify_token);
  };

  const fetchConfig = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/instagram/config", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      applyConfigPayload(data);
    } catch {
      // Ignore background fetch error
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    fetch("/api/instagram/config", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data) {
          applyConfigPayload(data);
        } else {
          setWebhookUrl((prev) => prev || `${window.location.origin}/api/instagram/webhook`);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setWebhookUrl((prev) => prev || `${window.location.origin}/api/instagram/webhook`);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSyncProfile = async () => {
    try {
      setSyncingProfile(true);
      const res = await fetch("/api/instagram/sync-profile", { method: "POST" });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to sync profile");
      }
      toast.success(`Refreshed live profile stats for @${data.username}!`);
      await fetchConfig();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to sync profile.");
    } finally {
      setSyncingProfile(false);
    }
  };

  const handleSyncInbox = async () => {
    try {
      setSyncingInbox(true);
      const res = await fetch("/api/instagram/sync-inbox", { method: "POST" });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to sync Instagram DMs");
      }
      toast.success(
        `Synced ${data.threadsSynced ?? 0} DM threads (${data.messagesIngested ?? 0} new messages) to Inbox!`,
      );
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to sync Instagram DMs.");
    } finally {
      setSyncingInbox(false);
    }
  };

  const handleValidateAccount = async (inputHandle: string) => {
    const raw = inputHandle.trim();
    if (!raw) {
      setValidatedAccount(null);
      setValidationError(null);
      return;
    }

    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
      setValidationError(
        "It looks like you entered an email address. Please enter your Instagram @username instead.",
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
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setValidationError(data.error || "Could not verify Instagram handle.");
        setValidatedAccount(null);
        return;
      }
      if (data.valid) {
        setValidatedAccount(data);
        setValidationError(null);
      } else {
        setValidatedAccount(null);
      }
    } catch {
      // Non-fatal background check
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
        void handleValidateAccount(val);
      }, 700);
    }
  };

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
        toast.error("Please enter your Instagram @handle instead of your email address.");
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
        if (data.table_missing) setTableMissing(true);
        throw new Error(data.error || "Login failed");
      }

      if (data.status === "2fa_required") {
        setTwoFactorPending({
          username: data.username || username.trim(),
          method: data.twoFactorType || "totp",
          obfuscatedPhone: data.obfuscatedPhone,
        });
        toast.info("Instagram requires a 2-Factor verification code. Enter the code below.");
        return;
      }

      toast.success(`Successfully connected Instagram account @${data.username}!`);
      setPassword("");
      setSessionId("");
      await fetchConfig();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to connect to Instagram.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleTwoFactorSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!twoFactorCode.trim() || !twoFactorPending) return;

    try {
      setActionLoading(true);
      const res = await fetch("/api/instagram/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "two_factor",
          verification_code: twoFactorCode.trim(),
          verification_method: twoFactorPending.method,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Two-factor verification failed");
      }

      toast.success(`Connected Instagram account @${data.username}!`);
      setTwoFactorPending(null);
      setTwoFactorCode("");
      setPassword("");
      await fetchConfig();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Invalid 2FA code.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleCloudApiSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken.trim()) {
      toast.error("Please enter your Meta / Instagram Access Token.");
      return;
    }

    try {
      setActionLoading(true);
      const res = await fetch("/api/instagram/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connection_method: "cloud_api",
          token_type: tokenTypeChoice === "auto" ? undefined : tokenTypeChoice,
          access_token: accessToken.trim(),
          app_secret: appSecret.trim() || undefined,
          instagram_business_id: igBusinessId.trim() || undefined,
          page_id: pageId.trim() || undefined,
          verify_token: verifyToken.trim() || defaultVerifyToken,
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        if (data.table_missing) setTableMissing(true);
        throw new Error(data.error || "Failed to save Meta Cloud API configuration");
      }

      toast.success(
        `Connected @${data.profile?.username || "Instagram"} via ${
          data.profile?.tokenType === "instagram_login"
            ? "Instagram Login API"
            : "Meta Facebook Page API"
        }!`,
      );
      setAccessToken("");
      setAppSecret("");
      await fetchConfig();
    } catch (err: unknown) {
      const rawMsg = err instanceof Error ? err.message : "";
      const friendly =
        rawMsg === "Failed to fetch" || err instanceof TypeError
          ? "Could not reach MaSa CRM server. Refresh the page and verify the app container is running."
          : rawMsg || "Failed to configure Meta Cloud API.";
      toast.error(friendly);
    } finally {
      setActionLoading(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm("Are you sure you want to disconnect this Instagram account?")) return;

    try {
      setActionLoading(true);
      const res = await fetch("/api/instagram/config", { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to disconnect Instagram");
      toast.success("Instagram account disconnected.");
      setTwoFactorPending(null);
      await fetchConfig();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to disconnect.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleSendQuickDm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickDmRecipient.trim() || !quickDmText.trim()) return;

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

      toast.success(`Direct message sent to @${data.recipient}!`);
      setQuickDmRecipient("");
      setQuickDmText("");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to send direct message.");
    } finally {
      setQuickDmSending(false);
    }
  };

  const handleFileSelect = (file: File) => {
    if (!file) return;
    const isVideo = file.type.startsWith("video/");
    const isImage = file.type.startsWith("image/");

    if (!isVideo && !isImage) {
      toast.error("Please select a valid video (MP4/MOV) or image (JPG/PNG/WEBP) file.");
      return;
    }

    if (publishType === "post" && isVideo) setPublishType("reel");
    if (publishType === "reel" && isImage) setPublishType("post");

    if (mediaPreviewUrl && mediaPreviewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(mediaPreviewUrl);
    }

    setSelectedFile(file);
    setMediaPreviewUrl(URL.createObjectURL(file));
  };

  const handleCarouselFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const additions: CarouselDraftItem[] = [];
    for (const file of Array.from(files)) {
      const isVideo = file.type.startsWith("video/");
      const isImage = file.type.startsWith("image/");
      if (!isVideo && !isImage) continue;
      additions.push({
        file,
        previewUrl: URL.createObjectURL(file),
        mediaType: isVideo ? "VIDEO" : "IMAGE",
      });
    }
    setCarouselItems((prev) => [...prev, ...additions].slice(0, 10));
  };

  const removeCarouselItem = (idx: number) => {
    setCarouselItems((prev) => {
      const target = prev[idx];
      if (target?.previewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(target.previewUrl);
      }
      const next = prev.filter((_, i) => i !== idx);
      if (carouselPreviewIndex >= next.length) {
        setCarouselPreviewIndex(Math.max(0, next.length - 1));
      }
      return next;
    });
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (publishType === "carousel") {
      handleCarouselFiles(e.dataTransfer.files);
    } else if (e.dataTransfer.files && e.dataTransfer.files[0]) {
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

  const uploadSingleFile = async (file: File): Promise<string> => {
    const formData = new FormData();
    formData.append("file", file);
    const uploadRes = await fetch("/api/instagram/upload", {
      method: "POST",
      body: formData,
    });
    const uploadData = await uploadRes.json();
    if (!uploadRes.ok || uploadData.error) {
      throw new Error(uploadData.error || "Failed to upload media file.");
    }
    return uploadData.url as string;
  };

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      setPublishing(true);

      if (publishType === "carousel") {
        if (carouselItems.length < 2) {
          toast.error("Carousels require at least 2 photos/videos.");
          return;
        }
        setUploadingMedia(true);
        const uploadedItems: Array<{ url: string; mediaType: "IMAGE" | "VIDEO" }> = [];
        for (const item of carouselItems) {
          const url = await uploadSingleFile(item.file);
          uploadedItems.push({ url, mediaType: item.mediaType });
        }
        setUploadingMedia(false);

        const res = await fetch("/api/instagram/publish", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "carousel",
            carouselItems: uploadedItems,
            caption: publishCaption.trim(),
          }),
        });
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error || "Failed to publish carousel.");
        if (data.direct) {
          toast.info(data.message);
          handleOpenWebCreator();
        } else {
          toast.success(data.message || "Carousel published successfully!");
          carouselItems.forEach((i) => URL.revokeObjectURL(i.previewUrl));
          setCarouselItems([]);
          setPublishCaption("");
        }
        return;
      }

      if (!selectedFile && !mediaPreviewUrl) {
        toast.error("Please select a photo or video first.");
        return;
      }

      let targetPublicUrl = mediaPreviewUrl;
      const isVideo = selectedFile ? selectedFile.type.startsWith("video/") : publishType === "reel";

      if (selectedFile) {
        setUploadingMedia(true);
        targetPublicUrl = await uploadSingleFile(selectedFile);
        setUploadingMedia(false);
      }

      const res = await fetch("/api/instagram/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: publishType,
          mediaUrl: targetPublicUrl,
          isVideo,
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
        toast.success(data.message || "Published successfully to Instagram!");
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
      "width=850,height=850,menubar=no,toolbar=no,location=no,status=no,resizable=yes",
    );
    if (!popup) {
      window.open("https://www.instagram.com/create/select/", "_blank");
    }
  };

  const addHashtag = (tag: string) => {
    if (publishCaption.includes(tag)) return;
    setPublishCaption((prev) => (prev ? `${prev} ${tag}` : tag));
  };

  const toggleVideoPlayback = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      void videoRef.current.play();
      setIsPlaying(true);
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  };

  const copyToClipboard = (text: string, type: "webhook" | "token" | "sql") => {
    void navigator.clipboard.writeText(text);
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
  const isCloudApi = config?.connection_method === "cloud_api";
  const activePreviewUrl =
    publishType === "carousel"
      ? carouselItems[carouselPreviewIndex]?.previewUrl || ""
      : mediaPreviewUrl;
  const activePreviewIsVideo =
    publishType === "carousel"
      ? carouselItems[carouselPreviewIndex]?.mediaType === "VIDEO"
      : publishType === "reel" || Boolean(selectedFile?.type.startsWith("video/"));

  return (
    <div className="space-y-6">
      {tableMissing && (
        <div className="p-6 rounded-2xl bg-amber-500/10 border border-amber-500/30 space-y-4">
          <div className="flex items-start gap-3">
            <Database className="h-6 w-6 text-amber-500 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h3 className="text-base font-semibold text-amber-600 dark:text-amber-400">
                Database Migration Required
              </h3>
              <p className="text-sm text-muted-foreground">
                Run migrations <code>052_instagram_integration.sql</code> and{" "}
                <code>062_instagram_full_suite.sql</code> in your Supabase SQL Editor.
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => copyToClipboard(SQL_MIGRATION_TEXT, "sql")}
            className="gap-1.5"
          >
            {copiedSql ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
            Copy Migration Note
          </Button>
        </div>
      )}

      {/* Connected Hub View */}
      {isConnected && (
        <div className="p-6 rounded-2xl bg-card border shadow-xs space-y-6">
          {/* Profile Summary Header */}
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
                  <Badge
                    variant="outline"
                    className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-xs gap-1 font-semibold"
                  >
                    <CheckCircle2 className="h-3 w-3" /> Connected
                  </Badge>
                  <Badge variant="secondary" className="text-[11px]">
                    {isCloudApi
                      ? config.token_type === "instagram_login"
                        ? "Meta Key (Instagram Login)"
                        : "Meta Key (Cloud API)"
                      : "Direct Login (ID & Pass)"}
                  </Badge>
                </div>
                <p className="text-sm font-semibold text-pink-600 dark:text-pink-400">
                  @{config.username || "instagram_user"}
                </p>

                <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-muted/60 border font-medium">
                    <Users className="h-3.5 w-3.5 text-pink-500" />
                    <strong>
                      {config.followers_count != null ? config.followers_count.toLocaleString() : "—"}
                    </strong>{" "}
                    Followers
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-muted/60 border font-medium">
                    <UserCheck className="h-3.5 w-3.5 text-purple-500" />
                    <strong>
                      {config.following_count != null ? config.following_count.toLocaleString() : "—"}
                    </strong>{" "}
                    Following
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-muted/60 border font-medium">
                    <Grid className="h-3.5 w-3.5 text-indigo-500" />
                    <strong>
                      {config.posts_count != null ? config.posts_count.toLocaleString() : "—"}
                    </strong>{" "}
                    Posts
                  </span>
                </div>

                {config.biography && (
                  <p className="text-xs text-muted-foreground italic line-clamp-2 max-w-xl pt-1">
                    &ldquo;{config.biography}&rdquo;
                  </p>
                )}
                {config.website && (
                  <a
                    href={config.website}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-pink-500 hover:underline inline-flex items-center gap-1"
                  >
                    {config.website} <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 self-start lg:self-center">
              <Button
                variant="outline"
                size="sm"
                onClick={handleSyncProfile}
                disabled={syncingProfile || loading}
                className="font-medium text-xs gap-1.5"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${syncingProfile || loading ? "animate-spin" : ""}`} />
                {syncingProfile ? "Syncing..." : "Sync Profile"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleSyncInbox}
                disabled={syncingInbox}
                className="font-medium text-xs gap-1.5 border-purple-500/30 text-purple-600 dark:text-purple-400 hover:bg-purple-500/10"
              >
                <Inbox className={`h-3.5 w-3.5 ${syncingInbox ? "animate-spin" : ""}`} />
                {syncingInbox ? "Syncing DMs..." : "Sync DMs"}
              </Button>
              <Button
                size="sm"
                className="bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white font-medium shadow-sm"
                onClick={() => (window.location.href = "/inbox")}
              >
                <Instagram className="h-4 w-4 mr-2" /> Open Inbox
              </Button>
              {canDisconnect && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleDisconnect}
                  disabled={actionLoading}
                >
                  <Unlink className="h-4 w-4 mr-2" /> Disconnect
                </Button>
              )}
            </div>
          </div>

          {/* Complete App Action Switcher */}
          <div className="pt-4 border-t border-border">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
              <div className="inline-flex flex-wrap rounded-xl bg-muted/60 p-1 border gap-1">
                {(
                  [
                    { id: "publish", label: "Studio (Post / Reel / Carousel / Story)", icon: Film },
                    { id: "feed", label: "Feed & Stories", icon: Grid },
                    { id: "comments", label: "Comments & Auto-DM", icon: MessageCircle },
                    { id: "insights", label: "Insights", icon: BarChart3 },
                    { id: "dm", label: "Direct Messages", icon: Send },
                  ] as const
                ).map((tab) => {
                  const Icon = tab.icon;
                  const active = activeActionTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveActionTab(tab.id)}
                      className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg transition-all ${
                        active
                          ? "bg-card text-foreground shadow-xs font-bold"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5 text-pink-500" />
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              <Button
                size="sm"
                variant="outline"
                className="text-xs gap-1.5"
                onClick={handleOpenWebCreator}
              >
                <UploadCloud className="h-3.5 w-3.5" />
                Web Creator
              </Button>
            </div>

            {/* TAB 1: Publishing Studio */}
            {activeActionTab === "publish" && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                <div className="lg:col-span-7 space-y-5 bg-card/60 rounded-2xl border p-5 shadow-xs">
                  <div>
                    <h4 className="text-base font-bold flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-pink-500" /> Instagram Publishing Studio
                    </h4>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Publish Reels, Photo Feed Posts, Multi-Slide Carousels, or 24-hour Stories directly via Meta Key.
                    </p>
                  </div>

                  <form onSubmit={handlePublish} className="space-y-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        1. Select Format
                      </Label>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {(
                          [
                            { id: "reel", label: "Reel", sub: "9:16 Video", icon: Film },
                            { id: "post", label: "Photo Post", sub: "Feed Image", icon: ImageIcon },
                            { id: "carousel", label: "Carousel", sub: "2–10 Slides", icon: Layers },
                            { id: "story", label: "Story", sub: "24h Photo/Video", icon: Clock },
                          ] as const
                        ).map((fmt) => {
                          const Icon = fmt.icon;
                          const selected = publishType === fmt.id;
                          return (
                            <button
                              key={fmt.id}
                              type="button"
                              onClick={() => setPublishType(fmt.id)}
                              className={`flex flex-col items-center justify-center gap-1 p-3 rounded-xl border text-xs font-bold transition-all ${
                                selected
                                  ? "bg-gradient-to-r from-pink-500/15 to-purple-500/15 border-pink-500 text-pink-600 dark:text-pink-400 ring-2 ring-pink-500/20"
                                  : "bg-muted/30 border-border text-muted-foreground hover:border-muted-foreground/40"
                              }`}
                            >
                              <Icon className="h-4 w-4 text-pink-500" />
                              <span>{fmt.label}</span>
                              <span className="text-[10px] font-normal opacity-80">{fmt.sub}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Media Dropzone */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          2. Upload Media
                        </Label>
                        {publishType !== "carousel" && mediaPreviewUrl && (
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
                        accept={
                          publishType === "reel"
                            ? "video/mp4,video/quicktime,video/webm"
                            : publishType === "story"
                            ? "image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
                            : "image/jpeg,image/png,image/webp"
                        }
                        className="hidden"
                        onChange={(e) => {
                          if (e.target.files?.[0]) handleFileSelect(e.target.files[0]);
                        }}
                      />

                      <input
                        ref={carouselInputRef}
                        type="file"
                        multiple
                        accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
                        className="hidden"
                        onChange={(e) => handleCarouselFiles(e.target.files)}
                      />

                      {publishType === "carousel" ? (
                        <div className="space-y-3">
                          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                            {carouselItems.map((item, idx) => (
                              <div
                                key={idx}
                                onClick={() => setCarouselPreviewIndex(idx)}
                                className={`relative aspect-square rounded-xl overflow-hidden border-2 cursor-pointer ${
                                  carouselPreviewIndex === idx ? "border-pink-500" : "border-border"
                                }`}
                              >
                                {item.mediaType === "VIDEO" ? (
                                  <video src={item.previewUrl} className="h-full w-full object-cover" />
                                ) : (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={item.previewUrl}
                                    alt={`Slide ${idx + 1}`}
                                    className="h-full w-full object-cover"
                                  />
                                )}
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    removeCarouselItem(idx);
                                  }}
                                  className="absolute top-1 right-1 h-5 w-5 rounded-full bg-black/70 text-white flex items-center justify-center"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </div>
                            ))}
                            {carouselItems.length < 10 && (
                              <button
                                type="button"
                                onClick={() => carouselInputRef.current?.click()}
                                className="aspect-square rounded-xl border-2 border-dashed border-border hover:border-pink-500 flex flex-col items-center justify-center text-muted-foreground hover:text-pink-500 gap-1 text-xs"
                              >
                                <Plus className="h-5 w-5" />
                                Add Slide
                              </button>
                            )}
                          </div>
                        </div>
                      ) : !mediaPreviewUrl ? (
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
                            Click or drag &amp; drop media here
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            Up to 50 MB (MP4, MOV, JPG, PNG, WEBP)
                          </p>
                        </div>
                      ) : (
                        <div className="relative rounded-2xl overflow-hidden border bg-black/90 flex items-center justify-center max-h-[260px]">
                          {activePreviewIsVideo ? (
                            <div className="relative w-full h-[240px] flex items-center justify-center">
                              <video
                                ref={videoRef}
                                src={mediaPreviewUrl}
                                className="h-full max-w-full object-contain"
                                onPlay={() => setIsPlaying(true)}
                                onPause={() => setIsPlaying(false)}
                                loop
                              />
                              <button
                                type="button"
                                onClick={toggleVideoPlayback}
                                className="absolute inset-0 m-auto h-12 w-12 rounded-full bg-black/60 text-white flex items-center justify-center"
                              >
                                {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 ml-0.5" />}
                              </button>
                            </div>
                          ) : (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={mediaPreviewUrl}
                              alt="Upload preview"
                              className="h-[240px] w-full object-contain"
                            />
                          )}
                        </div>
                      )}
                    </div>

                    {/* Caption (hidden for Story) */}
                    {publishType !== "story" && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label htmlFor="post-caption" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                            3. Caption &amp; Hashtags
                          </Label>
                          <span className="text-[11px] text-muted-foreground">
                            {publishCaption.length} / 2,200
                          </span>
                        </div>
                        <Textarea
                          id="post-caption"
                          rows={3}
                          placeholder="Write your caption with emojis and hashtags..."
                          value={publishCaption}
                          onChange={(e) => setPublishCaption(e.target.value)}
                          className="text-xs resize-none"
                        />
                        <div className="flex flex-wrap gap-1.5">
                          {HASHTAG_SUGGESTIONS.map((tag) => (
                            <button
                              key={tag}
                              type="button"
                              onClick={() => addHashtag(tag)}
                              className={`text-[11px] px-2 py-0.5 rounded-full border ${
                                publishCaption.includes(tag)
                                  ? "bg-pink-500/20 border-pink-500/40 text-pink-600 font-bold"
                                  : "bg-muted/50 border-border text-muted-foreground"
                              }`}
                            >
                              {tag}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {publishType === "reel" && (
                      <label className="flex items-center gap-2.5 text-xs font-medium cursor-pointer p-3 rounded-xl bg-muted/40 border">
                        <input
                          type="checkbox"
                          checked={publishShareToFeed}
                          onChange={(e) => setPublishShareToFeed(e.target.checked)}
                          className="rounded text-pink-600 h-4 w-4"
                        />
                        <span>Share Reel to Profile Feed Grid</span>
                      </label>
                    )}

                    <Button
                      type="submit"
                      disabled={
                        publishing ||
                        uploadingMedia ||
                        (publishType === "carousel"
                          ? carouselItems.length < 2
                          : !selectedFile && !mediaPreviewUrl)
                      }
                      className="w-full bg-gradient-to-r from-pink-600 via-rose-600 to-purple-600 text-white font-bold h-11"
                    >
                      {uploadingMedia
                        ? "Uploading Media..."
                        : publishing
                        ? "Publishing to Instagram..."
                        : `Publish ${
                            publishType === "reel"
                              ? "Reel"
                              : publishType === "carousel"
                              ? "Carousel"
                              : publishType === "story"
                              ? "Story"
                              : "Post"
                          } Now`}
                    </Button>
                  </form>
                </div>

                {/* Live Mobile Preview */}
                <div className="lg:col-span-5 flex flex-col items-center">
                  <div className="w-full max-w-[300px] rounded-[32px] bg-black border-[6px] border-neutral-800 shadow-2xl overflow-hidden text-white">
                    <div className="pt-4 px-4 pb-2 flex items-center justify-between border-b border-neutral-800">
                      <div className="flex items-center gap-2">
                        <div className="h-7 w-7 rounded-full bg-gradient-to-tr from-yellow-500 to-pink-500 flex items-center justify-center text-[10px] font-bold">
                          {(config.username || "IG").charAt(0).toUpperCase()}
                        </div>
                        <p className="text-xs font-bold truncate">@{config.username || "instagram"}</p>
                      </div>
                      <MoreHorizontal className="h-4 w-4 text-neutral-400" />
                    </div>

                    <div className="relative aspect-[9/14] bg-neutral-900 flex items-center justify-center overflow-hidden">
                      {activePreviewUrl ? (
                        activePreviewIsVideo ? (
                          <video src={activePreviewUrl} className="w-full h-full object-cover" muted autoPlay loop />
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={activePreviewUrl} alt="Preview" className="w-full h-full object-cover" />
                        )
                      ) : (
                        <div className="text-center text-neutral-500 space-y-2 p-6">
                          <Film className="h-10 w-10 mx-auto stroke-1" />
                          <p className="text-xs">Live mobile preview</p>
                        </div>
                      )}

                      {publishType === "reel" && (
                        <div className="absolute right-2 bottom-12 flex flex-col items-center gap-3 text-white">
                          <Heart className="h-5 w-5" />
                          <MessageCircle className="h-5 w-5" />
                          <Share2 className="h-5 w-5" />
                          <Bookmark className="h-5 w-5" />
                        </div>
                      )}

                      {publishType !== "story" && (
                        <div className="absolute bottom-0 inset-x-0 p-3 bg-gradient-to-t from-black/90 to-transparent">
                          <p className="text-xs font-bold">@{config.username || "instagram"}</p>
                          <p className="text-[11px] text-neutral-200 line-clamp-2">
                            {publishCaption || "Caption preview..."}
                          </p>
                          {publishType === "reel" && (
                            <div className="flex items-center gap-1 mt-1 text-[10px] text-neutral-300">
                              <Music className="h-3 w-3" /> Original audio
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: Profile Feed, Stories & Mentions */}
            {activeActionTab === "feed" && (
              <InstagramMediaFeed
                isCloudApi={isCloudApi}
                onSelectMediaForComments={(mediaId) => {
                  setCommentsTargetMediaId(mediaId);
                  setActiveActionTab("comments");
                }}
              />
            )}

            {/* TAB 3: Comment Moderation & Automated Comment-to-DM */}
            {activeActionTab === "comments" && (
              <InstagramCommentsPanel
                key={`${config.id ?? "ig"}-${config.comment_auto_reply_enabled}-${config.comment_auto_reply_keyword ?? ""}`}
                isCloudApi={isCloudApi}
                initialMediaId={commentsTargetMediaId}
                autoReplyEnabled={Boolean(config.comment_auto_reply_enabled)}
                autoReplyKeyword={config.comment_auto_reply_keyword || ""}
                autoReplyMessage={config.comment_auto_reply_message || ""}
                autoDmMessage={config.comment_auto_dm_message || ""}
                onConfigUpdated={() => void fetchConfig()}
              />
            )}

            {/* TAB 4: Account & Token Insights */}
            {activeActionTab === "insights" && (
              <InstagramInsightsPanel
                isCloudApi={isCloudApi}
                followersCount={config.followers_count}
                followingCount={config.following_count}
                postsCount={config.posts_count}
                grantedScopes={config.granted_scopes}
                tokenType={config.token_type}
              />
            )}

            {/* TAB 5: Quick DM & Inbox Sync */}
            {activeActionTab === "dm" && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="space-y-4 bg-muted/40 p-5 rounded-2xl border">
                  <h4 className="text-sm font-semibold flex items-center gap-2">
                    <Send className="h-4 w-4 text-pink-500" /> Send Direct Message
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    {isCloudApi
                      ? "In Meta Cloud API mode, Meta requires the recipient to have messaged you within 24h (or replied via Comment-to-DM) so their IGSID is known."
                      : "Enter any Instagram @username to start or continue a Direct Message thread."}
                  </p>
                  <form onSubmit={handleSendQuickDm} className="space-y-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="quick-dm-user" className="text-xs">
                        Recipient Instagram Username
                      </Label>
                      <div className="relative">
                        <div className="absolute left-3 top-2.5 text-muted-foreground text-xs">@</div>
                        <Input
                          id="quick-dm-user"
                          placeholder="username"
                          value={quickDmRecipient}
                          onChange={(e) => setQuickDmRecipient(e.target.value)}
                          className="pl-7 text-xs"
                          required
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="quick-dm-text" className="text-xs">
                        Message
                      </Label>
                      <Textarea
                        id="quick-dm-text"
                        rows={3}
                        placeholder="Type your Direct Message..."
                        value={quickDmText}
                        onChange={(e) => setQuickDmText(e.target.value)}
                        className="text-xs resize-none"
                        required
                      />
                    </div>
                    <Button
                      type="submit"
                      size="sm"
                      disabled={quickDmSending}
                      className="w-full bg-gradient-to-r from-pink-600 to-purple-600 text-white"
                    >
                      {quickDmSending ? "Sending..." : "Send Direct Message"}
                    </Button>
                  </form>
                </div>

                <div className="space-y-4 bg-muted/40 p-5 rounded-2xl border flex flex-col justify-between">
                  <div className="space-y-2">
                    <h4 className="text-sm font-semibold flex items-center gap-2">
                      <Inbox className="h-4 w-4 text-purple-500" /> Sync Existing Instagram DMs to CRM Inbox
                    </h4>
                    <p className="text-xs text-muted-foreground">
                      Pull your recent Instagram Direct threads and messages into the Unified Inbox automatically (safe &amp; deduplicated — never creates duplicates).
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 pt-3">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleSyncInbox}
                      disabled={syncingInbox}
                      className="text-xs gap-1.5"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${syncingInbox ? "animate-spin" : ""}`} />
                      {syncingInbox ? "Syncing Threads..." : "Pull Recent DMs Now"}
                    </Button>
                    <Button
                      type="button"
                      onClick={() => (window.location.href = "/inbox")}
                      className="text-xs bg-gradient-to-r from-pink-600 to-purple-600 text-white"
                    >
                      Go to Unified Inbox
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Connection Setup Tabs (if disconnected or 2FA pending) */}
      {!isConnected && (
        <Tabs defaultValue="cloud_api" className="space-y-6">
          <TabsList className="grid w-full max-w-md grid-cols-2 p-1 bg-muted/60 rounded-xl">
            <TabsTrigger value="cloud_api" className="rounded-lg font-medium flex items-center gap-2">
              <Shield className="h-4 w-4" /> Meta Cloud Key
            </TabsTrigger>
            <TabsTrigger value="direct" className="rounded-lg font-medium flex items-center gap-2">
              <KeyRound className="h-4 w-4" /> ID &amp; Password
            </TabsTrigger>
          </TabsList>

          {/* TAB 1: Meta Cloud API (Full App Actions) */}
          <TabsContent value="cloud_api" className="space-y-4">
            <div className="p-6 rounded-2xl bg-card border shadow-sm space-y-6">
              <div>
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <Shield className="h-5 w-5 text-pink-500" /> Connect via Meta Key (Full Instagram App Access)
                </h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Auto-detects both Facebook-linked Meta tokens (<code>EAAB...</code>) and Instagram API with Instagram Login tokens (<code>IGA...</code>). Enables Posts, Reels, Carousels, Stories, Comments, Auto-DM, Insights &amp; 2-Way Inbox Webhooks.
                </p>
              </div>

              <form onSubmit={handleCloudApiSave} className="space-y-4 max-w-lg">
                <div className="space-y-2">
                  <Label htmlFor="ig-token-type" className="text-xs font-semibold">
                    Meta Key Mode
                  </Label>
                  <select
                    id="ig-token-type"
                    value={tokenTypeChoice}
                    onChange={(e) =>
                      setTokenTypeChoice(
                        e.target.value as "auto" | "facebook_page" | "instagram_login",
                      )
                    }
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs text-foreground"
                  >
                    <option value="auto">Auto-Detect Token (Recommended — supports EAAB &amp; IGA)</option>
                    <option value="facebook_page">Facebook Page / Graph API Token (EAAB...)</option>
                    <option value="instagram_login">Instagram API with Instagram Login Token (IGA...)</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="ig-access-token" className="text-xs font-semibold">
                      Meta / Instagram Access Token *
                    </Label>
                    {accessToken.trim() && (
                      <span className="text-[11px] font-medium text-pink-500">
                        {/^IG[A-Z0-9]/i.test(accessToken.trim().replace(/^Bearer\s+/i, "").replace(/\s+/g, ""))
                          ? "Detected: Instagram Login Token"
                          : /^EAA/i.test(accessToken.trim().replace(/^Bearer\s+/i, "").replace(/\s+/g, ""))
                            ? "Detected: Meta / Facebook Graph Token"
                            : /^[a-f0-9]{32}$/i.test(accessToken.trim())
                              ? "Looks like a 32-char App Secret"
                              : ""}
                      </span>
                    )}
                  </div>
                  <div className="relative">
                    <Input
                      id="ig-access-token"
                      type={showAccessToken ? "text" : "password"}
                      placeholder="EAAB... or IGAA... / IGA..."
                      value={accessToken}
                      onChange={(e) => setAccessToken(e.target.value)}
                      className="pr-9"
                      disabled={actionLoading}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowAccessToken((v) => !v)}
                      aria-label={showAccessToken ? "Hide access token" : "Show access token"}
                      className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
                    >
                      {showAccessToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Generate under <strong>Meta Developers → Instagram → API setup with Instagram login → Generate access tokens</strong> (<code>IGAA...</code>) or <strong>Graph API Explorer</strong> (<code>EAAB...</code>). Do not paste an App Secret or <code>APP_ID|SECRET</code> here.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="ig-app-secret" className="text-xs font-semibold">
                    Meta App Secret <span className="text-muted-foreground font-normal">(recommended for webhook security)</span>
                  </Label>
                  <div className="relative">
                    <Input
                      id="ig-app-secret"
                      type={showAppSecret ? "text" : "password"}
                      placeholder="Found in Meta App → Settings → Basic"
                      value={appSecret}
                      onChange={(e) => setAppSecret(e.target.value)}
                      className="pr-9"
                      disabled={actionLoading}
                    />
                    <button
                      type="button"
                      onClick={() => setShowAppSecret((v) => !v)}
                      aria-label={showAppSecret ? "Hide app secret" : "Show app secret"}
                      className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
                    >
                      {showAppSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="ig-business-id">Instagram Business ID (Optional)</Label>
                    <Input
                      id="ig-business-id"
                      placeholder="Auto-detected if blank"
                      value={igBusinessId}
                      onChange={(e) => setIgBusinessId(e.target.value)}
                      disabled={actionLoading}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="page-id">Facebook Page ID (Optional)</Label>
                    <Input
                      id="page-id"
                      placeholder="Auto-detected if blank"
                      value={pageId}
                      onChange={(e) => setPageId(e.target.value)}
                      disabled={actionLoading}
                    />
                  </div>
                </div>

                <Button
                  type="submit"
                  disabled={actionLoading}
                  className="w-full bg-gradient-to-r from-pink-600 to-purple-600 text-white font-medium"
                >
                  {actionLoading ? "Verifying with Meta..." : "Save & Connect Meta Key"}
                </Button>
              </form>

              <div className="p-4 rounded-xl bg-muted/40 border space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Meta Webhook Configuration
                </h4>
                <div className="space-y-2 text-xs">
                  <div>
                    <span className="text-muted-foreground">Callback URL:</span>
                    <div className="flex items-center gap-2 mt-1">
                      <code className="px-2 py-1 rounded bg-background border font-mono text-[11px] flex-1 truncate">
                        {webhookUrl || "https://your-crm.com/api/instagram/webhook"}
                      </code>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => copyToClipboard(webhookUrl, "webhook")}
                      >
                        {copiedWebhook ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                      </Button>
                    </div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Verify Token:</span>
                    <div className="flex items-center gap-2 mt-1">
                      <Input
                        value={verifyToken}
                        onChange={(e) => setVerifyToken(e.target.value)}
                        placeholder={defaultVerifyToken || "masacrm_ig_verify_token"}
                        className="h-7 font-mono text-[11px]"
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          copyToClipboard(verifyToken || defaultVerifyToken, "token")
                        }
                      >
                        {copiedToken ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* TAB 2: Direct ID/Password & 2FA & Session Cookie */}
          <TabsContent value="direct" className="space-y-4">
            <div className="p-6 rounded-2xl bg-card border shadow-sm">
              {twoFactorPending ? (
                <form onSubmit={handleTwoFactorSubmit} className="space-y-4 max-w-md">
                  <div className="flex items-center gap-2">
                    <Shield className="h-5 w-5 text-pink-500" />
                    <h3 className="text-lg font-semibold">Two-Factor Verification Required</h3>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Enter the 6-digit{" "}
                    <strong>
                      {twoFactorPending.method === "sms"
                        ? `SMS code sent to ${twoFactorPending.obfuscatedPhone || "your phone"}`
                        : "Authenticator App code"}
                    </strong>{" "}
                    for <strong>@{twoFactorPending.username}</strong>.
                  </p>
                  <div className="space-y-1.5">
                    <Label htmlFor="ig-2fa-code" className="text-xs font-semibold">
                      Verification Code
                    </Label>
                    <Input
                      id="ig-2fa-code"
                      placeholder="123456"
                      value={twoFactorCode}
                      onChange={(e) => setTwoFactorCode(e.target.value)}
                      className="font-mono tracking-widest"
                      required
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="submit"
                      disabled={actionLoading}
                      className="flex-1 bg-gradient-to-r from-pink-600 to-purple-600 text-white"
                    >
                      {actionLoading ? "Verifying..." : "Verify & Connect"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setTwoFactorPending(null);
                        setTwoFactorCode("");
                      }}
                    >
                      Back
                    </Button>
                  </div>
                </form>
              ) : (
                <>
                  <div className="mb-6">
                    <h3 className="text-lg font-semibold">Connect with Instagram ID &amp; Password</h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      Supports Username/Password (with 2FA verification) or instant Browser Session Cookie.
                    </p>
                    <div className="flex items-center gap-2 mt-4 p-1 bg-muted/70 rounded-xl w-fit border text-xs">
                      <button
                        type="button"
                        onClick={() => setDirectAuthType("password")}
                        className={`px-3 py-1.5 rounded-lg font-medium ${
                          directAuthType === "password"
                            ? "bg-card text-foreground shadow-xs font-semibold"
                            : "text-muted-foreground"
                        }`}
                      >
                        Username &amp; Password
                      </button>
                      <button
                        type="button"
                        onClick={() => setDirectAuthType("session_id")}
                        className={`px-3 py-1.5 rounded-lg font-medium ${
                          directAuthType === "session_id"
                            ? "bg-card text-foreground shadow-xs font-semibold"
                            : "text-muted-foreground"
                        }`}
                      >
                        Session Cookie (Instant)
                      </button>
                    </div>
                  </div>

                  <form onSubmit={handleDirectLogin} className="space-y-4 max-w-md">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="ig-username" className="text-xs font-semibold">
                          Instagram Handle {directAuthType === "session_id" ? "(Optional)" : "*"}
                        </Label>
                        {validatingAccount && (
                          <span className="text-[11px] text-muted-foreground">Verifying...</span>
                        )}
                      </div>
                      <div className="relative">
                        <div className="absolute left-3 top-2.5 text-muted-foreground font-semibold text-sm">@</div>
                        <Input
                          id="ig-username"
                          placeholder="your_instagram_handle"
                          value={username}
                          onChange={(e) => handleUsernameChange(e.target.value)}
                          onBlur={() => void handleValidateAccount(username)}
                          className="pl-8"
                          disabled={actionLoading}
                          required={directAuthType === "password"}
                        />
                      </div>

                      {validationError && (
                        <div className="p-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-600 text-xs flex items-center gap-2">
                          <AlertCircle className="h-4 w-4 shrink-0" />
                          <span>{validationError}</span>
                        </div>
                      )}

                      {validatedAccount && (
                        <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center gap-3 text-xs">
                          <span className="font-semibold">{validatedAccount.name}</span>
                          <span className="text-muted-foreground">@{validatedAccount.username}</span>
                        </div>
                      )}
                    </div>

                    {directAuthType === "password" ? (
                      <div className="space-y-2">
                        <Label htmlFor="ig-password" className="text-xs font-semibold">
                          Password *
                        </Label>
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
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <Label htmlFor="ig-sessionid" className="text-xs font-semibold">
                          Instagram <code>sessionid</code> Cookie *
                        </Label>
                        <Input
                          id="ig-sessionid"
                          type="password"
                          placeholder="Paste browser cookie value for sessionid"
                          value={sessionId}
                          onChange={(e) => setSessionId(e.target.value)}
                          className="font-mono text-xs"
                          disabled={actionLoading}
                          required
                        />
                      </div>
                    )}

                    <Button
                      type="submit"
                      disabled={actionLoading || (directAuthType === "password" && !!validationError)}
                      className="w-full bg-gradient-to-r from-pink-600 to-purple-600 text-white font-bold"
                    >
                      {actionLoading ? "Connecting..." : "Connect Instagram Account"}
                    </Button>
                  </form>
                </>
              )}
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
