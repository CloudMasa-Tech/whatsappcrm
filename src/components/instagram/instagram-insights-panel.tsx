"use client";

import { useCallback, useEffect, useState } from "react";
import { BarChart3, Eye, Heart, Loader2, RefreshCw, ShieldCheck, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { InstagramInsightMetric } from "@/lib/instagram/types";

interface InstagramInsightsPanelProps {
  isCloudApi: boolean;
  followersCount?: number | null;
  followingCount?: number | null;
  postsCount?: number | null;
  grantedScopes?: string[];
  tokenType?: string | null;
}

export function InstagramInsightsPanel({
  isCloudApi,
  followersCount,
  followingCount,
  postsCount,
  grantedScopes = [],
  tokenType,
}: InstagramInsightsPanelProps) {
  const [period, setPeriod] = useState<"day" | "week" | "days_28">("days_28");
  const [loading, setLoading] = useState(isCloudApi);
  const [metrics, setMetrics] = useState<InstagramInsightMetric[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadInsights = useCallback(async () => {
    if (!isCloudApi) return;
    try {
      setLoading(true);
      setErrorMsg(null);
      const res = await fetch(`/api/instagram/insights?period=${period}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to fetch Instagram Insights");
      }
      setMetrics(data.metrics ?? []);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to load insights");
    } finally {
      setLoading(false);
    }
  }, [isCloudApi, period]);

  useEffect(() => {
    if (!isCloudApi) return;
    let cancelled = false;
    fetch(`/api/instagram/insights?period=${period}`, { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok || data.error) {
          throw new Error(data.error || "Failed to fetch Instagram Insights");
        }
        return data;
      })
      .then((data) => {
        if (!cancelled) {
          setErrorMsg(null);
          setMetrics(data.metrics ?? []);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setErrorMsg(err instanceof Error ? err.message : "Failed to load insights");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isCloudApi, period]);

  if (!isCloudApi) {
    return (
      <div className="p-6 rounded-2xl border bg-muted/30 text-center space-y-2">
        <BarChart3 className="h-8 w-8 mx-auto text-pink-500/70" />
        <h4 className="text-sm font-semibold">Meta Key Required for Insights</h4>
        <p className="text-xs text-muted-foreground max-w-md mx-auto">
          Account Reach, Views, Profile Visits, and Engagement Analytics require a Meta Cloud API key with <code>instagram_manage_insights</code> permission.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-xl bg-muted/60 p-1 border text-xs">
          {(
            [
              { id: "day", label: "Last 24h" },
              { id: "week", label: "Last 7 Days" },
              { id: "days_28", label: "Last 28 Days" },
            ] as const
          ).map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPeriod(p.id)}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-all ${
                period === p.id ? "bg-card text-foreground shadow-xs" : "text-muted-foreground"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <Button
          size="sm"
          variant="outline"
          onClick={() => void loadInsights()}
          disabled={loading}
          className="text-xs gap-1.5"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh Insights
        </Button>
      </div>

      {/* Audience Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 rounded-2xl border bg-card/60 flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-pink-500/10 flex items-center justify-center text-pink-500">
            <Users className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Followers</p>
            <p className="text-xl font-bold">
              {followersCount !== null && followersCount !== undefined ? followersCount.toLocaleString() : "—"}
            </p>
          </div>
        </div>
        <div className="p-4 rounded-2xl border bg-card/60 flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-purple-500/10 flex items-center justify-center text-purple-500">
            <Heart className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Following</p>
            <p className="text-xl font-bold">
              {followingCount !== null && followingCount !== undefined ? followingCount.toLocaleString() : "—"}
            </p>
          </div>
        </div>
        <div className="p-4 rounded-2xl border bg-card/60 flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-indigo-500/10 flex items-center justify-center text-indigo-500">
            <Eye className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Total Media</p>
            <p className="text-xl font-bold">
              {postsCount !== null && postsCount !== undefined ? postsCount.toLocaleString() : "—"}
            </p>
          </div>
        </div>
      </div>

      {errorMsg && (
        <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-700 dark:text-amber-400">
          {errorMsg}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-pink-500" />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {metrics.length === 0 ? (
            <div className="col-span-full p-6 rounded-2xl border border-dashed text-center text-xs text-muted-foreground">
              No insight metrics returned for this window (Meta requires a Professional account with{" "}
              <code>instagram_manage_insights</code> permission).
            </div>
          ) : (
            metrics.map((m) => (
              <div key={m.name} className="p-4 rounded-2xl border bg-card space-y-1">
                <p className="text-xs font-medium text-muted-foreground capitalize">
                  {m.title || m.name.replace(/_/g, " ")}
                </p>
                <p className="text-2xl font-bold text-foreground">{m.value.toLocaleString()}</p>
                {m.description && (
                  <p className="text-[11px] text-muted-foreground line-clamp-2">{m.description}</p>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* Token Diagnostics */}
      <div className="p-4 rounded-2xl border bg-muted/30 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-emerald-500" /> Connected Meta Token Capabilities
          </span>
          <Badge variant="outline" className="text-[10px]">
            {tokenType === "instagram_login" ? "Instagram Login API (IGA)" : "Facebook Page API (EAAB)"}
          </Badge>
        </div>
        {grantedScopes.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {grantedScopes.map((scope) => (
              <Badge key={scope} variant="secondary" className="text-[10px] font-mono">
                {scope}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            Using Page or Instagram Login access token. Ensure{" "}
            <code>instagram_basic</code>, <code>instagram_manage_messages</code>,{" "}
            <code>instagram_content_publish</code>, <code>instagram_manage_comments</code>, and{" "}
            <code>instagram_manage_insights</code> are granted in your Meta App.
          </p>
        )}
      </div>
    </div>
  );
}

