"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  BarChart3,
  Edit3,
  ExternalLink,
  Film,
  Heart,
  Image as ImageIcon,
  Layers,
  Loader2,
  Lock,
  MessageCircle,
  RefreshCw,
  Tag,
  Unlock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  InstagramInsightMetric,
  InstagramMediaItem,
  InstagramStoryItem,
} from "@/lib/instagram/types";

interface InstagramMediaFeedProps {
  isCloudApi: boolean;
  onSelectMediaForComments: (mediaId: string) => void;
}

export function InstagramMediaFeed({
  isCloudApi,
  onSelectMediaForComments,
}: InstagramMediaFeedProps) {
  const [loading, setLoading] = useState(isCloudApi);
  const [media, setMedia] = useState<InstagramMediaItem[]>([]);
  const [stories, setStories] = useState<InstagramStoryItem[]>([]);
  const [mentions, setMentions] = useState<InstagramMediaItem[]>([]);
  const [viewMode, setViewMode] = useState<"feed" | "mentions">("feed");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Selected detail modal state
  const [selected, setSelected] = useState<InstagramMediaItem | null>(null);
  const [editCaption, setEditCaption] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [postInsights, setPostInsights] = useState<InstagramInsightMetric[]>([]);
  const [loadingInsights, setLoadingInsights] = useState(false);

  const loadFeed = useCallback(async () => {
    if (!isCloudApi) return;
    try {
      setLoading(true);
      setErrorMsg(null);
      const res = await fetch("/api/instagram/media?include=stories,mentions&limit=24", {
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to load Instagram feed");
      }
      setMedia(data.media ?? []);
      setStories(data.stories ?? []);
      setMentions(data.mentions ?? []);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to load feed");
    } finally {
      setLoading(false);
    }
  }, [isCloudApi]);

  useEffect(() => {
    if (!isCloudApi) return;
    let cancelled = false;
    fetch("/api/instagram/media?include=stories,mentions&limit=24", { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok || data.error) {
          throw new Error(data.error || "Failed to load Instagram feed");
        }
        return data;
      })
      .then((data) => {
        if (cancelled) return;
        setErrorMsg(null);
        setMedia(data.media ?? []);
        setStories(data.stories ?? []);
        setMentions(data.mentions ?? []);
      })
      .catch((err) => {
        if (!cancelled) {
          setErrorMsg(err instanceof Error ? err.message : "Failed to load feed");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isCloudApi]);

  const openMediaDetail = async (item: InstagramMediaItem) => {
    setSelected(item);
    setEditCaption(item.caption || "");
    setPostInsights([]);
    try {
      setLoadingInsights(true);
      const res = await fetch(
        `/api/instagram/insights?mediaId=${encodeURIComponent(item.id)}&mediaType=${encodeURIComponent(item.media_product_type || item.media_type)}`,
        { cache: "no-store" },
      );
      if (res.ok) {
        const data = await res.json();
        setPostInsights(data.metrics ?? []);
      }
    } catch {
      // Insights optional per post tier
    } finally {
      setLoadingInsights(false);
    }
  };

  const handleSaveCaption = async () => {
    if (!selected) return;
    try {
      setSavingEdit(true);
      const res = await fetch("/api/instagram/media", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaId: selected.id, caption: editCaption }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Failed to update caption");
      toast.success("Post caption updated!");
      setMedia((prev) =>
        prev.map((m) => (m.id === selected.id ? { ...m, caption: editCaption } : m)),
      );
      setSelected((prev) => (prev ? { ...prev, caption: editCaption } : null));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update caption");
    } finally {
      setSavingEdit(false);
    }
  };

  const handleToggleComments = async (item: InstagramMediaItem) => {
    const nextEnabled = item.is_comment_enabled === false;
    try {
      setSavingEdit(true);
      const res = await fetch("/api/instagram/media", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaId: item.id, comment_enabled: nextEnabled }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Failed to toggle comments");
      toast.success(nextEnabled ? "Comments enabled on post" : "Comments disabled on post");
      setMedia((prev) =>
        prev.map((m) => (m.id === item.id ? { ...m, is_comment_enabled: nextEnabled } : m)),
      );
      setSelected((prev) => (prev ? { ...prev, is_comment_enabled: nextEnabled } : null));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to toggle comments");
    } finally {
      setSavingEdit(false);
    }
  };

  if (!isCloudApi) {
    return (
      <div className="p-6 rounded-2xl border bg-muted/30 text-center space-y-2">
        <ImageIcon className="h-8 w-8 mx-auto text-pink-500/70" />
        <h4 className="text-sm font-semibold">Meta Key Required for Feed Grid & Stories</h4>
        <p className="text-xs text-muted-foreground max-w-md mx-auto">
          Browsing your Posts, Reels, Stories, tagged Mentions, and editing captions requires connecting your official Meta Cloud API Key. Direct Login supports DMs & Web Companion Frame.
        </p>
      </div>
    );
  }

  const displayed = viewMode === "feed" ? media : mentions;

  return (
    <div className="space-y-5">
      {/* Header Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-xl bg-muted/60 p-1 border text-xs">
          <button
            type="button"
            onClick={() => setViewMode("feed")}
            className={`px-3 py-1.5 rounded-lg font-semibold transition-all ${
              viewMode === "feed" ? "bg-card text-foreground shadow-xs" : "text-muted-foreground"
            }`}
          >
            Profile Feed & Reels ({media.length})
          </button>
          <button
            type="button"
            onClick={() => setViewMode("mentions")}
            className={`px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition-all ${
              viewMode === "mentions" ? "bg-card text-foreground shadow-xs" : "text-muted-foreground"
            }`}
          >
            <Tag className="h-3.5 w-3.5 text-pink-500" /> Tagged & Mentions ({mentions.length})
          </button>
        </div>

        <Button
          size="sm"
          variant="outline"
          onClick={() => void loadFeed()}
          disabled={loading}
          className="text-xs gap-1.5"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh Grid
        </Button>
      </div>

      {/* Active Stories Strip */}
      {stories.length > 0 && (
        <div className="p-4 rounded-2xl border bg-card/60 space-y-2.5">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Active 24h Stories ({stories.length})
          </h4>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {stories.map((st) => {
              const thumb = st.thumbnail_url || st.media_url;
              return (
                <a
                  key={st.id}
                  href={st.media_url}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 w-24 space-y-1 group"
                >
                  <div className="h-36 w-24 rounded-xl overflow-hidden p-0.5 bg-gradient-to-tr from-yellow-500 via-pink-500 to-purple-600">
                    {thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={thumb}
                        alt="Story"
                        className="h-full w-full object-cover rounded-[10px] bg-black"
                      />
                    ) : (
                      <div className="h-full w-full rounded-[10px] bg-neutral-900 flex items-center justify-center text-white text-[10px]">
                        {st.media_type}
                      </div>
                    )}
                  </div>
                  <p className="text-[10px] text-center text-muted-foreground truncate">
                    {st.timestamp ? new Date(st.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Story"}
                  </p>
                </a>
              );
            })}
          </div>
        </div>
      )}

      {errorMsg && (
        <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-600 dark:text-rose-400">
          {errorMsg}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-pink-500" />
        </div>
      ) : displayed.length === 0 ? (
        <div className="p-8 rounded-2xl border border-dashed text-center text-xs text-muted-foreground">
          {viewMode === "feed"
            ? "No posts or reels found on this Instagram account yet."
            : "No tagged posts or mentions found yet."}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {displayed.map((item) => {
            const thumb = item.thumbnail_url || item.media_url;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => void openMediaDetail(item)}
                className="group relative aspect-square rounded-xl overflow-hidden border bg-neutral-900 text-left focus:outline-none focus:ring-2 focus:ring-pink-500"
              >
                {thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={thumb}
                    alt={item.caption || "Instagram media"}
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                ) : (
                  <div className="h-full w-full flex items-center justify-center text-neutral-500">
                    <ImageIcon className="h-8 w-8" />
                  </div>
                )}

                {/* Media Type Pill */}
                <div className="absolute top-2 right-2">
                  {item.media_type === "VIDEO" || item.media_product_type === "REELS" ? (
                    <Badge className="bg-black/70 text-white border-0 text-[10px] px-1.5 py-0.5">
                      <Film className="h-3 w-3 mr-1" /> Reel
                    </Badge>
                  ) : item.media_type === "CAROUSEL_ALBUM" ? (
                    <Badge className="bg-black/70 text-white border-0 text-[10px] px-1.5 py-0.5">
                      <Layers className="h-3 w-3 mr-1" /> Album
                    </Badge>
                  ) : null}
                </div>

                {/* Hover Metrics Overlay */}
                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-between p-3 text-white">
                  <div className="flex items-center gap-3 text-xs font-bold">
                    <span className="flex items-center gap-1">
                      <Heart className="h-3.5 w-3.5 fill-white" /> {item.like_count ?? 0}
                    </span>
                    <span className="flex items-center gap-1">
                      <MessageCircle className="h-3.5 w-3.5 fill-white" /> {item.comments_count ?? 0}
                    </span>
                  </div>
                  <p className="text-[11px] line-clamp-2 text-neutral-200">
                    {item.caption || "View details, insights & comments"}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Post Detail + Insights + Caption Edit Modal */}
      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="sm:max-w-2xl bg-card border-border">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center justify-between gap-2 text-base">
                  <span>Manage Instagram {selected.media_product_type === "REELS" ? "Reel" : "Post"}</span>
                  {selected.permalink && (
                    <a
                      href={selected.permalink}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs font-normal text-pink-500 hover:underline inline-flex items-center gap-1 mr-6"
                    >
                      Open on Instagram <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </DialogTitle>
              </DialogHeader>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="rounded-xl overflow-hidden bg-black flex items-center justify-center max-h-[320px]">
                  {selected.media_type === "VIDEO" && selected.media_url ? (
                    <video
                      src={selected.media_url}
                      controls
                      className="max-h-[320px] w-full object-contain"
                    />
                  ) : selected.thumbnail_url || selected.media_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={selected.media_url || selected.thumbnail_url}
                      alt={selected.caption || "Instagram post"}
                      className="max-h-[320px] w-full object-contain"
                    />
                  ) : null}
                </div>

                <div className="space-y-4">
                  {/* Metrics */}
                  <div className="space-y-2">
                    <h5 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                      <BarChart3 className="h-3.5 w-3.5 text-pink-500" /> Post Insights
                    </h5>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="p-2 rounded-lg bg-muted/50 border">
                        <p className="text-[10px] text-muted-foreground">Likes</p>
                        <p className="text-sm font-bold">{selected.like_count ?? 0}</p>
                      </div>
                      <div className="p-2 rounded-lg bg-muted/50 border">
                        <p className="text-[10px] text-muted-foreground">Comments</p>
                        <p className="text-sm font-bold">{selected.comments_count ?? 0}</p>
                      </div>
                      {loadingInsights ? (
                        <div className="p-2 rounded-lg bg-muted/50 border flex items-center justify-center">
                          <Loader2 className="h-4 w-4 animate-spin text-pink-500" />
                        </div>
                      ) : (
                        postInsights.slice(0, 4).map((m) => (
                          <div key={m.name} className="p-2 rounded-lg bg-muted/50 border">
                            <p className="text-[10px] text-muted-foreground capitalize truncate">
                              {m.name.replace(/_/g, " ")}
                            </p>
                            <p className="text-sm font-bold">{m.value.toLocaleString()}</p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Caption Edit */}
                  <div className="space-y-2">
                    <label className="text-xs font-semibold flex items-center gap-1.5">
                      <Edit3 className="h-3.5 w-3.5 text-purple-500" /> Edit Caption
                    </label>
                    <Textarea
                      rows={3}
                      value={editCaption}
                      onChange={(e) => setEditCaption(e.target.value)}
                      className="text-xs resize-none"
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        disabled={savingEdit}
                        onClick={() => void handleSaveCaption()}
                        className="text-xs"
                      >
                        Save Caption
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={savingEdit}
                        onClick={() => void handleToggleComments(selected)}
                        className="text-xs gap-1.5"
                      >
                        {selected.is_comment_enabled === false ? (
                          <>
                            <Unlock className="h-3.5 w-3.5 text-emerald-500" /> Enable Comments
                          </>
                        ) : (
                          <>
                            <Lock className="h-3.5 w-3.5 text-amber-500" /> Disable Comments
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>

              <DialogFooter className="gap-2">
                <Button
                  variant="outline"
                  onClick={() => setSelected(null)}
                  className="text-xs"
                >
                  Close
                </Button>
                <Button
                  onClick={() => {
                    const id = selected.id;
                    setSelected(null);
                    onSelectMediaForComments(id);
                  }}
                  className="text-xs gap-1.5 bg-gradient-to-r from-pink-600 to-purple-600 text-white"
                >
                  <MessageCircle className="h-3.5 w-3.5" />
                  Moderate Comments & Send Private DM
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

