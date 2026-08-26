"use client";

import { useState, useEffect, useRef } from "react";
import {
  Smartphone,
  Tablet,
  Monitor,
  RotateCw,
  ExternalLink,
  Copy,
  Check,
  Maximize2,
  Minimize2,
  MessageSquare,
  Sparkles,
  Send,
  User,
  Radio,
  Settings2,
  Compass,
  Film,
  ArrowRight,
  Loader2,
  Eye,
  CheckCircle2,
  ShieldCheck,
  ArrowLeft,
  ArrowRight as ArrowRightIcon,
  Globe,
} from "lucide-react";
import { Instagram } from "@/components/icons/instagram";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { InstagramConfig } from "@/components/settings/instagram-config";
import { toast } from "sonner";
import Link from "next/link";
import { cn } from "@/lib/utils";

interface InstagramHubProps {
  canDisconnect?: boolean;
}

type DeviceMode = "mobile" | "tablet" | "desktop";

const PRESET_URLS = [
  { id: "inbox", label: "Direct Inbox", icon: MessageSquare, url: "https://www.instagram.com/direct/inbox/" },
  { id: "home", label: "Instagram Feed", icon: Globe, url: "https://www.instagram.com/" },
  { id: "explore", label: "Explore", icon: Compass, url: "https://www.instagram.com/explore/" },
  { id: "reels", label: "Reels", icon: Film, url: "https://www.instagram.com/reels/" },
];

