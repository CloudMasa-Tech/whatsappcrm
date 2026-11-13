"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Link from "next/link";
import {
  AlertCircle,
  BookmarkPlus,
  CheckCircle2,
  ExternalLink,
  FileText,
  Film,
  History,
  ImagePlus,
  Info,
  Link2,
  Loader2,
  Megaphone,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  Sparkles,
  Trash2,
  Upload,
  Users,
  X,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { FacebookBrandIcon } from "@/components/icons/facebook";
import { InstagramGradientIcon } from "@/components/icons/instagram";
import { LinkedInBrandIcon } from "@/components/icons/linkedin";
import { WhatsAppBrandIcon } from "@/components/icons/whatsapp";
import { XBrandIcon } from "@/components/icons/x";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import {
  detectMediaKindFromMimeOrUrl,
  getPlatformCompatibilityWarnings,
  MAX_SOCIAL_WA_RECIPIENTS,
  parseWhatsAppPhoneLines,
  SOCIAL_PLATFORM_LABELS,
  STARTER_SOCIAL_TEMPLATES,
  validateSocialMediaFile,
  type InstagramPublishMode,
  type SavedSocialTemplate,
  type SocialCampaignHistoryEntry,
  type SocialMediaItem,
  type SocialPlatform,
  type SocialPlatformPublishResult,
  type SocialPlatformStatus,
} from "@/lib/social/campaigns";
import { cn } from "@/lib/utils";

interface ApprovedWaTemplate {
  id: string;
  name: string;
  language: string;
  category?: string;
  body_text?: string;
}

interface AudienceTag {
  id: string;
  name: string;
  color?: string | null;
}

interface SocialStatusResponse {
  projectId: string;
  platforms: SocialPlatformStatus[];
  whatsappAudience: {
    contactCount: number;
    tags: AudienceTag[];
    approvedTemplates: ApprovedWaTemplate[];
  };
}

const PLATFORM_SETTINGS_HREF: Record<SocialPlatform, string> = {
  whatsapp: "/whatsapp",
  instagram: "/instagram",
  facebook: "/facebook",
  linkedin: "/linkedin",
  x: "/x",
};

const PLATFORM_BRAND_ICON: Record<SocialPlatform, React.ReactNode> = {
  whatsapp: <WhatsAppBrandIcon className="h-5 w-5 shrink-0" />,
  instagram: <InstagramGradientIcon className="h-5 w-5 shrink-0" />,
  facebook: <FacebookBrandIcon className="h-5 w-5 shrink-0" />,
  linkedin: <LinkedInBrandIcon className="h-5 w-5 shrink-0" />,
  x: <XBrandIcon className="h-5 w-5 shrink-0" />,
};

const emptySubscribe = () => () => {};
const STORAGE_CHANGE_EVENT = "masacrm-social-storage-change";

function subscribeToSocialStorage(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(STORAGE_CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(STORAGE_CHANGE_EVENT, callback);
  };
}

function getTemplatesStorageKey(projectId: string): string {
  return `masacrm_social_templates_${projectId}`;
}

function getHistoryStorageKey(projectId: string): string {
  return `masacrm_social_history_${projectId}`;
}

function readStoredJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed as T;
  } catch {
    return fallback;
  }
}

function writeStoredJson(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    window.dispatchEvent(new Event(STORAGE_CHANGE_EVENT));
  } catch {
    // ignore quota errors
  }
}

