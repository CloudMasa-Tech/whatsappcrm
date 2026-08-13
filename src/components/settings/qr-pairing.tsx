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
// ============================================================

type SessionStatus =
  | "disconnected"
  | "qr_pending"
  | "connecting"
  | "connected"
  | "logged_out"
  | "banned"
  | "error";

interface SessionRow {
  project_id: string;
  status: SessionStatus;
  qr_code: string | null;
  qr_expires_at: string | null;
  phone_number: string | null;
  display_name: string | null;
  last_connected_at: string | null;
  last_error: string | null;
}

interface QrPairingProps {
  projectId: string;
  projectName: string;
  /** Admins may pair and unpair; everyone else sees status only. */
  canManage: boolean;
}

const STATUS_COPY: Record<SessionStatus, { label: string; tone: string }> = {
  connected: { label: "Connected", tone: "text-emerald-600 dark:text-emerald-400" },
  qr_pending: { label: "Waiting for scan", tone: "text-amber-600 dark:text-amber-400" },
  connecting: { label: "Connecting…", tone: "text-muted-foreground" },
  disconnected: { label: "Not connected", tone: "text-muted-foreground" },
  logged_out: { label: "Logged out", tone: "text-destructive" },
  banned: { label: "Blocked by WhatsApp", tone: "text-destructive" },
  error: { label: "Error", tone: "text-destructive" },
};

export function QrPairing({ projectId, projectName, canManage }: QrPairingProps) {
  const [session, setSession] = useState<SessionRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/whatsapp/qr?project_id=${encodeURIComponent(projectId)}`,
        { cache: "no-store" },
      );
      if (!response.ok) return;
      const data = await response.json();
      setSession(data.session ?? null);
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
    const channel = supabase
      .channel(`whatsapp-session-${projectId}`)
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
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [projectId]);

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

  const status: SessionStatus = session?.status ?? "disconnected";
  const copy = STATUS_COPY[status];
  const showQr = status === "qr_pending" && session?.qr_code;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {status === "connected" ? (
            <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
          ) : status === "logged_out" || status === "banned" || status === "error" ? (
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
              <Button
                variant="outline"
                size="sm"
                onClick={disconnect}
                disabled={busy}
              >
                <Unplug className="mr-1.5 h-4 w-4" />
                Disconnect
              </Button>
            ) : (
              <Button size="sm" onClick={connect} disabled={busy}>
                {busy ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-1.5 h-4 w-4" />
                )}
                {status === "qr_pending" ? "Restart pairing" : "Connect WhatsApp"}
              </Button>
            )}
          </div>
        )}
      </div>

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
        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-4 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Contacting WhatsApp…
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
