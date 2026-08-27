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
} from "lucide-react";
import { FacebookBrandIcon } from "@/components/icons/facebook";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface FacebookHubProps {
  canDisconnect?: boolean;
}

const PRESET_URLS = [
  { id: "messenger", label: "Messenger Inbox", icon: MessageSquare, url: "https://www.facebook.com/messages/t/" },
  { id: "business", label: "Meta Business Suite", icon: Building2, url: "https://business.facebook.com/latest/inbox/all" },
  { id: "feed", label: "Facebook Feed", icon: Globe, url: "https://www.facebook.com/" },
];

export function FacebookHub({ canDisconnect = true }: FacebookHubProps) {
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

  const proxySrc = `/api/facebook/proxy?url=${encodeURIComponent(frameUrl)}`;

  return (
    <div
      ref={containerRef}
      className={cn(
        "flex flex-col h-[calc(100vh-5.5rem)] rounded-xl border border-border bg-card shadow-sm overflow-hidden",
        isFullscreen ? "fixed inset-0 z-50 h-screen w-screen rounded-none border-0 p-0" : ""
      )}
    >
      {/* Sleek Minimal Toolbar (No URL bar, no extra tabs) */}
      <div className="flex items-center justify-between border-b border-border bg-muted/40 px-3.5 py-2">
        {/* Left: Branding & Quick View Switcher */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 mr-2">
            <FacebookBrandIcon className="size-5" />
            <span className="text-xs font-semibold text-foreground hidden sm:inline">
              Facebook
            </span>
          </div>

          <div className="flex items-center gap-1">
            {PRESET_URLS.map((preset) => {
              const Icon = preset.icon;
              const isActive = frameUrl === preset.url;
              return (
                <Button
                  key={preset.id}
                  variant={isActive ? "default" : "ghost"}
                  size="sm"
                  className={cn(
                    "h-7 px-2.5 text-xs gap-1.5",
                    isActive ? "bg-blue-600 text-white shadow-xs hover:bg-blue-700 font-medium" : "text-muted-foreground"
                  )}
                  onClick={() => handleNavigate(preset.url)}
                >
                  <Icon className="size-3.5" />
                  <span>{preset.label}</span>
                </Button>
              );
            })}
          </div>
        </div>

        {/* Right: Actions (Reload, Popout, Fullscreen) */}
        <div className="flex items-center gap-1">
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

      {/* Pure Full-Height Iframe Viewport */}
      <div className="relative flex-1 w-full bg-background overflow-hidden">
        {loadingFrame && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-background/80 backdrop-blur-xs gap-2">
            <Loader2 className="size-7 animate-spin text-blue-600" />
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
  );
}
