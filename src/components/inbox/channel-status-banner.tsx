"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Loader2, Mail, QrCode, WifiOff } from "lucide-react";

import { cn } from "@/lib/utils";
import { Instagram } from "@/components/icons/instagram";
import { Facebook } from "@/components/icons/facebook";
import { useChannelStatus, type ChannelSyncState } from "@/hooks/use-channel-status";

// ============================================================
// "Is the inbox actually syncing?" — answered at the top of it.
//
// A shared inbox that has quietly stopped receiving looks identical to
// a quiet afternoon. This strip is the difference: it is driven by the
// live session row, so an unlinked phone or a lapsed pairing shows up
// here within a second of the gateway noticing.
//
// All four channels share ONE row, so a single glance answers "can I
// send and receive right now?" for every one of them. The row is tinted
// by the worst state present: anything needing attention makes the
// whole strip read as an alert rather than sitting quietly in grey.
//
// The all-healthy state renders too, deliberately, but as the quietest
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

/** Worst-wins, so one broken channel colours the whole row. */
const TONE_RANK: Record<Tone, number> = { ok: 0, info: 1, warn: 2, bad: 3 };

function worstTone(tones: Tone[]): Tone {
  return tones.reduce<Tone>(
    (worst, tone) => (TONE_RANK[tone] > TONE_RANK[worst] ? tone : worst),
    "ok",
  );
}

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

/** States with guidance worth keeping, shown as hover text. */
const HINT_STATES = new Set<ChannelSyncState>([
  "pairing",
  "disconnected",
  "logged_out",
  "banned",
  "stale",
]);

interface Readiness {
  state: "ready" | "not_configured" | "error" | "unsupported";
  detail?: string | null;
}

/** Channels whose state is configuration rather than a live session. */
const SIBLING_CHANNELS: {
  key: "instagram" | "email" | "facebook";
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  // Order matches the sidebar: WhatsApp (pushed first, above) then
  // Instagram, Facebook, Email.
  { key: "instagram", label: "Instagram", href: "/instagram", icon: Instagram },
  { key: "facebook", label: "Facebook", href: "/facebook", icon: Facebook },
  { key: "email", label: "Email", href: "/settings?tab=email", icon: Mail },
];

/** One channel's worth of the row. */
interface ChannelItem {
  key: string;
  icon: React.ComponentType<{ className?: string }> | null;
  spinning?: boolean;
  text: string;
  detail?: string | null;
  href?: string | null;
  actionLabel?: string;
  /** Fuller explanation, surfaced on hover so the row stays short. */
  hint?: string | null;
  tone: Tone;
}

export function ChannelStatusBanner({ projectId }: { projectId: string | null }) {
  const t = useTranslations("Inbox.status");
  const whatsapp = useChannelStatus(projectId);
  const [readiness, setReadiness] = useState<Record<string, Readiness> | null>(null);

  useEffect(() => {
    const currentProjectId = projectId;
    if (!currentProjectId) {
      setReadiness(null);
      return;
    }

    // `ignore` drops a stale response if the project changes or the
    // component unmounts before the fetch settles.
    let ignore = false;

    async function fetchReadiness() {
      try {
        const qs = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
        const res = await fetch(`/api/channels/readiness${qs}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!ignore) setReadiness(data);
      } catch {
        // A readiness probe failing must never break the inbox.
      }
    }

    void fetchReadiness();
    return () => {
      ignore = true;
    };
  }, [projectId]);

  if (!projectId) return null;

  const items: ChannelItem[] = [];

  // ---- WhatsApp: live session state ------------------------------
  // Skipped while loading so the row never flashes "not connected" on
  // every inbox load — that would train agents to ignore it.
  if (whatsapp.state !== "loading") {
    const { tone, icon, action } = TONE[whatsapp.state];

    if (whatsapp.state !== "connected") {
      items.push({
        key: "whatsapp",
        icon,
        spinning: whatsapp.state === "connecting",
        text: t(MESSAGE_KEY[whatsapp.state]),
        // The gateway's own words are usually the most actionable part
        // of a failure, so they are not swallowed by generic copy.
        detail: whatsapp.lastError,
        href: action ? "/whatsapp" : null,
        actionLabel: action === "pair" ? t("finishPairing") : t("connect"),
        hint: HINT_STATES.has(whatsapp.state)
          ? t(`hints.${MESSAGE_KEY[whatsapp.state]}`)
          : null,
        tone,
      });
    }
  }

  // ---- Instagram / Email / Facebook: configuration state ---------
  if (readiness) {
    for (const channel of SIBLING_CHANNELS) {
      const info = readiness[channel.key];
      const state = info?.state;
      if (state !== "not_configured" && state !== "error") continue;

      items.push({
        key: channel.key,
        icon: channel.icon,
        text:
          state === "error"
            ? `${channel.label} error`
            : `${channel.label} not configured`,
        detail: state === "error" ? info?.detail : null,
        href: channel.href,
        actionLabel: state === "error" ? "Fix" : "Set up",
        tone: state === "error" ? "bad" : "warn",
      });
    }
  }

  // Everything healthy — but say nothing until both sources have
  // actually reported, so "all good" is never a guess.
  if (items.length === 0) {
    if (whatsapp.state !== "connected" || !readiness) return null;

    return (
      <div
        className={cn(
          "flex shrink-0 items-center justify-center gap-2 border-b px-4 py-2 text-xs",
          TONE_CLASS.ok,
        )}
        role="status"
        aria-live="off"
      >
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden />
        <p>
          {t(MESSAGE_KEY.connected)}
          {whatsapp.phoneNumber ? ` · ${whatsapp.phoneNumber}` : ""}
        </p>
      </div>
    );
  }

  const tone = worstTone(items.map((i) => i.tone));

  return (
    <div
      className={cn(
        "flex shrink-0 flex-wrap items-center justify-center gap-x-5 gap-y-1.5 border-b px-4 py-2 text-xs",
        TONE_CLASS[tone],
      )}
      role="status"
      aria-live="polite"
    >
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <span
            key={item.key}
            className="inline-flex min-w-0 items-center gap-1.5"
            title={item.hint ?? undefined}
          >
            {item.spinning ? (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
            ) : Icon ? (
              <Icon className="h-3.5 w-3.5 shrink-0" />
            ) : null}

            <span className="truncate">{item.text}</span>

            {item.detail && (
              <span className="truncate opacity-80">— {item.detail}</span>
            )}

            {item.href && (
              <Link
                href={item.href}
                className="shrink-0 font-medium underline underline-offset-2"
              >
                {item.actionLabel}
              </Link>
            )}
          </span>
        );
      })}
    </div>
  );
}
