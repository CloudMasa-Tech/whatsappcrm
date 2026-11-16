"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
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
  Film,
  Image as ImageIcon,
  Layers,
  Heart,
  MessageCircle,
  Share2,
  MoreHorizontal,
  Trash2,
  Play,
  Pause,
  Users,
  Grid,
  BarChart3,
  Inbox,
  Send,
  Plus,
  Globe,
  ThumbsUp,
  UploadCloud,
} from "lucide-react";
import { FacebookBrandIcon } from "@/components/icons/facebook";
import { FacebookFeed } from "@/components/facebook/facebook-feed";
import { FacebookInsightsPanel } from "@/components/facebook/facebook-insights-panel";
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
  category?: string | null;
  about?: string | null;
  fan_count?: number | null;
  followers_count?: number | null;
  posts_count?: number | null;
  link?: string | null;
  is_verified?: boolean;
}

interface CarouselDraftItem {
  file: File;
  previewUrl: string;
}

const emptySubscribe = () => () => {};

const HASHTAG_SUGGESTIONS = [
  "#business",
  "#growth",
  "#innovation",
  "#marketing",
  "#tech",
  "#crm",
  "#sales",
  "#updates",
  "#facebook",
  "#community",
];

export function FacebookConfig({ canDisconnect = true }: FacebookConfigProps) {
  const browserOrigin = useSyncExternalStore(
    emptySubscribe,
    () => (typeof window !== "undefined" ? window.location.origin : ""),
    () => "",
  );
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [syncingProfile, setSyncingProfile] = useState(false);
  const [syncingInbox, setSyncingInbox] = useState(false);
  const [tableMissing, setTableMissing] = useState(false);
  const [config, setConfig] = useState<FacebookStatus | null>(null);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [defaultVerifyToken, setDefaultVerifyToken] = useState("");

  // Navigation tabs for Connected Hub:
  const [activeActionTab, setActiveActionTab] = useState<
    "publish" | "feed" | "dm" | "insights"
  >("publish");

  // Form inputs for connecting:
  const [accessToken, setAccessToken] = useState("");
  const [showAccessToken, setShowAccessToken] = useState(false);
  const [pageId, setPageId] = useState("");
  const [verifyToken, setVerifyToken] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [showAppSecret, setShowAppSecret] = useState(false);

  // Studio Publishing State:
  const [publishType, setPublishType] = useState<"feed" | "photo" | "carousel" | "video">("feed");
  const [publishMessage, setPublishMessage] = useState("");
  const [publishLinkUrl, setPublishLinkUrl] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [mediaPreviewUrl, setMediaPreviewUrl] = useState<string>("");
  const [carouselItems, setCarouselItems] = useState<CarouselDraftItem[]>([]);
  const [carouselPreviewIndex, setCarouselPreviewIndex] = useState(0);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const carouselInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Quick DM Composer State:
  const [quickDmRecipient, setQuickDmRecipient] = useState("");
  const [quickDmName, setQuickDmName] = useState("");
  const [quickDmText, setQuickDmText] = useState("");
  const [quickDmSending, setQuickDmSending] = useState(false);

  // 1-Click Page Discovery State:
  const [userToken, setUserToken] = useState("");
  const [showUserToken, setShowUserToken] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [discoveredPages, setDiscoveredPages] = useState<
    Array<{
      id: string;
      name: string;
      category?: string;
      accessToken: string;
      profilePictureUrl: string | null;
    }>
  >([]);

  // Copy states:
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);

  const [reloadKey, setReloadKey] = useState(0);
  const fetchConfig = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let ignore = false;

    async function load() {
      try {
        setLoading(true);
        const res = await fetch("/api/facebook/config", { cache: "no-store" });
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

  // Sync Profile button handler
  const handleSyncProfile = async () => {
    try {
      setSyncingProfile(true);
      const res = await fetch("/api/facebook/sync-profile", { method: "POST" });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to sync profile");
      }
      toast.success(
        `Refreshed live Facebook stats for "${data.profile?.name || config?.page_name || "Page"}"!`,
      );
      fetchConfig();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to sync Facebook Page.");
    } finally {
      setSyncingProfile(false);
    }
  };

  // Sync DMs button handler
  const handleSyncInbox = async () => {
    try {
      setSyncingInbox(true);
      const res = await fetch("/api/facebook/sync-inbox", { method: "POST" });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to sync Facebook Messenger DMs");
      }
      toast.success(
        `Synced ${data.threadsSynced ?? 0} Messenger threads (${data.messagesIngested ?? 0} new messages) to CRM Inbox!`,
      );
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to sync Facebook DMs.");
    } finally {
      setSyncingInbox(false);
    }
  };

  // Quick DM Send handler
  const handleSendQuickDm = async (e: React.FormEvent) => {
    e.preventDefault();
    const recipient = quickDmRecipient.trim();
    const message = quickDmText.trim();
    if (!recipient) {
      toast.error("Please enter a recipient Facebook Page-Scoped ID (PSID).");
      return;
    }
    if (!message) {
      toast.error("Please type a message to send.");
      return;
    }

    try {
      setQuickDmSending(true);
      const res = await fetch("/api/facebook/dm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipientPsid: recipient,
          recipientName: quickDmName.trim() || undefined,
          message,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to send Messenger message");
      }
      toast.success("Messenger Direct Message sent successfully!");
      setQuickDmText("");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to send message.");
    } finally {
      setQuickDmSending(false);
    }
  };

  // File selection for single photo/video:
  const handleFileSelect = (file: File) => {
    if (file.size > 50 * 1024 * 1024) {
      toast.error("File exceeds 50 MB limit.");
      return;
    }
    setSelectedFile(file);
    const url = URL.createObjectURL(file);
    setMediaPreviewUrl(url);
  };

  const handleRemoveMedia = () => {
    setSelectedFile(null);
    if (mediaPreviewUrl) URL.revokeObjectURL(mediaPreviewUrl);
    setMediaPreviewUrl("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // Carousel files:
  const handleCarouselFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const remainingSlots = 10 - carouselItems.length;
    if (remainingSlots <= 0) {
      toast.error("Maximum 10 carousel items allowed.");
      return;
    }
    const newItems: CarouselDraftItem[] = [];
    const chosen = Array.from(files).slice(0, remainingSlots);
    for (const f of chosen) {
      if (f.size > 50 * 1024 * 1024) {
        toast.error(`File ${f.name} exceeds 50 MB limit.`);
        continue;
      }
      newItems.push({
        file: f,
        previewUrl: URL.createObjectURL(f),
      });
    }
    setCarouselItems((prev) => [...prev, ...newItems]);
  };

  const removeCarouselItem = (idx: number) => {
    setCarouselItems((prev) => {
      const copy = [...prev];
      const removed = copy.splice(idx, 1);
      if (removed[0]) URL.revokeObjectURL(removed[0].previewUrl);
      return copy;
    });
    setCarouselPreviewIndex(0);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (publishType === "carousel") {
      handleCarouselFiles(e.dataTransfer.files);
    } else if (e.dataTransfer.files?.[0]) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  };

  const toggleVideoPlayback = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      videoRef.current.play().catch(() => {});
      setIsPlaying(true);
    }
  };

  const addHashtag = (tag: string) => {
    if (!publishMessage.includes(tag)) {
      setPublishMessage((prev) => (prev ? `${prev} ${tag}` : tag));
    }
  };

  // Upload helper:
  const uploadSingleFile = async (file: File): Promise<string> => {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch("/api/facebook/upload", {
      method: "POST",
      body: formData,
    });
    const data = await res.json();
    if (!res.ok || data.error || !data.url) {
      throw new Error(data.error || "Media upload to storage failed");
    }
    return data.url;
  };

  // Studio Publish Submission:
  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();

    if (publishType === "carousel" && carouselItems.length < 2) {
      toast.error("Carousel posts require at least 2 photos.");
      return;
    }
    if (publishType === "photo" && !selectedFile && !mediaPreviewUrl) {
      toast.error("Please upload a photo to publish.");
      return;
    }
    if (publishType === "video" && !selectedFile && !mediaPreviewUrl) {
      toast.error("Please upload a video to publish.");
      return;
    }
    if (publishType === "feed" && !publishMessage.trim() && !publishLinkUrl.trim()) {
      toast.error("Provide a status message or link URL to publish.");
      return;
    }

    try {
      setPublishing(true);
      let uploadedUrl = "";
      const uploadedCarouselItems: Array<{ url: string; kind: "image" | "video" }> = [];

      if (publishType === "photo" || publishType === "video") {
        if (selectedFile) {
          setUploadingMedia(true);
          uploadedUrl = await uploadSingleFile(selectedFile);
          setUploadingMedia(false);
        } else {
          uploadedUrl = mediaPreviewUrl;
        }
      } else if (publishType === "carousel") {
        setUploadingMedia(true);
        for (const item of carouselItems) {
          const url = await uploadSingleFile(item.file);
          uploadedCarouselItems.push({ url, kind: "image" });
        }
        setUploadingMedia(false);
      }

      const res = await fetch("/api/facebook/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: publishType,
          message: publishMessage.trim() || undefined,
          linkUrl: publishLinkUrl.trim() || undefined,
          mediaUrl: uploadedUrl || undefined,
          mediaItems:
            uploadedCarouselItems.length > 0 ? uploadedCarouselItems : undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to publish post to Facebook");
      }

      toast.success("Post successfully published to Facebook!");
      // Reset form
      setPublishMessage("");
      setPublishLinkUrl("");
      handleRemoveMedia();
      setCarouselItems([]);
      setActiveActionTab("feed");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to publish post.");
    } finally {
      setPublishing(false);
      setUploadingMedia(false);
    }
  };

  // Connection Handlers:
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

      if (data.pages.length === 1) {
        await handleConnectDiscoveredPage(data.pages[0]);
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to find Facebook Pages.");
    } finally {
      setDiscovering(false);
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

  // Active preview calculations
  const activePreviewUrl =
    publishType === "carousel"
      ? carouselItems[carouselPreviewIndex]?.previewUrl || ""
      : mediaPreviewUrl;
  const activePreviewIsVideo =
    publishType === "video" ||
    (selectedFile && selectedFile.type.startsWith("video/"));

  return (
    <div className="space-y-6">
      {/* Missing table warning banner */}
      {tableMissing && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-200 flex items-start gap-2.5">
          <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
          <span>
            Database table <code className="font-mono">facebook_config</code> was not found. Apply{" "}
            <code className="font-mono">supabase/migrations/058_facebook_config.sql</code> in Supabase SQL Editor.
          </span>
        </div>
      )}

      {/* ======================================================== */}
      {/* CONNECTED STATE: Complete Dashboard (Matches Instagram) */}
      {/* ======================================================== */}
      {isConnected && config && (
        <div className="p-6 rounded-2xl bg-card border shadow-xs space-y-6">
          {/* Profile Summary Header */}
          <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-5">
            <div className="flex items-start sm:items-center gap-4">
              {config.profile_picture_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={config.profile_picture_url}
                  alt={config.page_name || "Facebook Page"}
                  className="h-20 w-20 rounded-full object-cover border-2 border-blue-500/40 ring-4 ring-blue-500/10 shadow-sm shrink-0"
                />
              ) : (
                <div className="h-20 w-20 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold text-3xl shadow-sm shrink-0">
                  {(config.page_name || "FB").charAt(0).toUpperCase()}
                </div>
              )}

              <div className="space-y-1.5 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-xl font-bold text-foreground">
                    {config.page_name || "Connected Facebook Page"}
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
                    Meta Key (Page Token)
                  </Badge>
                  {config.category && (
                    <Badge variant="outline" className="text-[11px] text-muted-foreground">
                      {config.category}
                    </Badge>
                  )}
                </div>

                <p className="text-xs text-muted-foreground font-mono">
                  Page ID: <code className="text-blue-500 dark:text-blue-400 font-bold">{config.page_id}</code>
                  {config.connected_at && ` • Connected on ${new Date(config.connected_at).toLocaleDateString()}`}
                </p>

                {/* Followers, Likes & Posts stats bar */}
                <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-muted/60 border font-medium">
                    <Users className="h-3.5 w-3.5 text-blue-500" />
                    <strong>
                      {config.followers_count != null ? config.followers_count.toLocaleString() : "—"}
                    </strong>{" "}
                    Followers
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-muted/60 border font-medium">
                    <ThumbsUp className="h-3.5 w-3.5 text-blue-600" />
                    <strong>
                      {config.fan_count != null ? config.fan_count.toLocaleString() : "—"}
                    </strong>{" "}
                    Likes / Fans
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-muted/60 border font-medium">
                    <Grid className="h-3.5 w-3.5 text-indigo-500" />
                    <strong>
                      {config.posts_count != null ? config.posts_count.toLocaleString() : "—"}
                    </strong>{" "}
                    Posts
                  </span>
                </div>

                {config.about && (
                  <p className="text-xs text-muted-foreground italic line-clamp-2 max-w-xl pt-1">
                    &ldquo;{config.about}&rdquo;
                  </p>
                )}

                {config.link && (
                  <a
                    href={config.link}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-blue-500 hover:underline inline-flex items-center gap-1 font-medium"
                  >
                    View Page on Facebook <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>

            {/* Header Action Buttons */}
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
                className="font-medium text-xs gap-1.5 border-blue-500/30 text-blue-600 dark:text-blue-400 hover:bg-blue-500/10"
              >
                <Inbox className={`h-3.5 w-3.5 ${syncingInbox ? "animate-spin" : ""}`} />
                {syncingInbox ? "Syncing DMs..." : "Sync DMs"}
              </Button>
              <Button
                size="sm"
                className="bg-blue-600 hover:bg-blue-700 text-white font-medium shadow-sm"
                onClick={() => (window.location.href = "/inbox")}
              >
                <FacebookBrandIcon className="h-4 w-4 mr-2" /> Open Inbox
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

          {/* Tab Switcher */}
          <div className="pt-4 border-t border-border">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
              <div className="inline-flex flex-wrap rounded-xl bg-muted/60 p-1 border gap-1">
                {(
                  [
                    { id: "publish", label: "Studio (Post / Photo / Video / Carousel)", icon: Film },
                    { id: "feed", label: "Feed & Posts", icon: Grid },
                    { id: "dm", label: "Direct Messages", icon: Send },
                    { id: "insights", label: "Insights & Webhook", icon: BarChart3 },
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
                      <Icon className="h-3.5 w-3.5 text-blue-600" />
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              <Button
                size="sm"
                variant="outline"
                className="text-xs gap-1.5 border-blue-500/20 text-blue-600 hover:bg-blue-500/10 dark:text-blue-400"
                onClick={() =>
                  window.open(
                    config.link || `https://www.facebook.com/${config.page_id}`,
                    "_blank",
                  )
                }
              >
                <UploadCloud className="h-3.5 w-3.5" />
                Open Facebook Page
              </Button>
            </div>

            {/* TAB 1: Studio */}
            {activeActionTab === "publish" && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                <div className="lg:col-span-7 space-y-5 bg-card/60 rounded-2xl border p-5 shadow-xs">
                  <div>
                    <h4 className="text-base font-bold flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-blue-600" /> Facebook Publishing Studio
                    </h4>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Publish Feed Updates, Photos, Multi-Photo Albums, or Videos directly to your connected Facebook Page.
                    </p>
                  </div>

                  <form onSubmit={handlePublish} className="space-y-4">
                    {/* Format Selector */}
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        1. Select Format
                      </Label>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {(
                          [
                            { id: "feed", label: "Status Post", sub: "Text or Link", icon: Grid },
                            { id: "photo", label: "Photo Post", sub: "Single Image", icon: ImageIcon },
                            { id: "carousel", label: "Photo Album", sub: "2–10 Photos", icon: Layers },
                            { id: "video", label: "Video", sub: "MP4 / MOV Video", icon: Film },
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
                                  ? "bg-blue-500/15 border-blue-500 text-blue-600 dark:text-blue-400 ring-2 ring-blue-500/20"
                                  : "bg-muted/30 border-border text-muted-foreground hover:border-muted-foreground/40"
                              }`}
                            >
                              <Icon className="h-4 w-4 text-blue-600" />
                              <span>{fmt.label}</span>
                              <span className="text-[10px] font-normal opacity-80">{fmt.sub}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Media Dropzone (if photo, carousel, or video) */}
                    {publishType !== "feed" && (
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
                            publishType === "video"
                              ? "video/mp4,video/quicktime,video/webm"
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
                          accept="image/jpeg,image/png,image/webp"
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
                                    carouselPreviewIndex === idx ? "border-blue-500" : "border-border"
                                  }`}
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={item.previewUrl}
                                    alt={`Slide ${idx + 1}`}
                                    className="h-full w-full object-cover"
                                  />
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
                                  className="aspect-square rounded-xl border-2 border-dashed border-border hover:border-blue-500 flex flex-col items-center justify-center text-muted-foreground hover:text-blue-500 gap-1 text-xs"
                                >
                                  <Plus className="h-5 w-5" />
                                  Add Photo
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
                                ? "border-blue-500 bg-blue-500/10 scale-[0.99]"
                                : "border-border/80 bg-muted/20 hover:bg-muted/40 hover:border-blue-500/50"
                            }`}
                          >
                            <div className="h-12 w-12 rounded-full bg-blue-600 flex items-center justify-center text-white shadow-md mb-3">
                              {publishType === "video" ? <Film className="h-6 w-6" /> : <ImageIcon className="h-6 w-6" />}
                            </div>
                            <p className="text-sm font-semibold text-foreground">
                              Click or drag &amp; drop {publishType === "video" ? "video" : "photo"} here
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">
                              Up to 50 MB ({publishType === "video" ? "MP4, MOV" : "JPG, PNG, WEBP"})
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
                    )}

                    {/* Link URL (optional for feed status) */}
                    {publishType === "feed" && (
                      <div className="space-y-1.5">
                        <Label htmlFor="post-link" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          Attach Link URL (Optional)
                        </Label>
                        <Input
                          id="post-link"
                          type="url"
                          placeholder="https://yourwebsite.com/blog-post"
                          value={publishLinkUrl}
                          onChange={(e) => setPublishLinkUrl(e.target.value)}
                          className="text-xs"
                        />
                      </div>
                    )}

                    {/* Caption & Hashtags */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="fb-post-caption" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          {publishType === "feed" ? "2. Status Message" : "3. Caption & Hashtags"}
                        </Label>
                        <span className="text-[11px] text-muted-foreground">
                          {publishMessage.length} characters
                        </span>
                      </div>
                      <Textarea
                        id="fb-post-caption"
                        rows={3}
                        placeholder="What's on your mind? Write your Facebook post with hashtags..."
                        value={publishMessage}
                        onChange={(e) => setPublishMessage(e.target.value)}
                        className="text-xs resize-none"
                      />
                      <div className="flex flex-wrap gap-1.5">
                        {HASHTAG_SUGGESTIONS.map((tag) => (
                          <button
                            key={tag}
                            type="button"
                            onClick={() => addHashtag(tag)}
                            className={`text-[11px] px-2 py-0.5 rounded-full border ${
                              publishMessage.includes(tag)
                                ? "bg-blue-500/20 border-blue-500/40 text-blue-600 font-bold"
                                : "bg-muted/50 border-border text-muted-foreground"
                            }`}
                          >
                            {tag}
                          </button>
                        ))}
                      </div>
                    </div>

                    <Button
                      type="submit"
                      disabled={
                        publishing ||
                        uploadingMedia ||
                        (publishType === "carousel"
                          ? carouselItems.length < 2
                          : publishType === "feed"
                            ? !publishMessage.trim() && !publishLinkUrl.trim()
                            : !selectedFile && !mediaPreviewUrl)
                      }
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold h-11 shadow-sm"
                    >
                      {uploadingMedia
                        ? "Uploading Media..."
                        : publishing
                          ? "Publishing to Facebook..."
                          : `Publish ${
                              publishType === "photo"
                                ? "Photo Post"
                                : publishType === "carousel"
                                  ? "Photo Album"
                                  : publishType === "video"
                                    ? "Video"
                                    : "Post"
                            } Now`}
                    </Button>
                  </form>
                </div>

                {/* Live Facebook Post Preview */}
                <div className="lg:col-span-5 flex flex-col items-center">
                  <div className="w-full max-w-[340px] rounded-2xl bg-card border shadow-lg overflow-hidden text-foreground">
                    {/* Facebook Post Author Header */}
                    <div className="p-3.5 flex items-center justify-between border-b border-border/50">
                      <div className="flex items-center gap-2.5">
                        <div className="h-9 w-9 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold overflow-hidden shrink-0">
                          {config.profile_picture_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={config.profile_picture_url}
                              alt={config.page_name || "Page"}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            (config.page_name || "FB").slice(0, 2).toUpperCase()
                          )}
                        </div>
                        <div>
                          <p className="text-xs font-bold leading-tight flex items-center gap-1">
                            {config.page_name || "Your Facebook Page"}
                            {config.is_verified && <CheckCircle2 className="h-3 w-3 text-blue-500 fill-blue-500 text-white" />}
                          </p>
                          <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                            Just now · <Globe className="h-2.5 w-2.5" />
                          </p>
                        </div>
                      </div>
                      <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                    </div>

                    {/* Preview Text */}
                    <div className="p-3.5 space-y-2">
                      <p className="text-xs leading-relaxed whitespace-pre-wrap">
                        {publishMessage || "Your Facebook post caption preview will appear here..."}
                      </p>
                      {publishLinkUrl && (
                        <p className="text-xs text-blue-600 hover:underline truncate">
                          {publishLinkUrl}
                        </p>
                      )}
                    </div>

                    {/* Preview Media */}
                    {activePreviewUrl ? (
                      <div className="relative aspect-video bg-black flex items-center justify-center overflow-hidden">
                        {activePreviewIsVideo ? (
                          <video src={activePreviewUrl} className="w-full h-full object-cover" muted autoPlay loop />
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={activePreviewUrl} alt="Post preview" className="w-full h-full object-cover" />
                        )}
                        {publishType === "carousel" && (
                          <div className="absolute top-2 right-2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] text-white font-semibold">
                            {carouselPreviewIndex + 1}/{carouselItems.length}
                          </div>
                        )}
                      </div>
                    ) : publishType !== "feed" ? (
                      <div className="aspect-video bg-muted/30 border-y border-border/50 flex flex-col items-center justify-center text-muted-foreground gap-1.5 p-4 text-center">
                        <ImageIcon className="h-8 w-8 stroke-1 text-muted-foreground/60" />
                        <span className="text-[11px]">Upload media to see photo/video preview</span>
                      </div>
                    ) : null}

                    {/* Facebook Like / Comment / Share Bar */}
                    <div className="p-2 border-t border-border/50 grid grid-cols-3 text-center text-xs text-muted-foreground font-semibold">
                      <div className="flex items-center justify-center gap-1 py-1.5 rounded-lg hover:bg-muted/50 cursor-pointer text-blue-600 dark:text-blue-400">
                        <ThumbsUp className="h-3.5 w-3.5" /> Like
                      </div>
                      <div className="flex items-center justify-center gap-1 py-1.5 rounded-lg hover:bg-muted/50 cursor-pointer">
                        <MessageCircle className="h-3.5 w-3.5" /> Comment
                      </div>
                      <div className="flex items-center justify-center gap-1 py-1.5 rounded-lg hover:bg-muted/50 cursor-pointer">
                        <Share2 className="h-3.5 w-3.5" /> Share
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: Feed & Posts */}
            {activeActionTab === "feed" && (
              <FacebookFeed
                pageName={config.page_name}
                profilePictureUrl={config.profile_picture_url}
              />
            )}

            {/* TAB 3: Direct Messages & Sync */}
            {activeActionTab === "dm" && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Send Direct Message Card */}
                <div className="space-y-4 bg-muted/40 p-5 rounded-2xl border">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold flex items-center gap-2">
                      <Send className="h-4 w-4 text-blue-600" /> Send Messenger Direct Message
                    </h4>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Send an instant Messenger message to a Facebook user using their Page-Scoped ID (PSID).
                  </p>
                  <form onSubmit={handleSendQuickDm} className="space-y-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="fb-quick-dm-user" className="text-xs">
                        Recipient Facebook PSID (Page-Scoped ID) *
                      </Label>
                      <Input
                        id="fb-quick-dm-user"
                        placeholder="e.g. 1405852192604483 or fb:1405852192604483"
                        value={quickDmRecipient}
                        onChange={(e) => setQuickDmRecipient(e.target.value)}
                        className="text-xs font-mono"
                        required
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="fb-quick-dm-name" className="text-xs">
                        Recipient Display Name (Optional)
                      </Label>
                      <Input
                        id="fb-quick-dm-name"
                        placeholder="e.g. John Doe"
                        value={quickDmName}
                        onChange={(e) => setQuickDmName(e.target.value)}
                        className="text-xs"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="fb-quick-dm-text" className="text-xs">
                        Message *
                      </Label>
                      <Textarea
                        id="fb-quick-dm-text"
                        rows={3}
                        placeholder="Type your Facebook Messenger message here..."
                        value={quickDmText}
                        onChange={(e) => setQuickDmText(e.target.value)}
                        className="text-xs resize-none"
                        required
                      />
                    </div>
                    <Button
                      type="submit"
                      size="sm"
                      disabled={quickDmSending || !quickDmRecipient.trim() || !quickDmText.trim()}
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                    >
                      {quickDmSending ? "Sending Messenger..." : "Send Messenger Message"}
                    </Button>
                  </form>
                </div>

                {/* Sync Existing Messenger DMs to CRM Inbox Card */}
                <div className="space-y-4 bg-muted/40 p-5 rounded-2xl border flex flex-col justify-between">
                  <div className="space-y-2">
                    <h4 className="text-sm font-semibold flex items-center gap-2">
                      <Inbox className="h-4 w-4 text-blue-600" /> Sync Existing Messenger DMs to CRM Inbox
                    </h4>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Pull your recent Facebook Page conversation threads and messages directly into the Unified Inbox automatically (safe &amp; deduplicated — never creates duplicates).
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
                      <RefreshCw className={`h-3.5 w-3.5 ${syncingInbox ? "animate-spin text-blue-600" : ""}`} />
                      {syncingInbox ? "Syncing Threads..." : "Pull Recent DMs Now"}
                    </Button>
                    <Button
                      type="button"
                      onClick={() => (window.location.href = "/inbox")}
                      className="text-xs bg-blue-600 hover:bg-blue-700 text-white"
                    >
                      Go to Unified Inbox
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 4: Insights & Webhook */}
            {activeActionTab === "insights" && (
              <FacebookInsightsPanel
                followersCount={config.followers_count}
                fanCount={config.fan_count}
                postsCount={config.posts_count}
                pageId={config.page_id}
                pageName={config.page_name}
                category={config.category}
                webhookUrl={webhookUrl}
                verifyToken={defaultVerifyToken}
              />
            )}
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* DISCONNECTED STATE: Connection & Discovery Forms        */}
      {/* ======================================================== */}
      {!isConnected && (
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
                    <Badge variant="outline" className="text-muted-foreground">
                      {loading ? "Checking..." : "Disconnected"}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Connect your Facebook Business Page to publish updates, view feeds, and receive customer Messenger chats directly inside CRM Inbox.
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

          {/* 1-Click Page Discovery & Connect (Instant) */}
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

            <form onSubmit={handleDiscoverPages} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="fb-user-token" className="text-xs font-semibold">
                  Meta Access Token
                </Label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      id="fb-user-token"
                      type={showUserToken ? "text" : "password"}
                      placeholder="EAA..."
                      value={userToken}
                      onChange={(e) => setUserToken(e.target.value)}
                      className="font-mono text-xs pr-9"
                      disabled={discovering || actionLoading}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowUserToken(!showUserToken)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showUserToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <Button
                    type="submit"
                    disabled={discovering || actionLoading || !userToken.trim()}
                    className="h-9 text-xs gap-1.5 bg-blue-600 hover:bg-blue-700 text-white shrink-0"
                  >
                    {discovering ? (
                      <>
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        Finding...
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-3.5 w-3.5" />
                        Find Pages
                      </>
                    )}
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  In Graph API Explorer: select your Page and grant <code>pages_show_list</code>, <code>pages_read_engagement</code>, <code>pages_manage_posts</code>, and <code>pages_messaging</code> permissions, then paste the token here.
                </p>
              </div>
            </form>

            {/* Discovered Pages List */}
            {discoveredPages.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-border">
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Select a Facebook Page to Connect:
                </Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {discoveredPages.map((page) => (
                    <div
                      key={page.id}
                      className="p-3 rounded-xl border border-border bg-muted/30 hover:border-blue-500/50 flex items-center justify-between gap-3 transition-all"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="h-9 w-9 rounded-full bg-blue-600/10 flex items-center justify-center text-blue-600 font-bold border border-blue-600/20 overflow-hidden shrink-0">
                          {page.profilePictureUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={page.profilePictureUrl} alt={page.name} className="h-full w-full object-cover" />
                          ) : (
                            page.name.slice(0, 2).toUpperCase()
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-foreground truncate">{page.name}</p>
                          <p className="text-[10px] text-muted-foreground truncate font-mono">ID: {page.id}</p>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        disabled={actionLoading}
                        onClick={() => handleConnectDiscoveredPage(page)}
                        className="h-8 text-xs bg-blue-600 hover:bg-blue-700 text-white shrink-0"
                      >
                        Connect
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Manual Token Setup */}
          <div className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-4">
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
                <Label htmlFor="manual-page-token" className="text-xs font-semibold">
                  Page / Meta Access Token *
                </Label>
                <div className="relative">
                  <Input
                    id="manual-page-token"
                    type={showAccessToken ? "text" : "password"}
                    placeholder="EAAG..."
                    value={accessToken}
                    onChange={(e) => setAccessToken(e.target.value)}
                    className="font-mono text-xs pr-9"
                    disabled={actionLoading}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowAccessToken(!showAccessToken)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showAccessToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="manual-page-id" className="text-xs">Facebook Page ID (Optional)</Label>
                  <Input
                    id="manual-page-id"
                    placeholder="e.g. 104829384729102"
                    value={pageId}
                    onChange={(e) => setPageId(e.target.value)}
                    className="text-xs"
                    disabled={actionLoading}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="manual-app-secret" className="text-xs">Meta App Secret (Optional)</Label>
                  <div className="relative">
                    <Input
                      id="manual-app-secret"
                      type={showAppSecret ? "text" : "password"}
                      placeholder="Required for webhooks"
                      value={appSecret}
                      onChange={(e) => setAppSecret(e.target.value)}
                      className="text-xs pr-8"
                      disabled={actionLoading}
                    />
                    <button
                      type="button"
                      onClick={() => setShowAppSecret(!showAppSecret)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showAppSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="manual-verify-token" className="text-xs">Custom Webhook Verify Token (Optional)</Label>
                  <Input
                    id="manual-verify-token"
                    placeholder={defaultVerifyToken || "masacrm_fb_verify_token"}
                    value={verifyToken}
                    onChange={(e) => setVerifyToken(e.target.value)}
                    className="text-xs font-mono"
                    disabled={actionLoading}
                  />
                </div>
              </div>

              <Button
                type="submit"
                disabled={actionLoading || !accessToken.trim()}
                className="h-9 text-xs bg-blue-600 hover:bg-blue-700 text-white gap-1.5"
              >
                <Shield className="h-3.5 w-3.5" />
                {actionLoading ? "Verifying..." : "Verify & Connect Page"}
              </Button>
            </form>
          </div>

          {/* Webhook Configuration for Disconnected mode */}
          <div className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Globe className="h-3.5 w-3.5 text-blue-500" /> Meta Webhook Configuration
            </h4>
            <p className="text-xs text-muted-foreground">
              Configure these parameters in your Meta App Dashboard under Messenger → Settings → Webhooks.
            </p>
            <div className="space-y-3 text-xs pt-1">
              <div>
                <span className="text-muted-foreground font-semibold">Callback URL:</span>
                <div className="flex items-center gap-2 mt-1">
                  <code className="px-3 py-2 rounded-xl bg-muted/60 border font-mono text-[11px] flex-1 truncate select-all">
                    {webhookUrl || `${browserOrigin}/api/facebook/webhook`}
                  </code>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => copyToClipboard(webhookUrl || `${browserOrigin}/api/facebook/webhook`, "webhook")}
                  >
                    {copiedWebhook ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              </div>
              <div>
                <span className="text-muted-foreground font-semibold">Verify Token:</span>
                <div className="flex items-center gap-2 mt-1">
                  <code className="px-3 py-2 rounded-xl bg-muted/60 border font-mono text-[11px] flex-1 truncate select-all">
                    {verifyToken || defaultVerifyToken || "masacrm_fb_verify_token"}
                  </code>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => copyToClipboard(verifyToken || defaultVerifyToken || "masacrm_fb_verify_token", "token")}
                  >
                    {copiedToken ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
