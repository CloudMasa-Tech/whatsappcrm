"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  QrCode,
  RefreshCw,
  Smartphone,
  Unplug,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  PAIRING_POLL_MS,
  PAIRING_STUCK_AFTER_MS,
  PAIRING_WINDOW_MS,
  POLL_MS,
  STALENESS_TICK_MS,
  STALE_AFTER_MS,
  deriveSessionStatus,
  isPairingStatus,
  isRotatingQr,
  type DisplaySessionStatus,
  type StoredSessionStatus,
} from "@/lib/channels/session-status";
import { createClient } from "@/lib/supabase/client";

// ============================================================
// QR pairing.
//
// The QR never comes back in an HTTP response. The gateway writes it
// into `whatsapp_sessions` the moment WhatsApp issues one, and this
// component watches that row over Supabase Realtime. Two reasons that
// is the right shape:
//
//   1. WhatsApp rotates the QR roughly every 20 seconds. A
//      request/response would show a code that is already stale.
//   2. The browser never needs to reach the gateway, so the gateway
//      can sit on a private network with no CORS and no second auth
//      surface facing the internet.
//
// RLS on whatsapp_sessions restricts the subscription to projects the
// viewer belongs to, and the filter below narrows it to this one.
//
// Realtime is the fast path, NEVER the only path. Three ways it fails,
// and the third is why the QR could go missing entirely:
//
//   1. The table may not be published. Migration 044 adds
//      whatsapp_sessions to `supabase_realtime` inside a block that
//      DOWNGRADES a privilege error to a warning (deliberately — an
//      abort would roll back the whole migration), so a SQL-editor run
//      by a non-owner leaves Realtime off and the migration green.
//      Migration 051 repairs that, but a deployment that has not run it
//      still has to work.
//   2. The socket can drop or the subscription can error at any time.
//   3. **An unpublished table still reports SUBSCRIBED.** `subscribe()`
//      resolves against the Realtime server, which accepts the
//      subscription whether or not the WAL will ever carry a row for
//      that table. So `realtimeOk` is NOT evidence that events are
//      arriving, and a poll gated behind `!realtimeOk` never ran: the
//      screen sat on "Contacting WhatsApp…" forever and no QR appeared.
//
// So there are two polls, and the one that matters does not consult
// `realtimeOk` at all:
//
//   - a PAIRING poll (PAIRING_POLL_MS) that runs unconditionally while a
//     pairing is in flight, because that is when a missing update is
//     indistinguishable from a broken feature;
//   - a slow fallback poll (POLL_MS) while the subscription is not
//     confirmed, to keep a settled status honest.
//
// The pairing window is bounded so a dead gateway cannot leave a
// forgotten tab polling forever — see PAIRING_WINDOW_MS.
// ============================================================

interface SessionRow {
  project_id: string;
  status: StoredSessionStatus;
  qr_code: string | null;
  qr_expires_at: string | null;
  phone_number: string | null;
  display_name: string | null;
  last_connected_at: string | null;
  last_error: string | null;
  /** Gateway liveness stamp. See @/lib/channels/session-status. */
  heartbeat_at: string | null;
}

// POLL_MS and STALENESS_TICK_MS are shared with useChannelStatus — see
// @/lib/channels/session-status.

interface QrPairingProps {
  projectId: string;
  projectName: string;
  /** Admins/agents may pair; everyone else sees status only. */
  canManage: boolean;
  /** Whether the user has permission to disconnect the active session (false for customer role). */
  canDisconnect?: boolean;
}

const STATUS_COPY: Record<
  DisplaySessionStatus,
  { label: string; tone: string }
