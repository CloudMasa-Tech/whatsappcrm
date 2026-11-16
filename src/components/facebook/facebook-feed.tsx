"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ExternalLink,
  Heart,
  Image as ImageIcon,
  Loader2,
  MessageCircle,
  RefreshCw,
  Share2,
  ThumbsUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FacebookBrandIcon } from "@/components/icons/facebook";

export interface FacebookPost {
  id: string;
  message?: string | null;
  story?: string | null;
  createdTime: string;
  fullPicture?: string | null;
  permalinkUrl?: string | null;
  likesCount: number;
  commentsCount: number;
  sharesCount: number;
}

interface FacebookFeedProps {
  pageName?: string | null;
  profilePictureUrl?: string | null;
}

export function FacebookFeed({ pageName, profilePictureUrl }: FacebookFeedProps) {
  const [loading, setLoading] = useState(true);
  const [posts, setPosts] = useState<FacebookPost[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadFeed = useCallback(async () => {
    try {
      setLoading(true);
      setErrorMsg(null);
      const res = await fetch("/api/facebook/feed?limit=24", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to load Facebook feed");
      }
      setPosts(data.posts ?? []);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to load feed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/facebook/feed?limit=24", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data?.posts) {
          setPosts(data.posts);
          setErrorMsg(null);
        }
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
  }, []);

  return (
    <div className="space-y-4">
      {/* Header toolbar */}
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-semibold flex items-center gap-2">
            <FacebookBrandIcon className="h-4 w-4" /> Page Posts &amp; Feed
          </h4>
          <p className="text-xs text-muted-foreground mt-0.5">
            Recent updates published on your connected Facebook Page.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={loadFeed}
          disabled={loading}
          className="h-8 text-xs gap-1.5"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin text-blue-600" : ""}`} />
          {loading ? "Refreshing..." : "Refresh Feed"}
        </Button>
      </div>

      {loading && posts.length === 0 && (
        <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-2xl border bg-muted/20">
          <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
          <p className="text-xs text-muted-foreground">Loading Facebook Page posts...</p>
        </div>
      )}

      {errorMsg && (
        <div className="p-4 rounded-xl border border-amber-500/30 bg-amber-500/10 text-xs text-amber-700 dark:text-amber-300 flex items-center justify-between gap-3">
          <span>{errorMsg}</span>
          <Button variant="outline" size="sm" onClick={loadFeed} className="h-7 text-xs">
            Retry
          </Button>
        </div>
      )}

      {!loading && posts.length === 0 && !errorMsg && (
        <div className="p-8 text-center rounded-2xl border border-dashed bg-muted/10 space-y-2">
          <ImageIcon className="h-8 w-8 mx-auto text-muted-foreground/60" />
          <p className="text-sm font-semibold text-foreground">No Posts Found</p>
          <p className="text-xs text-muted-foreground max-w-sm mx-auto">
            You haven&apos;t published any posts yet, or the token doesn&apos;t have <code>pages_read_engagement</code> permission. Use the Studio tab above to publish your first post!
          </p>
        </div>
      )}

      {posts.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {posts.map((post) => {
            const dateStr = post.createdTime
              ? new Date(post.createdTime).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "";

            return (
              <div
                key={post.id}
                className="rounded-2xl border bg-card/80 overflow-hidden shadow-xs hover:border-blue-500/40 transition-all flex flex-col justify-between"
              >
                {/* Post author header */}
                <div className="p-3.5 flex items-center justify-between border-b border-border/50 bg-muted/20">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="h-8 w-8 rounded-full bg-blue-600/10 flex items-center justify-center text-blue-600 font-bold border border-blue-600/20 overflow-hidden shrink-0">
                      {profilePictureUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={profilePictureUrl}
                          alt={pageName || "FB"}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        (pageName || "FB").slice(0, 2).toUpperCase()
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-foreground truncate">
                        {pageName || "Facebook Page"}
                      </p>
                      <p className="text-[10px] text-muted-foreground">{dateStr}</p>
                    </div>
                  </div>

                  {post.permalinkUrl && (
                    <a
                      href={post.permalinkUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground hover:text-blue-600 p-1 rounded-md"
                      title="View on Facebook"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>

                {/* Post body */}
                <div className="p-3.5 space-y-2 flex-1">
                  {(post.message || post.story) && (
                    <p className="text-xs text-foreground leading-relaxed line-clamp-3">
                      {post.message || post.story}
                    </p>
                  )}

                  {post.fullPicture && (
                    <div className="relative aspect-video rounded-xl overflow-hidden bg-black/10 border border-border/40 mt-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={post.fullPicture}
                        alt="Facebook Post Media"
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    </div>
                  )}
                </div>

                {/* Post engagement footer */}
                <div className="px-3.5 py-2.5 border-t border-border/50 bg-muted/10 flex items-center justify-between text-[11px] text-muted-foreground font-medium">
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1 text-blue-600 dark:text-blue-400">
                      <ThumbsUp className="h-3.5 w-3.5" /> {post.likesCount}
                    </span>
                    <span className="flex items-center gap-1">
                      <MessageCircle className="h-3.5 w-3.5" /> {post.commentsCount}
                    </span>
                    <span className="flex items-center gap-1">
                      <Share2 className="h-3.5 w-3.5" /> {post.sharesCount}
                    </span>
                  </div>

                  {post.permalinkUrl && (
                    <a
                      href={post.permalinkUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] text-blue-600 hover:underline inline-flex items-center gap-1 font-semibold"
                    >
                      View Post <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

