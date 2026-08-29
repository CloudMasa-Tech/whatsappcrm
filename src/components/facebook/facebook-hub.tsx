"use client";

import { useState, useRef } from "react";
import {
  RotateCw,
  ExternalLink,
  Maximize2,
  Minimize2,
  MessageSquare,
  Building2,
  Globe,
  Loader2,
  ShieldAlert,
  Zap,
} from "lucide-react";
import { FacebookBrandIcon } from "@/components/icons/facebook";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { buildProxySrc, isOriginIsolated } from "@/lib/sandbox-origin";
import { FacebookConfig } from "@/components/settings/facebook-config";

interface FacebookHubProps {
  canDisconnect?: boolean;
}

const PRESET_URLS = [
  { id: "messenger", label: "Messenger Inbox", icon: MessageSquare, url: "https://www.facebook.com/messages/t/" },
  { id: "business", label: "Meta Business Suite", icon: Building2, url: "https://business.facebook.com/latest/inbox/all" },
  { id: "feed", label: "Facebook Feed", icon: Globe, url: "https://www.facebook.com/" },
];

export function FacebookHub({ canDisconnect = true }: FacebookHubProps) {
  const [activeTab, setActiveTab] = useState<"api" | "frame">("api");
  const [frameUrl, setFrameUrl] = useState("https://www.facebook.com/messages/t/");
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
    toast.info("Reloading Facebook...");
    setTimeout(() => setLoadingFrame(false), 800);
  };

  const handleOpenPopup = () => {
    const popup = window.open(
      frameUrl,
      "FacebookWeb",
      "width=520,height=840,menubar=no,toolbar=no,location=no,status=no,resizable=yes"
    );
    if (popup) {
      toast.success("Facebook opened in companion window!");
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

  const proxySrc = buildProxySrc("/api/facebook/proxy", frameUrl);
  const originIsolated = isOriginIsolated();

  return (
    <div className="space-y-4">
      {/* Top Mode Selector Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 mr-2">
            <FacebookBrandIcon className="size-6 shrink-0" />
            <h2 className="text-base font-bold text-foreground">Facebook Messenger Integration</h2>
          </div>

          <div className="inline-flex items-center rounded-lg bg-muted/60 p-1 border border-border/50 text-xs">
            <button
              onClick={() => setActiveTab("api")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-all",
                activeTab === "api"
                  ? "bg-card text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Zap className="size-3.5 text-blue-600" />
              Meta Cloud API (Recommended)
            </button>
            <button
              onClick={() => setActiveTab("frame")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-all",
                activeTab === "frame"
                  ? "bg-card text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Globe className="size-3.5 text-blue-500" />
              Web Companion Frame
            </button>
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={handleOpenPopup}
          className="h-8 text-xs gap-1.5 border-blue-500/20 hover:bg-blue-500/10 text-blue-600 dark:text-blue-400"
        >
          <ExternalLink className="size-3.5" />
          Open Direct Facebook Window
        </Button>
      </div>

      {/* Mode 1: Cloud API & Webhook Configuration */}
      {activeTab === "api" && (
        <FacebookConfig canDisconnect={canDisconnect} />
      )}

      {/* Mode 2: Embedded Web Companion Viewport */}
      {activeTab === "frame" && (
        <div
          ref={containerRef}
          className={cn(
            "flex flex-col h-[calc(100dvh-9rem)] sm:h-[calc(100dvh-10rem)] rounded-xl border border-border bg-card shadow-sm overflow-hidden",
            isFullscreen ? "fixed inset-0 z-50 h-[100dvh] w-screen rounded-none border-0 p-0" : ""
          )}
        >
          {/* Toolbar */}
          <div className="flex items-center justify-between border-b border-border bg-muted/40 px-2 py-2 gap-2 sm:px-3">
            <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto no-scrollbar">
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
                        isActive ? "bg-blue-600 text-white shadow-xs hover:bg-blue-700 font-medium" : "text-muted-foreground"
                      )}
                      onClick={() => handleNavigate(preset.url)}
                      title={preset.label}
                      aria-label={preset.label}
                    >
                      <Icon className="size-3.5 shrink-0" />
                      <span className="hidden xs:inline">{preset.label}</span>
                    </Button>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-foreground"
                title="Reload Frame"
                onClick={handleReload}
              >
                <RotateCw className={cn("size-3.5", loadingFrame ? "animate-spin text-blue-500" : "")} />
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

          {!originIsolated && (
            <div className="flex items-start gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[11px] leading-snug text-amber-700 dark:text-amber-400">
              <ShieldAlert className="mt-px size-3.5 shrink-0" />
              <span className="min-w-0">
                Direct browser session mode. If Meta blocks datacenter frame requests, use the <strong>Meta Cloud API</strong> tab or click <strong>Open Direct Facebook Window</strong>.
              </span>
            </div>
          )}

          {/* Iframe Viewport */}
          <div className="relative flex-1 w-full bg-background overflow-hidden">
            {loadingFrame && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-background/80 backdrop-blur-xs gap-2">
                <Loader2 className="size-7 animate-spin text-blue-500" />
                <p className="text-xs font-medium text-muted-foreground">Loading Facebook...</p>
              </div>
            )}

            <iframe
              key={iframeKey}
              ref={iframeRef}
              src={proxySrc}
              title="Facebook In-Frame"
              className="h-full w-full border-0 bg-white"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-presentation"
              allow="camera; microphone; clipboard-write; encrypted-media; fullscreen; unload"
              onLoad={() => setLoadingFrame(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