> = {
  connected: { label: "Connected", tone: "text-emerald-600 dark:text-emerald-400" },
  qr_pending: { label: "Waiting for scan", tone: "text-amber-600 dark:text-amber-400" },
  connecting: { label: "Connecting…", tone: "text-muted-foreground" },
  disconnected: { label: "Not connected", tone: "text-muted-foreground" },
  logged_out: { label: "Logged out", tone: "text-destructive" },
  banned: { label: "Blocked by WhatsApp", tone: "text-destructive" },
  error: { label: "Error", tone: "text-destructive" },
  // Distinct from "Not connected": the credentials are probably still
  // good and no re-scan is needed — the gateway process is what stopped
  // answering. Saying "Not connected" would send an admin to re-pair a
  // number that only needs its gateway restarted.
  stale: {
    label: "Connection lost — gateway not responding",
    tone: "text-destructive",
  },
};

export function QrPairing({
  projectId,
  projectName,
  canManage,
  canDisconnect = true,
}: QrPairingProps) {
  const [session, setSession] = useState<SessionRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  /** null until the subscription resolves either way. */
  const [realtimeOk, setRealtimeOk] = useState<boolean | null>(null);
  /** Advances on its own so heartbeat staleness is re-derived over time. */
  const [now, setNow] = useState(() => Date.now());
  /**
   * False when the deployment has no gateway wired up at all. Reported
   * by the GET route; worth saying out loud, because without it the
   * screen just never produces a code and looks broken rather than
   * unconfigured.
   */
  const [gatewayConfigured, setGatewayConfigured] = useState(true);
  /**
   * When the current wait began — set by Connect, restarted by every
   * live QR that lands, cleared once paired. Drives the stuck warning.
   */
  const [pairingSince, setPairingSince] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/whatsapp/qr?project_id=${encodeURIComponent(projectId)}`,
        { cache: "no-store" },
      );
      if (!response.ok) return;
      const data = await response.json();
      const row = (data.session ?? null) as SessionRow | null;
      setSession(row);
      setGatewayConfigured(data.gateway_configured !== false);

      // Keep the pairing window in step with what the row actually says.
      // This is also what makes a page reload mid-pairing resume polling
      // instead of freezing on whatever it loaded.
      const at = Date.now();
      if (row?.status === "connected") {
        // Paired. Nothing left to wait for.
        setPairingSince(null);
      } else if (isRotatingQr(row?.status, row?.qr_expires_at, at)) {
        // Real progress: a code the gateway is still refreshing. Restart
        // both clocks so the window outlives a slow scan and the stuck
        // warning stays away.
        setPairingSince(at);
      } else if (isPairingStatus(row?.status)) {
        // Mid-pairing, but nothing new — open the window if it is shut,
        // without resetting a stuck clock that is already running.
        setPairingSince((prev) => prev ?? at);
      }
      // Deliberately no `else`: a row still reading 'disconnected' right
      // after Connect must not slam the window shut on the reply to our
      // own first refresh.
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Live updates. Filtered server-side by project_id so a member of
  // several projects never receives another project's QR.
  useEffect(() => {
    const supabase = createClient();
    const channelName = `whatsapp-session-${projectId}-${Math.random().toString(36).slice(2, 9)}`;
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
          if (payload.eventType === "DELETE") {
            setSession(null);
            return;
          }
          setSession(payload.new as SessionRow);
        },
      )
      .subscribe((status) => {
        // SUBSCRIBED is necessary for rows to arrive, but NOT
        // sufficient: Realtime accepts a subscription to a table that
        // is not in the publication, then delivers nothing. TIMED_OUT /
        // CLOSED / CHANNEL_ERROR are a dropped or rejected socket.
        //
        // So this only decides whether the SLOW fallback poll runs. The
        // pairing poll ignores it entirely — that is the difference
        // between a QR that shows up and one that never does.
        setRealtimeOk(status === "SUBSCRIBED");
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [projectId]);

  // The pairing window, derived rather than stored.
  //
  // Opened by Connect and by finding a transient status on load,
  // extended by every live QR that lands (see `load`), and closed once
  // it ages out — so a gateway that died mid-connect cannot leave a
  // background tab polling for the rest of the day.
  //
  // It rides the `now` tick below rather than its own timer, which
  // means it shuts up to STALENESS_TICK_MS late. That is irrelevant at
  // a three-minute scale, and it keeps this a pure derivation instead
  // of a second piece of state to hold in step.
  //
  // `pairingSince` is deliberately NOT cleared when the window shuts:
  // the stuck warning needs to know how long the wait has really been,
  // and "Check again" reopens the window by restamping it.
  const pairingWindowOpen =
    pairingSince !== null && now - pairingSince < PAIRING_WINDOW_MS;

  // Pairing poll — deliberately NOT gated on `realtimeOk`.
  //
  // This is the fix for a QR that never arrives: a subscription to an
  // unpublished table reports SUBSCRIBED and then delivers nothing, so
  // trusting `realtimeOk` here is what left this screen empty. While a
  // pairing is in flight we re-read the row on our own regardless, and
  // the GET route returns `qr_code` in full — Realtime only ever makes
  // it arrive sooner.
  useEffect(() => {
    if (!pairingWindowOpen) return;
    const id = setInterval(() => void load(), PAIRING_POLL_MS);
    return () => clearInterval(id);
  }, [pairingWindowOpen, load]);

  // Slow fallback poll, for the settled states. Runs until Realtime
  // confirms it is subscribed, and resumes if it ever stops being.
  // Without this, a deployment whose whatsapp_sessions table never made
  // it into the `supabase_realtime` publication shows the state from
  // page load forever — including "Connected" for a session that has
  // since died. Stands down while the pairing poll has it covered.
  useEffect(() => {
    if (realtimeOk || pairingWindowOpen) return;
    const id = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(id);
  }, [realtimeOk, pairingWindowOpen, load]);

  // Local clock tick, so a heartbeat going stale is noticed without any
  // inbound event. Cheap: it only re-derives one status string.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), STALENESS_TICK_MS);
    return () => clearInterval(id);
  }, []);

  async function connect() {
    setBusy(true);
    try {
      const response = await fetch("/api/whatsapp/qr", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ project_id: projectId }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        toast.error(data.error ?? "Could not start pairing");
        return;
      }
      // Open the pairing window and read the row straight back. Without
      // this refresh nothing re-read the session at all when Realtime
      // was silent — the whole reason a QR could never turn up.
      setPairingSince(Date.now());
      void load();
      toast.success("Pairing started — the QR code will appear shortly.");
    } catch {
      toast.error("Could not reach the server");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (
      !window.confirm(
        `Disconnect WhatsApp from "${projectName}"? The saved session is deleted, and reconnecting means scanning a new QR code.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(
        `/api/whatsapp/qr?project_id=${encodeURIComponent(projectId)}`,
        { method: "DELETE" },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        toast.error(data.error ?? "Could not disconnect");
        return;
      }
      toast.success("Disconnected");
      setPairingSince(null);
      void load();
    } catch {
      toast.error("Could not reach the server");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading session…
      </div>
    );
  }

  // Derived, not read straight off the row: a 'connected' row whose
  // heartbeat has lapsed means the gateway is gone, and `status` alone
  // cannot tell us that.
  const status = deriveSessionStatus(session?.status, session?.heartbeat_at, now);
  const copy = STATUS_COPY[status];
  const showQr = status === "qr_pending" && session?.qr_code;

  // Waiting on 'connecting' with no code for far longer than the gateway
  // takes to issue one. Every cause is server-side and invisible to the
  // browser — an unreachable gateway, an incomplete gateway environment,
  // or a `whatsapp_sessions` write that is failing — so say so instead
  // of spinning indefinitely.
  const stuck =
    !showQr &&
    status === "connecting" &&
    pairingSince !== null &&
    now - pairingSince > PAIRING_STUCK_AFTER_MS;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {status === "connected" ? (
            <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
          ) : status === "logged_out" ||
            status === "banned" ||
            status === "error" ||
            status === "stale" ? (
            <AlertTriangle className="h-5 w-5 text-destructive" />
          ) : (
            <QrCode className="h-5 w-5 text-muted-foreground" />
          )}
          <div>
            <p className={`text-sm font-medium ${copy.tone}`}>{copy.label}</p>
            {session?.phone_number && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Smartphone className="h-3 w-3" />
                {session.phone_number}
                {session.display_name ? ` · ${session.display_name}` : ""}
              </p>
            )}
          </div>
        </div>

        {canManage && (
          <div className="flex gap-2">
            {status === "connected" ? (
              canDisconnect ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={disconnect}
                  disabled={busy}
                >
                  <Unplug className="mr-1.5 h-4 w-4" />
                  Disconnect
                </Button>
              ) : null
            ) : (
              <Button size="sm" onClick={connect} disabled={busy}>
                {busy ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-1.5 h-4 w-4" />
                )}
                {status === "qr_pending"
                  ? "Restart pairing"
                  : status === "stale"
                    ? "Reconnect"
                    : "Connect WhatsApp"}
              </Button>
            )}
          </div>
        )}
      </div>

      {!gatewayConfigured && (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          This deployment has no WhatsApp gateway configured, so no QR code
          can be issued. Set <code>WHATSAPP_GATEWAY_URL</code>,{" "}
          <code>WHATSAPP_GATEWAY_TOKEN</code> and{" "}
          <code>WHATSAPP_GATEWAY_SIGNING_SECRET</code> on the web service,
          and make sure the gateway is running.
        </p>
      )}

      {status === "stale" && (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          The last heartbeat from the gateway was over{" "}
          {Math.round(STALE_AFTER_MS / 60_000)} minutes ago, so this
          number is not actually reachable. The saved session is intact — restart
          the gateway service, or press Reconnect. Scanning a new QR code is not
          required unless this says &ldquo;Logged out&rdquo;.
        </p>
      )}

      {session?.last_error && status !== "connected" && (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {session.last_error}
        </p>
      )}

      {showQr && (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-muted/30 p-6">
          {/* Rendered to a data URL by the gateway, so no QR library
              ships to the browser. unoptimized: Next's optimizer has
              nothing to do with an inline data URI. */}
          <Image
            src={session.qr_code!}
            alt="WhatsApp pairing QR code"
            width={280}
            height={280}
            unoptimized
            className="rounded bg-white p-2"
          />
          <ol className="max-w-sm space-y-1 text-sm text-muted-foreground">
            <li>1. Open WhatsApp on the phone for this number.</li>
            <li>2. Go to Settings → Linked devices → Link a device.</li>
            <li>3. Scan this code.</li>
          </ol>
          <p className="text-xs text-muted-foreground">
            The code refreshes every few seconds until it is scanned.
          </p>
        </div>
      )}

      {status === "connecting" && !showQr && (
        <div className="space-y-3 rounded-lg border border-border bg-muted/30 px-4 py-6">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Contacting WhatsApp…
          </div>

          {stuck && (
            <div className="space-y-2 border-t border-border pt-3">
              <p className="text-sm text-destructive">
                No QR code after{" "}
                {Math.round(PAIRING_STUCK_AFTER_MS / 1000)} seconds. The
                gateway normally issues one within a second or two, so it is
                probably unreachable or missing part of its environment —
                check <code>docker compose logs gateway</code>.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  // Restamping reopens the pairing window, so this both
                  // re-reads the row now and resumes polling.
                  setPairingSince(Date.now());
                  void load();
                }}
                disabled={busy}
              >
                <RefreshCw className="mr-1.5 h-4 w-4" />
                Check again
              </Button>
            </div>
          )}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        A QR-connected number uses WhatsApp&apos;s linked-devices feature rather
        than the official Business API. Approved message templates are not
        available on this channel, and the phone must stay online for messages
        to send.
      </p>
    </div>
  );
}
