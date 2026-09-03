"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  POLL_MS,
  STALENESS_TICK_MS,
  deriveSessionStatus,
  type StoredSessionStatus,
} from "@/lib/channels/session-status";
import { createClient } from "@/lib/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================
// Is this project's WhatsApp actually syncing?
//
// A project connects through one of two transports, and "connected"
// lives in a different table for each: `whatsapp_config.status` for
// Cloud API, `whatsapp_sessions.status` for a QR-paired number. This
// hook collapses both into one answer for the UI.
//
// The QR half is LIVE. A paired phone can log out, run out of battery
// or be unlinked from the handset at any moment, and when that happens
// inbound messages simply stop — silently, from the inbox's point of
// view. Subscribing to `whatsapp_sessions` means the banner flips the
// moment the gateway notices, rather than the next time someone
// reloads the page and wonders where the last two hours went.
//
// The Cloud API half is read once: its status only changes when
// someone edits the credentials, which is a full page interaction
// anyway.
//
// RLS on `whatsapp_sessions` already limits the subscription to
// projects the viewer belongs to; the `project_id` filter narrows it
// to the one on screen so a member of several projects never receives
// a sibling project's session events.
//
// Two things `whatsapp_sessions.status` cannot tell us on its own, both
// handled below:
//
//   1. Whether the gateway is still alive. Nothing writes a status when
//      it dies (shutdownAll() leaves 'connected' on purpose; a crash
//      writes nothing at all), so 'connected' is treated as a claim
//      that expires with `heartbeat_at`. This matters doubly here: an
//      expired QR claim must not outrank a Cloud API config that is
//      genuinely working.
//   2. Whether we are still receiving events. If Realtime is not
//      subscribed — including the case where the table was never added
//      to the publication — a poll takes over.
// ============================================================

/**
 * Raw status the QR gateway writes to `whatsapp_sessions`. Aliased to
 * the shared type so the two cannot drift.
 */
export type QrSessionStatus = StoredSessionStatus;

/** What the UI actually needs to say, across both transports. */
export type ChannelSyncState =
  | "loading"
  | "connected"
  | "pairing"
  | "connecting"
  | "disconnected"
  | "logged_out"
  | "banned"
  | "error"
  /** Row says 'connected'; the gateway stopped stamping its heartbeat. */
  | "stale";

export interface ChannelStatus {
  state: ChannelSyncState;
  /** Which transport produced `state`, once one is connected. */
  channel: "qr" | "cloud_api" | null;
  /** E.164 of the linked device, QR only. */
  phoneNumber: string | null;
  /** Gateway's own message, worth surfacing verbatim on failures. */
  lastError: string | null;
}

interface SessionRow {
  status: QrSessionStatus;
  phone_number: string | null;
  last_error: string | null;
  /** Gateway liveness stamp. See @/lib/channels/session-status. */
  heartbeat_at: string | null;
}

const SESSION_TO_STATE: Record<QrSessionStatus, ChannelSyncState> = {
  connected: "connected",
  qr_pending: "pairing",
  connecting: "connecting",
  disconnected: "disconnected",
  logged_out: "logged_out",
  banned: "banned",
  error: "error",
};

const LOADING: ChannelStatus = {
  state: "loading",
  channel: null,
  phoneNumber: null,
  lastError: null,
};

const NO_PROJECT: ChannelStatus = {
  state: "loading",
  channel: null,
  phoneNumber: null,
  lastError: null,
};

/**
 * One state object, stamped with the project it describes.
 *
 * Keeping the project id alongside the data is what makes a switch
 * safe: on the way from project A to project B there is a render where
 * the id has changed but A's fetch has not returned, and separate
 * pieces of state would show A's "connected" under B's name. The
 * derivation below treats a mismatched stamp as "still loading".
 */
interface LoadedStatus {
  projectId: string;
  cloudConnected: boolean;
  session: SessionRow | null;
}

