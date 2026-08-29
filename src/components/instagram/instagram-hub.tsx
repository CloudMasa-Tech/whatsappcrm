"use client";

import { useState, useRef } from "react";
import {
  RotateCw,
  ExternalLink,
  Maximize2,
  Minimize2,
  MessageSquare,
  Globe,
  Compass,
  Film,
  Loader2,
  ShieldAlert,
} from "lucide-react";
import { InstagramGradientIcon } from "@/components/icons/instagram";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { buildProxySrc, isOriginIsolated } from "@/lib/sandbox-origin";

interface InstagramHubProps {
  canDisconnect?: boolean;
}

const PRESET_URLS = [
  { id: "inbox", label: "Direct Inbox", icon: MessageSquare, url: "https://www.instagram.com/direct/inbox/" },
  { id: "home", label: "Instagram Feed", icon: Globe, url: "https://www.instagram.com/" },
  { id: "explore", label: "Explore", icon: Compass, url: "https://www.instagram.com/explore/" },
  { id: "reels", label: "Reels", icon: Film, url: "https://www.instagram.com/reels/" },
];

export function InstagramHub({ canDisconnect = true }: InstagramHubProps) {
  const [frameUrl, setFrameUrl] = useState("https://www.instagram.com/direct/inbox/");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [loadingFrame, setLoadingFrame] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const handleNavigate = (url: string) => {
    setLoadingFrame(true);
    setFrameUrl(url);
    setIframeKey((k) => k + 1);
    setTimeout(() => setLoadingFrame(false), 800);
  };

  const handleReload = () => {
    setLoadingFrame(true);
    setIframeKey((k) => k + 1);
    toast.info("Reloading Instagram...");
    setTimeout(() => setLoadingFrame(false), 800);
  };

  const handleOpenPopup = () => {
    const popup = window.open(
      frameUrl,
      "InstagramWeb",
      "width=480,height=820,menubar=no,toolbar=no,location=no,status=no,resizable=yes"
    );
    if (popup) {
      toast.success("Instagram opened in companion window!");
    } else {
      toast.error("Popup was blocked by browser. Please allow popups.");
    }
  };

  const toggleFullscreen = () => {
    if (!isFullscreen) {
      if (containerRef.current?.requestFullscreen) {
        containerRef.current.requestFullscreen();
      }
      setIsFullscreen(true);
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
      setIsFullscreen(false);
    }
  };

  // Served from NEXT_PUBLIC_SANDBOX_ORIGIN when configured, so the framed
  // Meta scripts land in a separate storage partition and cannot read the
  // CRM's Supabase session cookies. See @/lib/sandbox-origin.
  const proxySrc = buildProxySrc("/api/instagram/proxy", frameUrl);
  const originIsolated = isOriginIsolated();

  return (
    <div
      ref={containerRef}
      className={cn(
        "flex flex-col h-[calc(100dvh-5.5rem)] sm:h-[calc(100dvh-6.5rem)] rounded-xl border border-border bg-card shadow-sm overflow-hidden",
        isFullscreen ? "fixed inset-0 z-50 h-[100dvh] w-screen rounded-none border-0 p-0" : ""
      )}
    >
      {/* Sleek Minimal Toolbar (Responsive on mobile & desktop) */}
      <div className="flex items-center justify-between border-b border-border bg-muted/40 px-2 py-2 gap-2 sm:px-3">
        {/* Left: Branding & Quick View Switcher */}
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto no-scrollbar">
          <div className="flex items-center gap-1.5 mr-1 shrink-0">
            <InstagramGradientIcon className="size-5 rounded-md shrink-0" />
            <span className="text-xs font-semibold text-foreground hidden sm:inline">
              Instagram
            </span>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {PRESET_URLS.map((preset) => {
              const Icon = preset.icon;
              const isActive = frameUrl === preset.url;
              return (
                <Button
                  key={preset.id}
                  variant={isActive ? "default" : "ghost"}
                  size="sm"
                  className={cn(
                    "h-7 px-2.5 text-xs gap-1.5 shrink-0",
                    isActive
                      ? "bg-gradient-to-r from-pink-500 via-rose-500 to-purple-600 text-white shadow-xs hover:opacity-90 font-medium"
                      : "text-muted-foreground"
                  )}
                  onClick={() => handleNavigate(preset.url)}
                  title={preset.label}
                  aria-label={preset.label}
                >
                  <Icon className="size-3.5 shrink-0" />
                  {/* Below 30rem the buttons are icon-only; title/aria-label
                      keep them identifiable. */}
                  <span className="hidden xs:inline">{preset.label}</span>
                </Button>
              );
            })}
          </div>
        </div>

        {/* Right: Actions (Reload, Popout, Fullscreen) */}
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-foreground"
            title="Reload Frame"
            onClick={handleReload}
          >
            <RotateCw className={cn("size-3.5", loadingFrame ? "animate-spin text-pink-500" : "")} />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-foreground"
            title="Launch Companion Window"
            onClick={handleOpenPopup}
          >
            <ExternalLink className="size-3.5" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-foreground"
            title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
            onClick={toggleFullscreen}
          >
            {isFullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
          </Button>
        </div>
      </div>

      {/* Surfaced rather than hidden: without an isolation origin the framed
          Meta scripts run on this origin and can read the CRM session. */}
      {!originIsolated && (
        <div className="flex items-start gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[11px] leading-snug text-amber-700 dark:text-amber-400">
          <ShieldAlert className="mt-px size-3.5 shrink-0" />
          <span className="min-w-0">
            Not origin-isolated. Set{" "}
            <code className="font-mono">NEXT_PUBLIC_SANDBOX_ORIGIN</code> to a
            separate host so framed content cannot read your session.
          </span>
        </div>
      )}

      {/* Pure Full-Height Iframe Viewport */}
      <div className="relative flex-1 w-full bg-background overflow-hidden">
        {loadingFrame && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-background/80 backdrop-blur-xs gap-2">
            <Loader2 className="size-7 animate-spin text-pink-500" />
            <p className="text-xs font-medium text-muted-foreground">Loading Instagram...</p>
          </div>
        )}

        <iframe
          key={iframeKey}
          ref={iframeRef}
          src={proxySrc}
          title="Instagram In-Frame"
          className="h-full w-full border-0 bg-white"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-presentation"
          allow="camera; microphone; clipboard-write; encrypted-media; fullscreen; unload"
          onLoad={() => setLoadingFrame(false)}
        />
      </div>
    </div>
  );
}
