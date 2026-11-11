"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Bot,
  Eye,
  EyeOff,
  Loader2,
  MessageCircle,
  RefreshCw,
  Send,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import type { InstagramCommentItem, InstagramMediaItem } from "@/lib/instagram/types";

interface InstagramCommentsPanelProps {
  isCloudApi: boolean;
  initialMediaId?: string | null;
  autoReplyEnabled?: boolean;
  autoReplyKeyword?: string;
  autoReplyMessage?: string;
  autoDmMessage?: string;
  onConfigUpdated?: () => void;
}

export function InstagramCommentsPanel({
  isCloudApi,
  initialMediaId,
  autoReplyEnabled = false,
  autoReplyKeyword = "",
  autoReplyMessage = "",
  autoDmMessage = "",
  onConfigUpdated,
}: InstagramCommentsPanelProps) {
  const [mediaList, setMediaList] = useState<InstagramMediaItem[]>([]);
  const [userSelectedMediaId, setUserSelectedMediaId] = useState<string>("");
  const [comments, setComments] = useState<InstagramCommentItem[]>([]);
  const [loadingMedia, setLoadingMedia] = useState(false);
  const [loadingComments, setLoadingComments] = useState(false);
  const [actingOn, setActingOn] = useState<string | null>(null);

  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [dmDrafts, setDmDrafts] = useState<Record<string, string>>({});
  const [activeInputFor, setActiveInputFor] = useState<{
    id: string;
    mode: "reply" | "dm";
  } | null>(null);

  // Auto-responder rules state (initialized from props; parent refreshes after save)
  const [ruleEnabled, setRuleEnabled] = useState(autoReplyEnabled);
  const [ruleKeyword, setRuleKeyword] = useState(autoReplyKeyword);
  const [ruleReplyMsg, setRuleReplyMsg] = useState(autoReplyMessage);
  const [ruleDmMsg, setRuleDmMsg] = useState(autoDmMessage);
  const [savingRules, setSavingRules] = useState(false);

  const selectedMediaId = userSelectedMediaId || initialMediaId || mediaList[0]?.id || "";

  const loadComments = useCallback(async (mediaId: string) => {
    if (!isCloudApi || !mediaId) return;
    try {
      setLoadingComments(true);
      const res = await fetch(
        `/api/instagram/comments?mediaId=${encodeURIComponent(mediaId)}`,
        { cache: "no-store" },
      );
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to load comments");
      }
      setComments(data.comments ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to fetch comments");
      setComments([]);
    } finally {
      setLoadingComments(false);
    }
  }, [isCloudApi]);

  useEffect(() => {
    if (!isCloudApi) return;
    let cancelled = false;
    fetch("/api/instagram/media?include=none&limit=20", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.media) {
          setMediaList(data.media as InstagramMediaItem[]);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingMedia(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isCloudApi]);

  useEffect(() => {
    if (!isCloudApi || !selectedMediaId) return;
    let cancelled = false;
    fetch(`/api/instagram/comments?mediaId=${encodeURIComponent(selectedMediaId)}`, {
      cache: "no-store",
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok || data.error) {
          throw new Error(data.error || "Failed to load comments");
        }
        return data;
      })
      .then((data) => {
        if (!cancelled) setComments(data.comments ?? []);
      })
      .catch((err) => {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : "Failed to fetch comments");
          setComments([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingComments(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isCloudApi, selectedMediaId]);

  const performAction = async (
    action: "reply" | "hide" | "unhide" | "delete" | "private_dm",
    commentId: string,
    text?: string,
  ) => {
    try {
      setActingOn(commentId);
      const res = await fetch("/api/instagram/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, commentId, text }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Action failed");

      if (action === "reply") {
        toast.success("Public reply posted!");
        setReplyDrafts((prev) => ({ ...prev, [commentId]: "" }));
        setActiveInputFor(null);
      } else if (action === "private_dm") {
        toast.success("Private DM sent directly to commenter!");
        setDmDrafts((prev) => ({ ...prev, [commentId]: "" }));
        setActiveInputFor(null);
      } else if (action === "hide" || action === "unhide") {
        toast.success(action === "hide" ? "Comment hidden" : "Comment unhidden");
      } else if (action === "delete") {
        toast.success("Comment deleted");
      }

      if (selectedMediaId) {
        await loadComments(selectedMediaId);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to execute comment action");
    } finally {
      setActingOn(null);
    }
  };

  const handleSaveRules = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSavingRules(true);
      const res = await fetch("/api/instagram/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          comment_auto_reply_enabled: ruleEnabled,
          comment_auto_reply_keyword: ruleKeyword,
          comment_auto_reply_message: ruleReplyMsg,
          comment_auto_dm_message: ruleDmMsg,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Failed to save rules");
      toast.success("Comment Auto-Reply & Comment-to-DM rules saved!");
      onConfigUpdated?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save rules");
    } finally {
      setSavingRules(false);
    }
  };

  if (!isCloudApi) {
    return (
      <div className="p-6 rounded-2xl border bg-muted/30 text-center space-y-2">
        <MessageCircle className="h-8 w-8 mx-auto text-pink-500/70" />
        <h4 className="text-sm font-semibold">Meta Key Required for Comment Moderation</h4>
        <p className="text-xs text-muted-foreground max-w-md mx-auto">
          Replying to comments, hiding/deleting spam, and sending automatic Private Comment-to-DM messages require a Meta Cloud API key.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Left: Post selector + live comments list (7 cols) */}
      <div className="lg:col-span-7 space-y-4 rounded-2xl border bg-card/60 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="text-sm font-bold flex items-center gap-2">
              <MessageCircle className="h-4 w-4 text-pink-500" /> Post & Reel Comments
            </h4>
            <p className="text-xs text-muted-foreground">
              Reply publicly, hide spam, delete comments, or initiate a Private DM directly from any comment.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => selectedMediaId && void loadComments(selectedMediaId)}
            disabled={loadingComments || !selectedMediaId}
            className="text-xs gap-1"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loadingComments ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {/* Post Selector */}
        <div className="space-y-1.5">
          <Label htmlFor="comment-post-select" className="text-xs font-semibold">
            Select Post or Reel
          </Label>
          <select
            id="comment-post-select"
            value={selectedMediaId}
            onChange={(e) => setUserSelectedMediaId(e.target.value)}
            disabled={loadingMedia}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground"
          >
            {mediaList.length === 0 ? (
              <option value="">No posts found yet</option>
            ) : (
              mediaList.map((m) => (
                <option key={m.id} value={m.id}>
                  [{m.media_product_type || m.media_type}]{" "}
                  {(m.caption || "Untitled post").slice(0, 60)} ({m.comments_count ?? 0} comments)
                </option>
              ))
            )}
          </select>
        </div>

        {/* Comments List */}
        {loadingComments ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-pink-500" />
          </div>
        ) : comments.length === 0 ? (
          <div className="p-6 rounded-xl border border-dashed text-center text-xs text-muted-foreground">
            No comments found on this post yet.
          </div>
        ) : (
          <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
            {comments.map((c) => (
              <div
                key={c.id}
                className={`p-3.5 rounded-xl border space-y-2 ${
                  c.hidden ? "bg-muted/30 opacity-75" : "bg-background"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-pink-600 dark:text-pink-400">
                        @{c.username || c.from?.username || "instagram_user"}
                      </span>
                      {c.hidden && (
                        <Badge variant="outline" className="text-[10px]">
                          Hidden
                        </Badge>
                      )}
                      {c.timestamp && (
                        <span className="text-[10px] text-muted-foreground">
                          {new Date(c.timestamp).toLocaleString()}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-foreground mt-1 whitespace-pre-wrap">{c.text}</p>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={actingOn === c.id}
                      onClick={() =>
                        setActiveInputFor(
                          activeInputFor?.id === c.id && activeInputFor.mode === "reply"
                            ? null
                            : { id: c.id, mode: "reply" },
                        )
                      }
                      className="h-7 px-2 text-[11px]"
                      title="Public Reply"
                    >
                      Reply
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={actingOn === c.id}
                      onClick={() =>
                        setActiveInputFor(
                          activeInputFor?.id === c.id && activeInputFor.mode === "dm"
                            ? null
                            : { id: c.id, mode: "dm" },
                        )
                      }
                      className="h-7 px-2 text-[11px] text-purple-600 dark:text-purple-400"
                      title="Send Private DM to Commenter"
                    >
                      DM
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      disabled={actingOn === c.id}
                      onClick={() =>
                        void performAction(c.hidden ? "unhide" : "hide", c.id)
                      }
                      className="h-7 w-7 text-muted-foreground"
                      title={c.hidden ? "Unhide Comment" : "Hide Comment"}
                    >
                      {c.hidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      disabled={actingOn === c.id}
                      onClick={() => void performAction("delete", c.id)}
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      title="Delete Comment"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                {/* Inline Reply or Private DM box */}
                {activeInputFor?.id === c.id && activeInputFor.mode === "reply" && (
                  <div className="flex gap-2 pt-1">
                    <Input
                      placeholder={`Reply publicly to @${c.username || "user"}...`}
                      value={replyDrafts[c.id] || ""}
                      onChange={(e) =>
                        setReplyDrafts((prev) => ({ ...prev, [c.id]: e.target.value }))
                      }
                      className="h-8 text-xs"
                    />
                    <Button
                      size="sm"
                      disabled={actingOn === c.id || !(replyDrafts[c.id] || "").trim()}
                      onClick={() =>
                        void performAction("reply", c.id, replyDrafts[c.id])
                      }
                      className="h-8 text-xs shrink-0"
                    >
                      Post Reply
                    </Button>
                  </div>
                )}

                {activeInputFor?.id === c.id && activeInputFor.mode === "dm" && (
                  <div className="flex gap-2 pt-1">
                    <Input
                      placeholder={`Send private DM to @${c.username || "user"}...`}
                      value={dmDrafts[c.id] || ""}
                      onChange={(e) =>
                        setDmDrafts((prev) => ({ ...prev, [c.id]: e.target.value }))
                      }
                      className="h-8 text-xs"
                    />
                    <Button
                      size="sm"
                      disabled={actingOn === c.id || !(dmDrafts[c.id] || "").trim()}
                      onClick={() =>
                        void performAction("private_dm", c.id, dmDrafts[c.id])
                      }
                      className="h-8 text-xs shrink-0 bg-gradient-to-r from-pink-600 to-purple-600 text-white"
                    >
                      <Send className="h-3 w-3 mr-1" /> Send DM
                    </Button>
                  </div>
                )}

                {/* Existing Replies */}
                {c.replies && c.replies.length > 0 && (
                  <div className="pl-4 border-l-2 border-border space-y-1.5 mt-2">
                    {c.replies.map((r) => (
                      <div key={r.id} className="text-xs">
                        <span className="font-semibold text-foreground">
                          @{r.username || r.from?.username || "reply"}
                        </span>{" "}
                        <span className="text-muted-foreground">{r.text}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Right: Automatic Comment Auto-Reply & Comment-to-DM Webhook Rules (5 cols) */}
      <div className="lg:col-span-5 rounded-2xl border bg-card/60 p-5 space-y-4">
        <div>
          <h4 className="text-sm font-bold flex items-center gap-2">
            <Bot className="h-4 w-4 text-purple-500" /> Comment Auto-Reply & Comment-to-DM
          </h4>
          <p className="text-xs text-muted-foreground mt-0.5">
            Automatically reply publicly and/or DM anyone who comments matching keywords on your Reels or Posts (via Meta `comments` webhook).
          </p>
        </div>

        <form onSubmit={handleSaveRules} className="space-y-3.5">
          <label className="flex items-center gap-2.5 text-xs font-semibold cursor-pointer p-2.5 rounded-lg bg-muted/40 border">
            <input
              type="checkbox"
              checked={ruleEnabled}
              onChange={(e) => setRuleEnabled(e.target.checked)}
              className="h-4 w-4 rounded text-pink-600"
            />
            <span>Enable Automated Comment Responder</span>
          </label>

          <div className="space-y-1">
            <Label htmlFor="rule-kw" className="text-xs">
              Trigger Keywords (comma-separated, blank or * for all)
            </Label>
            <Input
              id="rule-kw"
              placeholder="price, link, demo, info"
              value={ruleKeyword}
              onChange={(e) => setRuleKeyword(e.target.value)}
              className="text-xs"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="rule-reply" className="text-xs">
              Auto Public Comment Reply (optional)
            </Label>
            <Textarea
              id="rule-reply"
              rows={2}
              placeholder="Sent you the details in DM! 📩"
              value={ruleReplyMsg}
              onChange={(e) => setRuleReplyMsg(e.target.value)}
              className="text-xs resize-none"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="rule-dm" className="text-xs">
              Auto Private DM Message (Comment-to-DM, optional)
            </Label>
            <Textarea
              id="rule-dm"
              rows={3}
              placeholder="Hey! Thanks for commenting — here is the link you asked for..."
              value={ruleDmMsg}
              onChange={(e) => setRuleDmMsg(e.target.value)}
              className="text-xs resize-none"
            />
          </div>

          <Button
            type="submit"
            disabled={savingRules}
            className="w-full text-xs bg-gradient-to-r from-pink-600 to-purple-600 text-white"
          >
            {savingRules ? "Saving Rules..." : "Save Comment Automation"}
          </Button>
        </form>
      </div>
    </div>
  );
}