/** One read of both transports. Shared by the initial load and the poll. */
async function fetchStatus(
  supabase: SupabaseClient,
  projectId: string,
): Promise<LoadedStatus> {
  const [config, sessionRow] = await Promise.all([
    supabase
      .from("whatsapp_config")
      .select("status")
      .eq("project_id", projectId)
      .maybeSingle(),
    supabase
      .from("whatsapp_sessions")
      .select("status, phone_number, last_error, heartbeat_at")
      .eq("project_id", projectId)
      .maybeSingle(),
  ]);

  return {
    projectId,
    cloudConnected: config.data?.status === "connected",
    session: (sessionRow.data as SessionRow | null) ?? null,
  };
}

export function useChannelStatus(projectId: string | null): ChannelStatus {
  const [loaded, setLoaded] = useState<LoadedStatus | null>(null);
  /** null until the subscription resolves either way. */
  const [realtimeOk, setRealtimeOk] = useState<boolean | null>(null);
  /** Advances on its own so a lapsing heartbeat is noticed. */
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    if (!projectId) return;
    const next = await fetchStatus(createClient(), projectId);
    // Late response for a project we have since navigated away from.
    setLoaded((prev) =>
      !prev || prev.projectId === projectId || next.projectId === projectId
        ? next
        : prev,
    );
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;

    let cancelled = false;
    void (async () => {
      const next = await fetchStatus(createClient(), projectId);
      if (cancelled) return;
      setLoaded(next);
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Fallback poll while Realtime is not confirmed subscribed.
  useEffect(() => {
    if (!projectId || realtimeOk) return;
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [projectId, realtimeOk, refresh]);

  // Local clock tick so staleness surfaces with no inbound event.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), STALENESS_TICK_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!projectId) return;

    const supabase = createClient();
    const channelName = `channel-status-${projectId}-${Math.random().toString(36).slice(2, 9)}`;
    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "whatsapp_sessions",
          filter: `project_id=eq.${projectId}`,
        },
        (payload) => {
          const next =
            payload.eventType === "DELETE"
              ? null
              : (payload.new as SessionRow);
          // Drop the event if the initial fetch has not landed or has
          // already moved on: an event for a project we are no longer
          // showing must not resurrect its status.
          setLoaded((prev) =>
            prev && prev.projectId === projectId
              ? { ...prev, session: next }
              : prev,
          );
        },
      )
      .subscribe((status) => {
        // Anything but SUBSCRIBED means rows are not arriving — an
        // unpublished table reads as CHANNEL_ERROR here. Hand over to
        // the poll above rather than trusting the page-load snapshot.
        setRealtimeOk(status === "SUBSCRIBED");
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [projectId]);

  return useMemo<ChannelStatus>(() => {
    if (!projectId) return NO_PROJECT;
    if (!loaded || loaded.projectId !== projectId) return LOADING;

    const { cloudConnected, session } = loaded;
    // Derived, not the raw column: an expired 'connected' claim must not
    // win the precedence check below over a working Cloud API config.
    const qrStatus = deriveSessionStatus(
      session?.status,
      session?.heartbeat_at,
      now,
    );

    // A live QR session wins: it is the transport messages are actually
    // arriving on, and its phone number is the useful thing to show.
    if (qrStatus === "connected") {
      return {
        state: "connected",
        channel: "qr",
        // Only a non-null row can derive to 'connected'; the `?.` is for
        // the compiler, which cannot see that through the helper.
        phoneNumber: session?.phone_number ?? null,
        lastError: null,
      };
    }

    if (cloudConnected) {
      return {
        state: "connected",
        channel: "cloud_api",
        phoneNumber: null,
        lastError: null,
      };
    }

    // Not connected either way. If a QR session row exists it explains
    // WHY (mid-pairing, logged out, banned…), which is more useful than
    // a flat "not connected".
    if (session) {
      return {
        state:
          qrStatus === "stale"
            ? "stale"
            : (SESSION_TO_STATE[session.status] ?? "error"),
        channel: "qr",
        phoneNumber: session.phone_number,
        lastError: session.last_error,
      };
    }

    return {
      state: "disconnected",
      channel: null,
      phoneNumber: null,
      lastError: null,
    };
  }, [projectId, loaded, now]);
}
