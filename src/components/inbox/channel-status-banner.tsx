"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { AlertTriangle, Loader2, QrCode, WifiOff } from "lucide-react";

import { cn } from "@/lib/utils";
import { useChannelStatus, type ChannelSyncState } from "@/hooks/use-channel-status";

// ============================================================
// "Is the inbox actually syncing?" — answered at the top of it.
//
// A shared inbox that has quietly stopped receiving looks identical to
// a quiet afternoon. This strip is the difference: it is driven by the
// live session row, so an unlinked phone or a lapsed pairing shows up
// here within a second of the gateway noticing.
//
// The connected state renders too, deliberately, but as the quietest
// thing on the page — one line, one dot. Agents asked to trust that
// messages are arriving need something to point at when they are.
// ============================================================

type Tone = "ok" | "warn" | "bad" | "info";

const TONE: Record<
  ChannelSyncState,
  { tone: Tone; icon: typeof WifiOff | null; action: "connect" | "pair" | null }
> = {
  loading: { tone: "info", icon: null, action: null },
  connected: { tone: "ok", icon: null, action: null },
  pairing: { tone: "warn", icon: QrCode, action: "pair" },
  connecting: { tone: "info", icon: null, action: null },
  disconnected: { tone: "warn", icon: WifiOff, action: "connect" },
  logged_out: { tone: "warn", icon: WifiOff, action: "connect" },
  banned: { tone: "bad", icon: AlertTriangle, action: null },
  error: { tone: "bad", icon: AlertTriangle, action: "connect" },
  // 'bad', not 'warn': inbound has silently stopped, which is the exact
  // failure this strip exists to catch. The action still points at
  // /whatsapp, where Reconnect lives — no re-scan is needed.
  stale: { tone: "bad", icon: WifiOff, action: "connect" },
};

const TONE_CLASS: Record<Tone, string> = {
  ok: "border-emerald-500/20 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400",
  warn: "border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  bad: "border-destructive/30 bg-destructive/10 text-destructive",
  info: "border-border bg-muted/40 text-muted-foreground",
};

const MESSAGE_KEY: Record<ChannelSyncState, string> = {
  loading: "checking",
  connected: "synced",
  pairing: "pairing",
  connecting: "connecting",
  disconnected: "disconnected",
  logged_out: "loggedOut",
  banned: "banned",
  error: "error",
  stale: "stale",
};

export function ChannelStatusBanner({ projectId }: { projectId: string | null }) {
  const t = useTranslations("Inbox.status");
  const status = useChannelStatus(projectId);

  // Nothing to say before the first read resolves — a flash of "not
  // connected" on every inbox load would train agents to ignore it.
  if (status.state === "loading") return null;

  const { tone, icon: Icon, action } = TONE[status.state];

  return (
    <div
      className={cn(
        "flex shrink-0 flex-wrap items-center justify-center gap-x-2 gap-y-1 border-b px-4 py-2 text-xs",
        TONE_CLASS[tone],
      )}
      // Only interrupt a screen reader for states that need action;
      // "synced" is ambient information.
      role="status"
      aria-live={status.state === "connected" ? "off" : "polite"}
    >
      {status.state === "connected" ? (
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-current"
          aria-hidden
        />
      ) : status.state === "connecting" ? (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
      ) : Icon ? (
        <Icon className="h-3.5 w-3.5 shrink-0" />
      ) : null}

      <p>
        {t(MESSAGE_KEY[status.state])}
        {status.state === "connected" && status.phoneNumber
          ? ` · ${status.phoneNumber}`
          : ""}
      </p>

      {/* The gateway's own words. Usually the most actionable part of a
          failure, so it is not swallowed in favour of generic copy. */}
      {status.lastError && status.state !== "connected" && (
        <span className="opacity-80">— {status.lastError}</span>
      )}

      {action && (
        <Link href="/whatsapp" className="font-medium underline underline-offset-2">
          {action === "pair" ? t("finishPairing") : t("connect")}
        </Link>
      )}
    </div>
  );
}