export function InstagramHub({ canDisconnect = true }: InstagramHubProps) {
  const [activeTab, setActiveTab] = useState("inframe");
  const [deviceMode, setDeviceMode] = useState<DeviceMode>("desktop");
  const [frameUrl, setFrameUrl] = useState("https://www.instagram.com/direct/inbox/");
  const [inputUrl, setInputUrl] = useState("https://www.instagram.com/direct/inbox/");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [loadingFrame, setLoadingFrame] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);

  // Status state
  const [status, setStatus] = useState<"connected" | "disconnected" | "loading">("loading");
  const [igUsername, setIgUsername] = useState<string | null>(null);

  // Quick DM form state
  const [dmRecipient, setDmRecipient] = useState("");
  const [dmMessage, setDmMessage] = useState("");
  const [dmSending, setDmSending] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Fetch status
  const fetchStatus = async () => {
    try {
      const res = await fetch("/api/instagram/config");
      const data = await res.json();
      if (data.status === "connected") {
        setStatus("connected");
        setIgUsername(data.username || data.name || null);
      } else {
        setStatus("disconnected");
      }
    } catch {
      setStatus("disconnected");
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  const handleNavigate = (url: string) => {
    setLoadingFrame(true);
    setFrameUrl(url);
    setInputUrl(url);
    setIframeKey((k) => k + 1);
    setTimeout(() => setLoadingFrame(false), 1000);
  };

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    let url = inputUrl.trim();
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      url = `https://${url}`;
    }
    handleNavigate(url);
  };

  const handleReload = () => {
    setLoadingFrame(true);
    setIframeKey((k) => k + 1);
    toast.info("Reloading Instagram session...");
    setTimeout(() => setLoadingFrame(false), 1000);
  };

  const handleOpenPopup = () => {
    const popup = window.open(
      frameUrl,
      "InstagramWeb",
      "width=440,height=780,menubar=no,toolbar=no,location=no,status=no,resizable=yes"
    );
    if (popup) {
      toast.success("Instagram opened in companion window!");
    } else {
      toast.error("Popup was blocked by browser. Please allow popups.");
    }
  };

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(frameUrl);
    setCopied(true);
    toast.success("URL copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
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

  // Quick DM Sender via CRM API
  const handleSendDm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dmRecipient.trim() || !dmMessage.trim()) {
      toast.error("Please provide both recipient username and message text.");
      return;
    }

    try {
      setDmSending(true);
      const res = await fetch("/api/inbox/new-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: "instagram",
          recipient: dmRecipient.trim(),
          message: dmMessage.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to send Instagram DM");
      }

      toast.success(`Direct message sent to @${data.recipient || dmRecipient}! Check Inbox to view conversation.`);
      setDmRecipient("");
      setDmMessage("");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to dispatch message.");
    } finally {
      setDmSending(false);
    }
  };

  const proxySrc = `/api/instagram/proxy?url=${encodeURIComponent(frameUrl)}`;

  return (
    <div className="space-y-6">
      {/* Top Banner / Hero Header */}
      <div className="relative overflow-hidden rounded-2xl border border-pink-500/20 bg-gradient-to-r from-pink-500/10 via-purple-500/10 to-primary/10 p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-tr from-yellow-500 via-pink-500 to-purple-600 text-white shadow-md">
                <Instagram className="size-5" />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
                  Instagram Workspace & In-Frame Hub
                </h1>
                <p className="text-xs text-muted-foreground sm:text-sm">
                  Live embedded Instagram Web, unified Direct Messages, and real-time CRM synchronization
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {status === "connected" ? (
              <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 gap-1.5 py-1 px-2.5">
                <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
                <span>Connected {igUsername ? `@${igUsername}` : ""}</span>
              </Badge>
            ) : status === "loading" ? (
              <Badge variant="outline" className="gap-1.5 py-1 px-2.5">
                <Loader2 className="size-3 animate-spin" />
                <span>Checking status</span>
              </Badge>
            ) : (
              <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400 gap-1.5 py-1 px-2.5">
                <Radio className="size-3" />
                <span>Not Connected</span>
              </Badge>
            )}

            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs bg-background/80 hover:bg-background"
              onClick={handleOpenPopup}
            >
              <ExternalLink className="size-3.5 text-pink-500" />
              <span>Launch Companion Window</span>
            </Button>
          </div>
        </div>
      </div>

      {/* Main Tabs Navigation */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-3 max-w-md">
          <TabsTrigger value="inframe" className="gap-2">
            <Smartphone className="size-4 text-pink-500" />
            <span>In-Frame Webview</span>
          </TabsTrigger>
          <TabsTrigger value="messenger" className="gap-2">
            <MessageSquare className="size-4 text-primary" />
            <span>Direct Messenger</span>
          </TabsTrigger>
          <TabsTrigger value="settings" className="gap-2">
            <Settings2 className="size-4" />
            <span>Setup & Auth</span>
          </TabsTrigger>
        </TabsList>

        {/* TAB 1: IN-FRAME LIVE WEBVIEW */}
        <TabsContent value="inframe" className="space-y-4">
          <div
            ref={containerRef}
            className={cn(
              "flex flex-col rounded-2xl border border-border bg-card shadow-sm transition-all overflow-hidden",
              isFullscreen ? "fixed inset-0 z-50 rounded-none bg-background p-4" : ""
            )}
          >
            {/* Control Bar */}
            <div className="flex flex-col gap-3 border-b border-border p-3 sm:flex-row sm:items-center sm:justify-between bg-muted/30">
              {/* Presets */}
              <div className="flex flex-wrap items-center gap-1.5">
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
                        isActive ? "bg-gradient-to-r from-pink-500 to-purple-600 text-white shadow-xs" : ""
                      )}
                      onClick={() => handleNavigate(preset.url)}
                    >
                      <Icon className="size-3.5" />
                      <span>{preset.label}</span>
                    </Button>
                  );
                })}
              </div>

              {/* Viewport Device Mode & Actions */}
              <div className="flex items-center gap-1 self-end sm:self-auto">
                <div className="flex items-center rounded-lg border border-border bg-muted/60 p-0.5">
                  <Button
                    variant={deviceMode === "desktop" ? "secondary" : "ghost"}
                    size="icon"
                    className="size-7"
                    title="Desktop / Full Width"
                    onClick={() => setDeviceMode("desktop")}
                  >
                    <Monitor className="size-3.5" />
                  </Button>
                  <Button
                    variant={deviceMode === "tablet" ? "secondary" : "ghost"}
                    size="icon"
                    className="size-7"
                    title="Tablet View (768px)"
                    onClick={() => setDeviceMode("tablet")}
                  >
                    <Tablet className="size-3.5" />
                  </Button>
                  <Button
                    variant={deviceMode === "mobile" ? "secondary" : "ghost"}
                    size="icon"
                    className="size-7"
                    title="Mobile View (390px)"
                    onClick={() => setDeviceMode("mobile")}
                  >
                    <Smartphone className="size-3.5" />
                  </Button>
                </div>

                <div className="h-4 w-px bg-border mx-1" />

                <Button variant="ghost" size="icon" className="size-7" title="Reload Frame" onClick={handleReload}>
                  <RotateCw className={cn("size-3.5", loadingFrame ? "animate-spin text-pink-500" : "")} />
                </Button>

                <Button variant="ghost" size="icon" className="size-7" title="Copy URL" onClick={handleCopyUrl}>
                  {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
                </Button>

                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
                  onClick={toggleFullscreen}
                >
                  {isFullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1 ml-1"
                  onClick={handleOpenPopup}
                >
                  <ExternalLink className="size-3" />
                  <span className="hidden sm:inline">Popout</span>
                </Button>
              </div>
            </div>

            {/* Address Bar */}
            <form onSubmit={handleUrlSubmit} className="flex items-center gap-2 border-b border-border/60 bg-muted/10 px-3 py-1.5">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono">
                <span className="text-emerald-500 font-semibold">https://</span>
              </div>
              <Input
                value={inputUrl.replace(/^https?:\/\//, "")}
                onChange={(e) => setInputUrl(e.target.value)}
                placeholder="www.instagram.com/direct/inbox/"
                className="h-7 text-xs bg-background/80 border-border/80"
              />
              <Button type="submit" size="sm" variant="secondary" className="h-7 px-3 text-xs">
                Go
              </Button>
            </form>

            {/* Frame Viewport Container */}
            <div className="relative flex-1 min-h-[720px] flex items-center justify-center p-3 bg-muted/10 overflow-auto">
              <div
                className={cn(
                  "relative flex flex-col transition-all duration-300 shadow-2xl bg-zinc-950 rounded-xl overflow-hidden border border-border/80 text-white w-full",
                  deviceMode === "mobile"
                    ? "w-[390px] h-[740px] rounded-[36px] border-[6px] border-zinc-800 shadow-pink-500/10"
                    : deviceMode === "tablet"
                    ? "w-[768px] h-[780px] rounded-[24px] border-[4px] border-zinc-800"
                    : "w-full h-[780px]"
                )}
              >
                {/* Mobile Notch Bar */}
                {deviceMode === "mobile" && (
                  <div className="relative h-6 bg-zinc-950 flex items-center justify-center shrink-0 border-b border-zinc-900">
                    <div className="h-3 w-28 bg-zinc-900 rounded-full" />
                  </div>
                )}

                {/* Loading State Overlay */}
                {loadingFrame && (
                  <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-zinc-950/80 backdrop-blur-sm gap-2">
                    <Loader2 className="size-8 animate-spin text-pink-500" />
                    <p className="text-xs font-medium text-zinc-300">Loading Instagram Web...</p>
                  </div>
                )}

                {/* LIVE EMBEDDED INSTAGRAM WEB FRAME (via Proxy) */}
                <iframe
                  key={iframeKey}
                  ref={iframeRef}
                  src={proxySrc}
                  title="Instagram Web In-Frame"
                  className="w-full flex-1 border-0 bg-white"
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-presentation"
                  allow="camera; microphone; clipboard-write; encrypted-media; fullscreen"
                  onLoad={() => setLoadingFrame(false)}
                />

                {/* Mobile Bottom Bar */}
                {deviceMode === "mobile" && (
                  <div className="h-4 bg-zinc-950 flex items-center justify-center shrink-0">
                    <div className="h-1 w-24 bg-zinc-700 rounded-full" />
                  </div>
                )}
              </div>
            </div>
          </div>
        </TabsContent>

        {/* TAB 2: DIRECT MESSENGER CONSOLE */}
        <TabsContent value="messenger" className="space-y-4">
          <div className="grid gap-6 md:grid-cols-2">
            {/* Quick Dispatch Card */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Send className="size-4 text-pink-500" />
                  <span>Send Instagram Direct Message</span>
                </CardTitle>
                <CardDescription>
                  Dispatch instant direct messages to any Instagram user handle or customer IGSID.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSendDm} className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-foreground">
                      Recipient Instagram Username or IGSID *
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-2.5 text-xs text-muted-foreground">@</span>
                      <Input
                        value={dmRecipient}
                        onChange={(e) => setDmRecipient(e.target.value)}
                        placeholder="username"
                        className="pl-7 text-sm"
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-foreground">
                      Message Content *
                    </label>
                    <textarea
                      value={dmMessage}
                      onChange={(e) => setDmMessage(e.target.value)}
                      placeholder="Type your message here..."
                      rows={4}
                      className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      required
                    />
                  </div>

                  <Button
                    type="submit"
                    disabled={dmSending}
                    className="w-full bg-gradient-to-r from-pink-500 to-purple-600 text-white hover:opacity-90"
                  >
                    {dmSending ? (
                      <>
                        <Loader2 className="size-4 mr-2 animate-spin" />
                        <span>Sending message...</span>
                      </>
                    ) : (
                      <>
                        <Send className="size-4 mr-2" />
                        <span>Send Direct Message</span>
                      </>
                    )}
                  </Button>
                </form>
              </CardContent>
            </Card>

            {/* Live Conversation Sync Overview */}
            <Card className="flex flex-col justify-between">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <MessageSquare className="size-4 text-primary" />
                  <span>Unified CRM Inbox Sync</span>
                </CardTitle>
                <CardDescription>
                  All customer direct inquiries from Instagram are automatically synchronized into your central CRM inbox alongside WhatsApp.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-xl border border-border bg-muted/40 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-foreground">Instagram Multi-Channel Status</span>
                    <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 text-[10px]">
                      Active Sync
                    </Badge>
                  </div>
                  <ul className="text-xs space-y-2 text-muted-foreground">
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="size-3.5 text-emerald-500 shrink-0" />
                      <span>Two-way real-time direct messaging with Instagram users</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="size-3.5 text-emerald-500 shrink-0" />
                      <span>Automatic contact profile creation with Instagram handles</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="size-3.5 text-emerald-500 shrink-0" />
                      <span>Rich media support (Images, Videos, Voice notes)</span>
                    </li>
                  </ul>
                </div>

                <div className="pt-2">
                  <Link href="/inbox">
                    <Button className="w-full gap-2" variant="outline">
                      <span>Open Unified Inbox</span>
                      <ArrowRight className="size-4" />
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* TAB 3: SETUP & CONFIGURATION */}
        <TabsContent value="settings" className="space-y-4">
          <InstagramConfig canDisconnect={canDisconnect} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