export default function SocialCampaignsPage() {
  const { activeProjectId, loading, profileLoading } = useAuth();
  const isHydrated = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );

  // Status + audience state
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusData, setStatusData] = useState<SocialStatusResponse | null>(null);

  // Template drawer visibility
  const [showTemplates, setShowTemplates] = useState(true);

  // Composer state
  const [campaignName, setCampaignName] = useState("");
  const [selectedPlatforms, setSelectedPlatforms] = useState<SocialPlatform[]>([]);
  const [caption, setCaption] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [media, setMedia] = useState<SocialMediaItem[]>([]);
  const [manualMediaUrl, setManualMediaUrl] = useState("");
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  // Platform-specific controls
  const [instagramType, setInstagramType] = useState<InstagramPublishMode>("auto");
  const [linkedinVisibility, setLinkedinVisibility] = useState<"PUBLIC" | "CONNECTIONS">("PUBLIC");
  const [linkedinAuthorUrn, setLinkedinAuthorUrn] = useState("");
  const [waAudienceType, setWaAudienceType] = useState<"all" | "tags" | "csv">("all");
  const [waTagIds, setWaTagIds] = useState<string[]>([]);
  const [waCsvText, setWaCsvText] = useState("");
  const [waTemplateName, setWaTemplateName] = useState("");

  // Publishing state
  const [publishing, setPublishing] = useState(false);
  const [lastResults, setLastResults] = useState<SocialPlatformPublishResult[] | null>(null);

  const mediaInputRef = useRef<HTMLInputElement>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);
  const autoSelectedOnceRef = useRef<string | null>(null);

  const effectiveProjectId =
    statusData?.projectId ||
    (activeProjectId && activeProjectId !== "all" ? activeProjectId : "default");

  const templatesStorageKey = getTemplatesStorageKey(effectiveProjectId);
  const historyStorageKey = getHistoryStorageKey(effectiveProjectId);

  const savedTemplatesJson = useSyncExternalStore(
    subscribeToSocialStorage,
    () => (typeof window !== "undefined" ? window.localStorage.getItem(templatesStorageKey) ?? "[]" : "[]"),
    () => "[]",
  );
  const historyJson = useSyncExternalStore(
    subscribeToSocialStorage,
    () => (typeof window !== "undefined" ? window.localStorage.getItem(historyStorageKey) ?? "[]" : "[]"),
    () => "[]",
  );

  const savedTemplates = useMemo<SavedSocialTemplate[]>(() => {
    try {
      const parsed = JSON.parse(savedTemplatesJson);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, [savedTemplatesJson]);

  const campaignHistory = useMemo<SocialCampaignHistoryEntry[]>(() => {
    try {
      const parsed = JSON.parse(historyJson);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, [historyJson]);

  const applyStatusResponse = useCallback((data: SocialStatusResponse) => {
    setStatusError(null);
    setStatusData(data);

    // Set default LinkedIn author if options are returned
    const li = data.platforms.find((p) => p.platform === "linkedin");
    if (li?.authorOptions?.length) {
      setLinkedinAuthorUrn((prev) =>
        prev && li.authorOptions?.some((o) => o.value === prev)
          ? prev
          : li.authorOptions![0].value,
      );
    }

    // Default approved Meta template if Cloud API has one
    if (data.whatsappAudience.approvedTemplates.length > 0) {
      setWaTemplateName((prev) =>
        prev &&
        data.whatsappAudience.approvedTemplates.some((t) => t.name === prev)
          ? prev
          : data.whatsappAudience.approvedTemplates[0].name,
      );
    }

    // Auto-select all connected channels once per resolved project
    if (autoSelectedOnceRef.current !== data.projectId) {
      autoSelectedOnceRef.current = data.projectId;
      const connected = data.platforms
        .filter((p) => p.connected)
        .map((p) => p.platform);
      setSelectedPlatforms(connected);
    }
  }, []);

  const fetchStatusUrl = useMemo(() => {
    const qs =
      activeProjectId && activeProjectId !== "all"
        ? `?projectId=${encodeURIComponent(activeProjectId)}`
        : "";
    return `/api/social-campaigns/status${qs}`;
  }, [activeProjectId]);

  const handleRefreshChannels = async () => {
    setStatusLoading(true);
    setStatusError(null);
    try {
      const res = await fetch(fetchStatusUrl, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error || "Failed to load channel connection status");
      }
      applyStatusResponse(json as SocialStatusResponse);
    } catch (err) {
      setStatusError(
        err instanceof Error ? err.message : "Could not check channel readiness",
      );
    } finally {
      setStatusLoading(false);
    }
  };

  useEffect(() => {
    if (loading || profileLoading) return;
    let cancelled = false;
    fetch(fetchStatusUrl, { cache: "no-store" })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) {
          throw new Error(
            json?.error || "Failed to load channel connection status",
          );
        }
        return json as SocialStatusResponse;
      })
      .then((data) => {
        if (!cancelled) applyStatusResponse(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setStatusError(
            err instanceof Error
              ? err.message
              : "Could not check channel readiness",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setStatusLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [applyStatusResponse, fetchStatusUrl, loading, profileLoading]);

  const platformStatuses = useMemo(
    () => statusData?.platforms ?? [],
    [statusData],
  );

  const connectedPlatforms = useMemo(
    () => platformStatuses.filter((p) => p.connected).map((p) => p.platform),
    [platformStatuses],
  );

  const waStatus = useMemo(
    () => platformStatuses.find((p) => p.platform === "whatsapp"),
    [platformStatuses],
  );

  const liStatus = useMemo(
    () => platformStatuses.find((p) => p.platform === "linkedin"),
    [platformStatuses],
  );

  const parsedCsvRecipients = useMemo(
    () => parseWhatsAppPhoneLines(waCsvText),
    [waCsvText],
  );

  const selectedWaTemplateObj = useMemo(
    () =>
      statusData?.whatsappAudience.approvedTemplates.find(
        (t) => t.name === waTemplateName,
      ) ?? null,
    [statusData, waTemplateName],
  );

  const compatibilityWarnings = useMemo(
    () =>
      getPlatformCompatibilityWarnings({
        platforms: selectedPlatforms,
        media,
        caption,
        whatsappMode:
          waStatus?.mode === "cloud_api" ? "cloud_api" : "qr",
        whatsappTemplateName: waTemplateName || null,
      }),
    [selectedPlatforms, media, caption, waStatus, waTemplateName],
  );

  const togglePlatform = (platform: SocialPlatform) => {
    const info = platformStatuses.find((p) => p.platform === platform);
    if (!info?.connected) {
      toast.info(
        `${SOCIAL_PLATFORM_LABELS[platform]} is not connected yet. Connect it first.`,
      );
      return;
    }
    setSelectedPlatforms((prev) =>
      prev.includes(platform)
        ? prev.filter((p) => p !== platform)
        : [...prev, platform],
    );
  };

  const selectAllConnected = () => {
    if (connectedPlatforms.length === 0) {
      toast.info("Connect at least one social channel first.");
      return;
    }
    setSelectedPlatforms(connectedPlatforms);
  };

  const handleUploadFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;

    for (const file of list) {
      const validationError = validateSocialMediaFile(
        file.name,
        file.type || "",
        file.size,
      );
      if (validationError) {
        toast.error(validationError);
        return;
      }
    }

    setUploadingMedia(true);
    try {
      const uploaded: SocialMediaItem[] = [];
      for (const file of list) {
        const fd = new FormData();
        fd.append("file", file);
        if (effectiveProjectId && effectiveProjectId !== "default") {
          fd.append("projectId", effectiveProjectId);
        }
        const res = await fetch("/api/social-campaigns/upload", {
          method: "POST",
          body: fd,
        });
        const json = await res.json();
        if (!res.ok) {
          throw new Error(json?.error || `Failed to upload ${file.name}`);
        }
        uploaded.push({
          url: json.url as string,
          kind: json.kind as SocialMediaItem["kind"],
          fileName: (json.fileName as string) || file.name,
          mimeType: (json.fileType as string) || file.type,
        });
      }
      setMedia((prev) => [...prev, ...uploaded]);
      toast.success(
        `Uploaded ${uploaded.length} media file${uploaded.length > 1 ? "s" : ""}`,
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to upload media file",
      );
    } finally {
      setUploadingMedia(false);
    }
  };

  const handleAddManualMediaUrl = () => {
    const url = manualMediaUrl.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) {
      toast.error("Enter a valid public https:// media URL.");
      return;
    }
    const kind = detectMediaKindFromMimeOrUrl(url);
    const fileName = url.split("/").pop()?.split("?")[0] || "Linked media";
    setMedia((prev) => [...prev, { url, kind, fileName }]);
    setManualMediaUrl("");
  };

  const handleRemoveMedia = (idx: number) => {
    setMedia((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleMoveMedia = (idx: number, direction: -1 | 1) => {
    setMedia((prev) => {
      const next = [...prev];
      const target = idx + direction;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  };

  const handleLoadTemplate = (tpl: {
    name: string;
    caption: string;
    linkUrl?: string;
    media?: SocialMediaItem[];
    platforms?: SocialPlatform[];
  }) => {
    setCampaignName(tpl.name);
    setCaption(tpl.caption);
    setLinkUrl(tpl.linkUrl ?? "");
    if (tpl.media) {
      setMedia(tpl.media);
    }
    if (tpl.platforms && connectedPlatforms.length > 0) {
      const matching = tpl.platforms.filter((p) =>
        connectedPlatforms.includes(p),
      );
      if (matching.length > 0) {
        setSelectedPlatforms(matching);
      }
    }
    toast.success(`Loaded template "${tpl.name}"`);
  };

  const handleSaveAsTemplate = () => {
    const cleanName = campaignName.trim();
    if (!cleanName) {
      toast.error("Give your campaign a name before saving as a template.");
      return;
    }
    if (!caption.trim() && media.length === 0) {
      toast.error("Add campaign text or media before saving a template.");
      return;
    }

    const existing = readStoredJson<SavedSocialTemplate[]>(
      templatesStorageKey,
      [],
    );
    const newItem: SavedSocialTemplate = {
      id: `tpl_${Date.now()}`,
      name: cleanName,
      caption: caption.trim(),
      linkUrl: linkUrl.trim() || undefined,
      media,
      platforms: selectedPlatforms,
      updatedAt: new Date().toISOString(),
    };
    const next = [
      newItem,
      ...existing.filter((t) => t.name.toLowerCase() !== cleanName.toLowerCase()),
    ].slice(0, 25);
    writeStoredJson(templatesStorageKey, next);
    toast.success(`Saved reusable template "${cleanName}"`);
  };

  const handleDeleteSavedTemplate = (id: string) => {
    const existing = readStoredJson<SavedSocialTemplate[]>(
      templatesStorageKey,
      [],
    );
    writeStoredJson(
      templatesStorageKey,
      existing.filter((t) => t.id !== id),
    );
    toast.success("Template deleted");
  };

  const handleWaCsvFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (/\.(xlsx|xls)$/i.test(file.name)) {
      toast.error(
        "Save Excel sheets as .csv first — binary .xlsx files cannot be read directly.",
      );
      return;
    }
    try {
      const text = await file.text();
      const parsed = parseWhatsAppPhoneLines(text);
      if (parsed.length === 0) {
        toast.error("No valid phone numbers found in that CSV/TXT file.");
        return;
      }
      setWaCsvText((prev) => (prev.trim() ? `${prev.trim()}\n${text.trim()}` : text.trim()));
      toast.success(`Loaded ${parsed.length} WhatsApp recipient(s)`);
    } catch {
      toast.error("Failed to read recipient CSV file");
    }
  };

  const toggleWaTag = (tagId: string) => {
    setWaTagIds((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId],
    );
  };

  const handlePublish = async () => {
    if (selectedPlatforms.length === 0) {
      toast.error("Select at least one connected social platform.");
      return;
    }
    if (!caption.trim() && !linkUrl.trim() && media.length === 0) {
      toast.error("Enter a message/caption, attach media, or add a link URL.");
      return;
    }

    const blockingErrors = compatibilityWarnings.filter(
      (w) => w.level === "error",
    );
    if (blockingErrors.length > 0) {
      toast.error(blockingErrors[0].message);
      return;
    }

    if (selectedPlatforms.includes("whatsapp")) {
      if (waAudienceType === "tags" && waTagIds.length === 0) {
        toast.error("Select at least one WhatsApp contact tag.");
        return;
      }
      if (waAudienceType === "csv" && parsedCsvRecipients.length === 0) {
        toast.error("Paste or import at least one WhatsApp phone number.");
        return;
      }
    }

    setPublishing(true);
    setLastResults(null);
    try {
      const res = await fetch("/api/social-campaigns/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId:
            activeProjectId && activeProjectId !== "all"
              ? activeProjectId
              : undefined,
          platforms: selectedPlatforms,
          caption: caption.trim(),
          linkUrl: linkUrl.trim(),
          media,
          instagramType,
          linkedinVisibility,
          linkedinAuthorUrn: linkedinAuthorUrn || undefined,
          whatsapp: {
            audienceType: waAudienceType,
            tagIds: waTagIds,
            csvRecipients: parsedCsvRecipients.slice(0, MAX_SOCIAL_WA_RECIPIENTS),
            templateName: selectedWaTemplateObj?.name,
            templateLanguage: selectedWaTemplateObj?.language,
          },
        }),
      });

      const json = await res.json();
      if (!res.ok && !Array.isArray(json?.results)) {
        throw new Error(json?.error || "Failed to broadcast social campaign");
      }

      const results = (json.results ?? []) as SocialPlatformPublishResult[];
      setLastResults(results);

      const sentCount = results.filter((r) => r.status === "sent").length;
      const failCount = results.filter((r) => r.status === "failed").length;
      if (sentCount > 0 && failCount === 0) {
        toast.success(
          `Broadcast published to ${sentCount} platform${sentCount > 1 ? "s" : ""}!`,
        );
      } else if (sentCount > 0) {
        toast.warning(
          `Published to ${sentCount} platform(s), ${failCount} failed — review delivery report below.`,
        );
      } else {
        toast.error("All selected platforms failed — check errors below.");
      }

      // Persist run in local history
      const historyEntry: SocialCampaignHistoryEntry = {
        id: `run_${Date.now()}`,
        name:
          campaignName.trim() ||
          `Social Broadcast (${new Date().toLocaleDateString()})`,
        caption: caption.trim(),
        linkUrl: linkUrl.trim() || undefined,
        media,
        platforms: selectedPlatforms,
        results,
        createdAt: new Date().toISOString(),
      };
      const prevHistory = readStoredJson<SocialCampaignHistoryEntry[]>(
        historyStorageKey,
        [],
      );
      writeStoredJson(historyStorageKey, [historyEntry, ...prevHistory].slice(0, 20));
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Social broadcast failed",
      );
    } finally {
      setPublishing(false);
    }
  };

  if (loading || profileLoading || !isHydrated) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-violet-400" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 pb-12">
      {/* Page Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-500/15 text-violet-400">
              <Megaphone className="h-5 w-5" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Social Campaigns
            </h1>
            <Badge
              variant="secondary"
              className="border border-violet-500/30 bg-violet-500/10 text-violet-300"
            >
              Omnichannel
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Compose once with a reusable template &amp; media, then broadcast simultaneously to
            connected WhatsApp, Instagram, Facebook, LinkedIn, and X accounts.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleRefreshChannels}
            disabled={statusLoading}
          >
            <RefreshCw
              className={cn("mr-1.5 h-3.5 w-3.5", statusLoading && "animate-spin")}
            />
            Refresh Channels
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowTemplates((v) => !v)}
          >
            <Sparkles className="mr-1.5 h-3.5 w-3.5 text-violet-400" />
            {showTemplates ? "Hide Templates" : "Show Templates"}
          </Button>
        </div>
      </div>

      {statusError && (
        <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{statusError}</span>
        </div>
      )}

      {/* Reusable Social Templates Strip */}
      {showTemplates && (
        <section className="rounded-xl border border-border/60 bg-card/60 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-violet-400" />
              <h2 className="text-sm font-semibold text-foreground">
                Reusable Social Templates
              </h2>
              <span className="text-xs text-muted-foreground">
                Load a preset or saved template into your single composer
              </span>
            </div>
            <span className="text-xs text-muted-foreground">
              {savedTemplates.length} custom saved
            </span>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            {savedTemplates.map((tpl) => (
              <div
                key={tpl.id}
                className="flex flex-col justify-between rounded-lg border border-violet-500/25 bg-background/60 p-3"
              >
                <div className="space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <Badge
                        variant="outline"
                        className="mb-1 border-violet-500/40 text-[10px] text-violet-300"
                      >
                        Saved Template
                      </Badge>
                      <h3 className="text-sm font-semibold text-foreground line-clamp-1">
                        {tpl.name}
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteSavedTemplate(tpl.id)}
                      className="rounded p-1 text-muted-foreground hover:bg-red-500/10 hover:text-red-400"
                      title="Delete saved template"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {tpl.caption || "(Media-only template)"}
                  </p>
                </div>

                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="text-[11px] text-muted-foreground">
                    {tpl.media.length} media
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="h-7 text-xs"
                    onClick={() => handleLoadTemplate(tpl)}
                  >
                    Use Template
                  </Button>
                </div>
              </div>
            ))}

            {STARTER_SOCIAL_TEMPLATES.map((tpl) => (
              <div
                key={tpl.id}
                className="flex flex-col justify-between rounded-lg border border-border/60 bg-background/50 p-3"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant="outline" className="text-[10px]">
                      {tpl.category}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">
                      4 channels
                    </span>
                  </div>
                  <h3 className="text-sm font-semibold text-foreground line-clamp-1">
                    {tpl.name}
                  </h3>
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {tpl.description}
                  </p>
                </div>

                <div className="mt-3 flex items-center justify-end">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="h-7 text-xs"
                    onClick={() =>
                      handleLoadTemplate({
                        name: tpl.name,
                        caption: tpl.caption,
                        linkUrl: tpl.linkUrl,
                        platforms: tpl.suggestedPlatforms,
                      })
                    }
                  >
                    Use Template
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Target Channels Grid */}
      <section className="rounded-xl border border-border/60 bg-card/60 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              1. Select Target Social Platforms
            </h2>
            <p className="text-xs text-muted-foreground">
              Choose which connected channels receive this broadcast ({selectedPlatforms.length}{" "}
              selected of {connectedPlatforms.length} connected).
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={selectAllConnected}
              disabled={connectedPlatforms.length === 0}
            >
              Select All Connected
            </Button>
            {selectedPlatforms.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setSelectedPlatforms([])}
              >
                Clear
              </Button>
            )}
          </div>
        </div>

        {statusLoading && platformStatuses.length === 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {[1, 2, 3, 4, 5].map((n) => (
              <div
                key={n}
                className="h-28 animate-pulse rounded-xl border border-border/50 bg-background/40"
              />
            ))}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {platformStatuses.map((item) => {
              const isSelected = selectedPlatforms.includes(item.platform);
              return (
                <div
                  key={item.platform}
                  onClick={() => {
                    if (item.connected) togglePlatform(item.platform);
                  }}
                  role={item.connected ? "button" : undefined}
                  tabIndex={item.connected ? 0 : undefined}
                  onKeyDown={(e) => {
                    if (item.connected && (e.key === "Enter" || e.key === " ")) {
                      e.preventDefault();
                      togglePlatform(item.platform);
                    }
                  }}
                  className={cn(
                    "relative flex flex-col justify-between rounded-xl border p-3.5 transition-all",
                    item.connected
                      ? "cursor-pointer hover:border-violet-500/50"
                      : "opacity-75",
                    isSelected
                      ? "border-violet-500 bg-violet-500/10 ring-1 ring-violet-500/40"
                      : "border-border/60 bg-background/50",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      {PLATFORM_BRAND_ICON[item.platform]}
                      <div>
                        <p className="text-sm font-semibold text-foreground">
                          {item.label}
                        </p>
                        <p className="text-xs text-muted-foreground line-clamp-1">
                          {item.detail || (item.connected ? "Connected" : "Not connected")}
                        </p>
                      </div>
                    </div>

                    {item.connected ? (
                      <Badge
                        variant="outline"
                        className={cn(
                          "shrink-0 text-[10px]",
                          isSelected
                            ? "border-violet-400/50 bg-violet-500/20 text-violet-200"
                            : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
                        )}
                      >
                        {isSelected ? "Selected" : "Ready"}
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="shrink-0 border-amber-500/40 bg-amber-500/10 text-[10px] text-amber-300"
                      >
                        Disconnected
                      </Badge>
                    )}
                  </div>

                  <div className="mt-3 flex items-center justify-between text-[11px]">
                    {item.connected ? (
                      <span className="text-muted-foreground">
                        {isSelected ? "Included in broadcast" : "Click card to include"}
                      </span>
                    ) : (
                      <>
                        <span className="text-amber-300/90 line-clamp-1">
                          {item.reason || "Setup required"}
                        </span>
                        <Link
                          href={PLATFORM_SETTINGS_HREF[item.platform]}
                          onClick={(e) => e.stopPropagation()}
                          className="ml-2 inline-flex shrink-0 items-center gap-1 font-medium text-violet-400 hover:underline"
                        >
                          Connect
                          <ExternalLink className="h-3 w-3" />
                        </Link>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Main Composer Grid */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left 2 Columns: Shared Content & Media */}
        <div className="space-y-5 lg:col-span-2">
          <section className="space-y-4 rounded-xl border border-border/60 bg-card/60 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-foreground">
                  2. Compose Single Campaign Content
                </h2>
                <p className="text-xs text-muted-foreground">
                  Write your message, attach photos/videos/PDFs, and broadcast everywhere at once.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleSaveAsTemplate}
              >
                <BookmarkPlus className="mr-1.5 h-3.5 w-3.5" />
                Save as Template
              </Button>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="social-campaign-name" className="text-xs">
                Campaign Name (used for templates &amp; history)
              </Label>
              <Input
                id="social-campaign-name"
                value={campaignName}
                onChange={(e) => setCampaignName(e.target.value)}
                placeholder="e.g. Q4 Product Launch / RegiBIZ GST Promo"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="social-campaign-caption" className="text-xs">
                  Message / Caption
                </Label>
                <span className="text-[11px] text-muted-foreground">
                  {caption.length} chars · Supports {"{{name}}"} on WhatsApp
                </span>
              </div>
              <Textarea
                id="social-campaign-caption"
                rows={7}
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="Write one announcement for WhatsApp, Instagram, Facebook, and LinkedIn..."
                className="resize-y"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="social-campaign-link" className="text-xs">
                Call-to-Action Link URL (Optional)
              </Label>
              <div className="relative">
                <Link2 className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="social-campaign-link"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  placeholder="https://yourwebsite.com/offer"
                  className="pl-9"
                />
              </div>
            </div>

            {/* Shared Media Upload */}
            <div className="space-y-2.5 pt-1">
              <div className="flex items-center justify-between">
                <Label className="text-xs">
                  Media Attachments (Images, Videos, or PDFs — up to 50 MB each)
                </Label>
                <span className="text-[11px] text-muted-foreground">
                  {media.length} attached
                </span>
              </div>

              <input
                ref={mediaInputRef}
                type="file"
                multiple
                accept="image/*,video/*,application/pdf"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) void handleUploadFiles(e.target.files);
                  e.target.value = "";
                }}
              />

              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={() => setDragActive(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragActive(false);
                  if (e.dataTransfer.files?.length) {
                    void handleUploadFiles(e.dataTransfer.files);
                  }
                }}
                onClick={() => mediaInputRef.current?.click()}
                className={cn(
                  "flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-4 py-6 text-center transition-colors",
                  dragActive
                    ? "border-violet-400 bg-violet-500/10"
                    : "border-border/70 bg-background/40 hover:border-violet-500/50",
                )}
              >
                {uploadingMedia ? (
                  <div className="flex items-center gap-2 text-sm text-violet-300">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Uploading media...
                  </div>
                ) : (
                  <>
                    <ImagePlus className="mb-2 h-6 w-6 text-violet-400" />
                    <p className="text-sm font-medium text-foreground">
                      Drop images, videos, or PDFs here — or click to browse
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Hosted on public HTTPS storage so Instagram, Facebook, LinkedIn &amp; WhatsApp
                      can fetch them
                    </p>
                  </>
                )}
              </div>

              {/* Optional manual public media URL input */}
              <div className="flex gap-2">
                <Input
                  value={manualMediaUrl}
                  onChange={(e) => setManualMediaUrl(e.target.value)}
                  placeholder="Or paste an already-hosted public image/video https:// URL..."
                  className="text-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleAddManualMediaUrl}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  Add URL
                </Button>
              </div>

              {/* Attached Media List */}
              {media.length > 0 && (
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {media.map((item, idx) => (
                    <div
                      key={`${item.url}-${idx}`}
                      className="flex items-center gap-3 rounded-lg border border-border/60 bg-background/60 p-2.5"
                    >
                      {item.kind === "image" ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={item.url}
                          alt={item.fileName || `Media ${idx + 1}`}
                          className="h-12 w-12 shrink-0 rounded-md object-cover border border-border/50"
                        />
                      ) : item.kind === "video" ? (
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-violet-500/15 text-violet-300">
                          <Film className="h-5 w-5" />
                        </div>
                      ) : (
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-amber-500/15 text-amber-300">
                          <FileText className="h-5 w-5" />
                        </div>
                      )}

                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-foreground">
                          {item.fileName || item.url}
                        </p>
                        <p className="text-[11px] uppercase text-muted-foreground">
                          {item.kind}
                          {idx === 0 && " · Primary"}
                        </p>
                      </div>

                      <div className="flex items-center gap-1">
                        {media.length > 1 && idx > 0 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 px-1.5 text-xs"
                            onClick={() => handleMoveMedia(idx, -1)}
                            title="Move earlier"
                          >
                            ↑
                          </Button>
                        )}
                        {media.length > 1 && idx < media.length - 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 px-1.5 text-xs"
                            onClick={() => handleMoveMedia(idx, 1)}
                            title="Move later"
                          >
                            ↓
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-1.5 text-red-400 hover:bg-red-500/10 hover:text-red-300"
                          onClick={() => handleRemoveMedia(idx)}
                          title="Remove media"
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* Delivery Report (after broadcast) */}
          {lastResults && (
            <section className="space-y-3 rounded-xl border border-border/60 bg-card/60 p-5">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">
                  Broadcast Delivery Results
                </h3>
                <span className="text-xs text-muted-foreground">
                  {lastResults.filter((r) => r.status === "sent").length} succeeded ·{" "}
                  {lastResults.filter((r) => r.status === "failed").length} failed
                </span>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {lastResults.map((res) => (
                  <div
                    key={res.platform}
                    className={cn(
                      "rounded-lg border p-3 text-xs",
                      res.status === "sent"
                        ? "border-emerald-500/30 bg-emerald-500/10"
                        : "border-red-500/30 bg-red-500/10",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 font-semibold text-foreground">
                        {PLATFORM_BRAND_ICON[res.platform]}
                        {SOCIAL_PLATFORM_LABELS[res.platform]}
                      </div>
                      {res.status === "sent" ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                      ) : (
                        <XCircle className="h-4 w-4 text-red-400" />
                      )}
                    </div>
                    <p className="mt-1.5 font-medium text-foreground">{res.summary}</p>
                    {res.externalId && (
                      <p className="mt-1 truncate text-[11px] text-muted-foreground">
                        ID: {res.externalId}
                      </p>
                    )}
                    {res.error && (
                      <p className="mt-1 text-[11px] text-red-300">{res.error}</p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Right Column: Per-Platform Options, Compatibility & Broadcast Action */}
        <div className="space-y-5">
          {/* Compatibility & Preflight Hints */}
          <section className="space-y-3 rounded-xl border border-border/60 bg-card/60 p-4">
            <h2 className="text-sm font-semibold text-foreground">
              3. Channel Options &amp; Preflight
            </h2>

            {compatibilityWarnings.length > 0 ? (
              <div className="space-y-2">
                {compatibilityWarnings.map((w, idx) => (
                  <div
                    key={`${w.platform}-${idx}`}
                    className={cn(
                      "flex items-start gap-2 rounded-lg border px-3 py-2 text-xs",
                      w.level === "error"
                        ? "border-red-500/30 bg-red-500/10 text-red-200"
                        : "border-sky-500/30 bg-sky-500/10 text-sky-200",
                    )}
                  >
                    {w.level === "error" ? (
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
                    ) : (
                      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-400" />
                    )}
                    <span>
                      <strong className="font-semibold">
                        {SOCIAL_PLATFORM_LABELS[w.platform]}:
                      </strong>{" "}
                      {w.message}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                {selectedPlatforms.length > 0
                  ? "All selected platforms look ready for this payload."
                  : "Select one or more platforms above to see compatibility notes."}
              </p>
            )}

            {/* Instagram Options */}
            {selectedPlatforms.includes("instagram") && (
              <div className="space-y-1.5 border-t border-border/50 pt-3">
                <Label htmlFor="ig-publish-mode" className="text-xs font-medium">
                  Instagram Format
                </Label>
                <select
                  id="ig-publish-mode"
                  value={instagramType}
                  onChange={(e) =>
                    setInstagramType(e.target.value as InstagramPublishMode)
                  }
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="auto">Auto (Photo / Carousel / Reel)</option>
                  <option value="post">Feed Post / Carousel</option>
                  <option value="reel">Instagram Reel (Video)</option>
                  <option value="story">Instagram Story</option>
                </select>
              </div>
            )}

            {/* LinkedIn Options */}
            {selectedPlatforms.includes("linkedin") && (
              <div className="space-y-2.5 border-t border-border/50 pt-3">
                <div className="space-y-1.5">
                  <Label htmlFor="li-author-select" className="text-xs font-medium">
                    LinkedIn Publisher
                  </Label>
                  {liStatus?.authorOptions && liStatus.authorOptions.length > 0 ? (
                    <select
                      id="li-author-select"
                      value={linkedinAuthorUrn}
                      onChange={(e) => setLinkedinAuthorUrn(e.target.value)}
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                      {liStatus.authorOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Default connected LinkedIn profile
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="li-visibility-select" className="text-xs font-medium">
                    LinkedIn Visibility
                  </Label>
                  <select
                    id="li-visibility-select"
                    value={linkedinVisibility}
                    onChange={(e) =>
                      setLinkedinVisibility(
                        e.target.value as "PUBLIC" | "CONNECTIONS",
                      )
                    }
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="PUBLIC">Public (Anyone on LinkedIn)</option>
                    <option value="CONNECTIONS">Connections Only</option>
                  </select>
                </div>
              </div>
            )}

            {/* WhatsApp Audience & Mode Options */}
            {selectedPlatforms.includes("whatsapp") && (
              <div className="space-y-3 border-t border-border/50 pt-3">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium">
                    WhatsApp Broadcast Audience
                  </Label>
                  <Badge variant="outline" className="text-[10px]">
                    Max {MAX_SOCIAL_WA_RECIPIENTS} / run
                  </Badge>
                </div>

                <div className="grid grid-cols-3 gap-1.5">
                  {(
                    [
                      {
                        id: "all",
                        label: `All (${statusData?.whatsappAudience.contactCount ?? 0})`,
                      },
                      { id: "tags", label: "By Tags" },
                      { id: "csv", label: "CSV / List" },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setWaAudienceType(opt.id)}
                      className={cn(
                        "rounded-md border px-2 py-1.5 text-[11px] font-medium transition-colors",
                        waAudienceType === opt.id
                          ? "border-violet-500 bg-violet-500/15 text-violet-200"
                          : "border-border/60 bg-background/40 text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {waAudienceType === "tags" && (
                  <div className="space-y-1.5">
                    {statusData?.whatsappAudience.tags.length ? (
                      <div className="flex flex-wrap gap-1.5">
                        {statusData.whatsappAudience.tags.map((tag) => {
                          const active = waTagIds.includes(tag.id);
                          return (
                            <button
                              key={tag.id}
                              type="button"
                              onClick={() => toggleWaTag(tag.id)}
                              className={cn(
                                "rounded-full border px-2.5 py-0.5 text-[11px] transition-colors",
                                active
                                  ? "border-violet-400 bg-violet-500/20 text-violet-200"
                                  : "border-border/60 bg-background/50 text-muted-foreground hover:text-foreground",
                              )}
                            >
                              {tag.name}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        No contact tags created yet in this project.
                      </p>
                    )}
                  </div>
                )}

                {waAudienceType === "csv" && (
                  <div className="space-y-2">
                    <input
                      ref={csvInputRef}
                      type="file"
                      accept=".csv,.txt,.tsv,text/csv,text/plain"
                      className="hidden"
                      onChange={(e) => void handleWaCsvFileChange(e)}
                    />
                    <div className="flex items-center justify-between gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => csvInputRef.current?.click()}
                      >
                        <Upload className="mr-1.5 h-3 w-3" />
                        Import CSV / TXT
                      </Button>
                      <span className="text-[11px] text-muted-foreground">
                        {parsedCsvRecipients.length} parsed
                      </span>
                    </div>
                    <Textarea
                      rows={4}
                      value={waCsvText}
                      onChange={(e) => setWaCsvText(e.target.value)}
                      placeholder={"+919876543210, Priya\n+919988776655, Arjun"}
                      className="text-xs font-mono"
                    />
                  </div>
                )}

                {waStatus?.mode === "cloud_api" && (
                  <div className="space-y-1.5">
                    <Label htmlFor="wa-cloud-template" className="text-xs font-medium">
                      Approved Meta Template (Cloud API)
                    </Label>
                    {statusData?.whatsappAudience.approvedTemplates.length ? (
                      <select
                        id="wa-cloud-template"
                        value={waTemplateName}
                        onChange={(e) => setWaTemplateName(e.target.value)}
                        className="h-9 w-full rounded-md border border-input bg-background px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                      >
                        {statusData.whatsappAudience.approvedTemplates.map((tpl) => (
                          <option key={tpl.id} value={tpl.name}>
                            {tpl.name} ({tpl.language})
                          </option>
                        ))}
                      </select>
                    ) : (
                      <p className="text-xs text-amber-300">
                        No approved Meta Templates found — create &amp; sync templates on{" "}
                        <Link href="/templates" className="underline">
                          Templates
                        </Link>
                        .
                      </p>
                    )}
                  </div>
                )}

                {waStatus?.mode === "qr" && (
                  <div className="flex items-start gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-2 text-[11px] text-emerald-200/90">
                    <Users className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                      QR Gateway sends your caption + uploaded images, videos &amp; PDFs directly
                      and records them in Inbox.
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Primary Broadcast Action */}
            <div className="border-t border-border/50 pt-3">
              <Button
                type="button"
                className="w-full bg-violet-600 text-white hover:bg-violet-500"
                disabled={
                  publishing ||
                  uploadingMedia ||
                  selectedPlatforms.length === 0
                }
                onClick={() => void handlePublish()}
              >
                {publishing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Broadcasting to {selectedPlatforms.length} platform
                    {selectedPlatforms.length > 1 ? "s" : ""}...
                  </>
                ) : (
                  <>
                    <Send className="mr-2 h-4 w-4" />
                    Broadcast to {selectedPlatforms.length} Platform
                    {selectedPlatforms.length === 1 ? "" : "s"}
                  </>
                )}
              </Button>
            </div>
          </section>

          {/* Recent Campaigns History */}
          <section className="space-y-3 rounded-xl border border-border/60 bg-card/60 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <History className="h-4 w-4 text-violet-400" />
                <h2 className="text-sm font-semibold text-foreground">
                  Recent Social Campaigns
                </h2>
              </div>
              <span className="text-xs text-muted-foreground">
                {campaignHistory.length}
              </span>
            </div>

            {campaignHistory.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Your published omnichannel social broadcasts for this project will appear here.
              </p>
            ) : (
              <div className="max-h-96 space-y-2.5 overflow-y-auto pr-1">
                {campaignHistory.map((entry) => (
                  <div
                    key={entry.id}
                    className="space-y-2 rounded-lg border border-border/60 bg-background/50 p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-foreground">
                          {entry.name}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {new Date(entry.createdAt).toLocaleString()}
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-[11px]"
                        onClick={() =>
                          handleLoadTemplate({
                            name: entry.name,
                            caption: entry.caption,
                            linkUrl: entry.linkUrl,
                            media: entry.media,
                            platforms: entry.platforms,
                          })
                        }
                      >
                        <RotateCcw className="mr-1 h-3 w-3" />
                        Reuse
                      </Button>
                    </div>

                    <div className="flex flex-wrap gap-1">
                      {entry.results.map((r) => (
                        <Badge
                          key={r.platform}
                          variant="outline"
                          className={cn(
                            "text-[10px]",
                            r.status === "sent"
                              ? "border-emerald-500/40 text-emerald-300"
                              : "border-red-500/40 text-red-300",
                          )}
                        >
                          {SOCIAL_PLATFORM_LABELS[r.platform]}:{" "}
                          {r.status === "sent" ? "Sent" : "Failed"}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
