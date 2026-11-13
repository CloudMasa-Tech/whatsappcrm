"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { MessageCircle, Send, Loader2, User, Phone } from "lucide-react";
import { Instagram } from "@/components/icons/instagram";
import { XBrandIcon } from "@/components/icons/x";
import { toast } from "sonner";

interface NewChatDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConversationCreated?: (conversationId: string) => void;
}

export function NewChatDialog({
  open,
  onOpenChange,
  onConversationCreated,
}: NewChatDialogProps) {
  const [channel, setChannel] = useState<"whatsapp" | "instagram" | "x">("instagram");
  const [loading, setLoading] = useState(false);

  // Form fields
  const [recipient, setRecipient] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!recipient.trim()) {
      toast.error(
        channel === "instagram"
          ? "Please enter an Instagram username."
          : channel === "x"
            ? "Please enter an X (Twitter) username."
            : "Please enter a phone number.",
      );
      return;
    }

    if (!message.trim()) {
      toast.error("Please enter a message to send.");
      return;
    }

    try {
      setLoading(true);
      const res = await fetch("/api/inbox/new-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel,
          recipient: recipient.trim(),
          name: name.trim() || undefined,
          message: message.trim(),
        }),
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to start conversation");
      }

      toast.success(
        channel === "instagram"
          ? `Direct message sent to @${data.recipient}!`
          : channel === "x"
            ? `Direct message sent to @${data.recipient} on X!`
            : `Message sent to ${data.recipient}!`,
      );

      setRecipient("");
      setName("");
      setMessage("");
      onOpenChange(false);

      if (data.conversationId && onConversationCreated) {
        onConversationCreated(data.conversationId);
      }
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : "Failed to start new conversation",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold flex items-center gap-2">
            Start New Conversation
          </DialogTitle>
          <DialogDescription>
            Send a direct message on Instagram, X (Twitter), or WhatsApp to open a new chat.
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={channel}
          onValueChange={(v) => {
            setChannel(v as "whatsapp" | "instagram" | "x");
            setRecipient("");
          }}
          className="mt-2"
        >
          <TabsList className="grid grid-cols-3 w-full p-1 bg-muted rounded-xl">
            <TabsTrigger
              value="instagram"
              className="rounded-lg flex items-center gap-1.5 data-[state=active]:bg-gradient-to-r data-[state=active]:from-pink-500 data-[state=active]:to-purple-600 data-[state=active]:text-white text-xs font-semibold"
            >
              <Instagram className="h-4 w-4" /> Instagram
            </TabsTrigger>
            <TabsTrigger
              value="x"
              className="rounded-lg flex items-center gap-1.5 data-[state=active]:bg-sky-600 data-[state=active]:text-white text-xs font-semibold"
            >
              <XBrandIcon className="h-3.5 w-3.5" /> X (Twitter)
            </TabsTrigger>
            <TabsTrigger
              value="whatsapp"
              className="rounded-lg flex items-center gap-1.5 data-[state=active]:bg-emerald-600 data-[state=active]:text-white text-xs font-semibold"
            >
              <MessageCircle className="h-4 w-4" /> WhatsApp
            </TabsTrigger>
          </TabsList>

          <form onSubmit={handleSubmit} className="space-y-4 mt-4">
            {channel === "instagram" ? (
              <div className="space-y-2">
                <Label htmlFor="ig-recipient">Instagram Username</Label>
                <div className="relative">
                  <div className="absolute left-3 top-2.5 text-muted-foreground font-medium">
                    @
                  </div>
                  <Input
                    id="ig-recipient"
                    placeholder="username (e.g. johndoe)"
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value)}
                    className="pl-8 font-medium text-xs"
                    required
                  />
                </div>
              </div>
            ) : channel === "x" ? (
              <div className="space-y-2">
                <Label htmlFor="x-recipient">X (Twitter) Username</Label>
                <div className="relative">
                  <div className="absolute left-3 top-2.5 text-muted-foreground font-medium text-xs">
                    @
                  </div>
                  <Input
                    id="x-recipient"
                    placeholder="username (e.g. elonmusk)"
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value)}
                    className="pl-8 font-medium font-mono text-xs"
                    required
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="wa-recipient">Phone Number (with Country Code)</Label>
                <div className="relative">
                  <Phone className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="wa-recipient"
                    placeholder="+1234567890"
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value)}
                    className="pl-9"
                    required
                  />
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="contact-name">Contact Name (Optional)</Label>
              <div className="relative">
                <User className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="contact-name"
                  placeholder="e.g. John Doe"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="first-msg">Message</Label>
              <Textarea
                id="first-msg"
                placeholder={
                  channel === "instagram"
                    ? "Type your Instagram direct message..."
                    : channel === "x"
                      ? "Type your X direct message..."
                      : "Type your WhatsApp message..."
                }
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={3}
                required
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={loading}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={loading}
                className={
                  channel === "instagram"
                    ? "bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white font-medium shadow-md shadow-pink-500/20"
                    : channel === "x"
                      ? "bg-sky-600 hover:bg-sky-500 text-white font-medium shadow-md shadow-sky-500/20"
                      : "bg-emerald-600 hover:bg-emerald-500 text-white"
                }
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Sending...
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4 mr-2" /> Send Message
                  </>
                )}
              </Button>
            </div>
          </form>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
