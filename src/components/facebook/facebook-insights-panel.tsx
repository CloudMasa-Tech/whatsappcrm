"use client";

import { Check, Copy, ExternalLink, Globe, Heart, ShieldCheck, ThumbsUp, Users, Zap } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FacebookBrandIcon } from "@/components/icons/facebook";

interface FacebookInsightsPanelProps {
  followersCount?: number | null;
  fanCount?: number | null;
  postsCount?: number | null;
  pageId?: string | null;
  pageName?: string | null;
  category?: string | null;
  webhookUrl?: string;
  verifyToken?: string;
}

export function FacebookInsightsPanel({
  followersCount,
  fanCount,
  postsCount,
  pageId,
  pageName,
  category,
  webhookUrl,
  verifyToken,
}: FacebookInsightsPanelProps) {
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);

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

  return (
    <div className="space-y-6">
      {/* 4 Stat Metrics Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-card border shadow-xs space-y-1">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-semibold uppercase tracking-wider">Followers</span>
            <Users className="h-4 w-4 text-blue-500" />
          </div>
          <p className="text-2xl font-bold text-foreground">
            {followersCount != null ? followersCount.toLocaleString() : "—"}
          </p>
          <p className="text-[11px] text-muted-foreground">People following this Page</p>
        </div>

        <div className="p-4 rounded-2xl bg-card border shadow-xs space-y-1">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-semibold uppercase tracking-wider">Page Likes / Fans</span>
            <ThumbsUp className="h-4 w-4 text-blue-600" />
          </div>
          <p className="text-2xl font-bold text-foreground">
            {fanCount != null ? fanCount.toLocaleString() : "—"}
          </p>
          <p className="text-[11px] text-muted-foreground">Total Page fans and likes</p>
        </div>

        <div className="p-4 rounded-2xl bg-card border shadow-xs space-y-1">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-semibold uppercase tracking-wider">Published Posts</span>
            <FacebookBrandIcon className="h-4 w-4" />
          </div>
          <p className="text-2xl font-bold text-foreground">
            {postsCount != null ? postsCount.toLocaleString() : "—"}
          </p>
          <p className="text-[11px] text-muted-foreground">Total published updates</p>
        </div>

        <div className="p-4 rounded-2xl bg-card border shadow-xs space-y-1">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-semibold uppercase tracking-wider">Page Category</span>
            <Globe className="h-4 w-4 text-indigo-500" />
          </div>
          <p className="text-sm font-bold text-foreground truncate mt-1">
            {category || "Business Page"}
          </p>
          <p className="text-[11px] text-muted-foreground truncate font-mono">
            ID: {pageId || "Auto-detected"}
          </p>
        </div>
      </div>

      {/* Meta Webhook & Platform Settings */}
      <div className="p-5 rounded-2xl bg-card border shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-sm font-semibold flex items-center gap-2">
              <Zap className="h-4 w-4 text-blue-600" /> Meta Messenger Webhook Configuration
            </h4>
            <p className="text-xs text-muted-foreground mt-0.5">
              Subscribe to <code>messages</code> and <code>messaging_postbacks</code> in Meta App Dashboard to receive Messenger chats in real time.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs gap-1.5"
            onClick={() =>
              window.open(
                "https://developers.facebook.com/apps",
                "_blank",
              )
            }
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Meta Apps Dashboard
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs pt-1">
          <div className="space-y-1.5">
            <span className="font-semibold text-muted-foreground">Callback URL:</span>
            <div className="flex items-center gap-2">
              <code className="px-3 py-2 rounded-xl bg-muted/60 border font-mono text-[11px] flex-1 truncate select-all">
                {webhookUrl || "https://your-crm.com/api/facebook/webhook"}
              </code>
              <Button
                size="sm"
                variant="outline"
                className="h-9 px-3 shrink-0"
                onClick={() => copyToClipboard(webhookUrl || "", "webhook")}
              >
                {copiedWebhook ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <span className="font-semibold text-muted-foreground">Verify Token:</span>
            <div className="flex items-center gap-2">
              <code className="px-3 py-2 rounded-xl bg-muted/60 border font-mono text-[11px] flex-1 truncate select-all">
                {verifyToken || "masacrm_fb_verify_token"}
              </code>
              <Button
                size="sm"
                variant="outline"
                className="h-9 px-3 shrink-0"
                onClick={() => copyToClipboard(verifyToken || "", "token")}
              >
                {copiedToken ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-blue-500/10 border border-blue-500/20 text-xs text-blue-700 dark:text-blue-300 space-y-1">
          <p className="font-semibold flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-blue-600" /> Recommended Facebook Page Permissions:
          </p>
          <p className="text-[11px] opacity-90 leading-relaxed">
            Ensure your token has granted: <code>pages_show_list</code>, <code>pages_read_engagement</code>, <code>pages_manage_posts</code>, and <code>pages_messaging</code>.
          </p>
        </div>
      </div>
    </div>
  );
}

