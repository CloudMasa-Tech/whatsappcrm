import crypto from "node:crypto";
import { NextResponse, after } from "next/server";
import { decrypt } from "@/lib/whatsapp/encryption";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  getInstagramUserProfile,
  replyToComment,
  sendPrivateCommentReply,
} from "@/lib/instagram/meta-client";
import { ingestInstagramMessage } from "@/lib/instagram/inbound";
import type {
  InstagramConfigRow,
  InstagramTokenType,
  InstagramWebhookEvent,
} from "@/lib/instagram/types";

export const maxDuration = 60;

// GET — Meta Webhook Subscription Handshake
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get("hub.mode");
    const challenge = searchParams.get("hub.challenge");
    const verifyToken = searchParams.get("hub.verify_token");

    if (mode !== "subscribe" || !challenge || !verifyToken) {
      return NextResponse.json({ error: "Missing verification parameters" }, { status: 400 });
    }

    const { data: configs, error } = await supabaseAdmin()
      .from("instagram_config")
      .select("id, verify_token");

    if (error || !configs) {
      console.error("[Instagram webhook] GET verify lookup failed:", error);
      return NextResponse.json({ error: "Verification failed" }, { status: 403 });
    }

    for (const config of configs) {
      if (!config.verify_token) continue;
      try {
        if (decrypt(config.verify_token) === verifyToken || config.verify_token === verifyToken) {
          return new Response(challenge, {
            status: 200,
            headers: { "Content-Type": "text/plain" },
          });
        }
      } catch {
        if (config.verify_token === verifyToken) {
          return new Response(challenge, {
            status: 200,
            headers: { "Content-Type": "text/plain" },
          });
        }
      }
    }

    return NextResponse.json({ error: "Verification token mismatch" }, { status: 403 });
  } catch (err) {
    console.error("[Instagram webhook] GET verification error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

function verifySignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;

  const expected = crypto.createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const received = header.slice("sha256=".length);

  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(received, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function resolveConfigForEntry(
  entryId: string | undefined,
  recipientId: string | undefined,
): Promise<InstagramConfigRow | null> {
  const candidates = Array.from(new Set([recipientId, entryId].filter(Boolean) as string[]));
  if (candidates.length === 0) return null;

  const db = supabaseAdmin();
  for (const candidate of candidates) {
    const { data: byIg } = await db
      .from("instagram_config")
      .select("*")
      .eq("instagram_business_id", candidate)
      .maybeSingle();
    if (byIg) return byIg as InstagramConfigRow;

    const { data: byPage } = await db
      .from("instagram_config")
      .select("*")
      .eq("page_id", candidate)
      .maybeSingle();
    if (byPage) return byPage as InstagramConfigRow;
  }

  return null;
}

// POST — Receive incoming Instagram DMs, Receipts, Reactions & Comment Events
export async function POST(request: Request) {
  const raw = await request.text();

  let body: InstagramWebhookEvent;
  try {
    body = JSON.parse(raw) as InstagramWebhookEvent;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const firstEntry = body.entry?.[0];
  const firstRecipient = firstEntry?.messaging?.[0]?.recipient?.id;
  const config = await resolveConfigForEntry(firstEntry?.id, firstRecipient);

  if (!config) {
    // Unknown IG/Page ID — acknowledge so Meta stops retrying without mutating anything.
    return NextResponse.json({ status: "ignored" }, { status: 200 });
  }

  let appSecret: string | null = null;
  if (config.app_secret) {
    try {
      appSecret = decrypt(config.app_secret);
    } catch {
      appSecret = null;
    }
  }
  appSecret =
    appSecret ||
    process.env.META_IG_APP_SECRET ||
    process.env.META_APP_SECRET ||
    null;

  const signature = request.headers.get("x-hub-signature-256");
  if (!appSecret || !verifySignature(raw, signature, appSecret)) {
    console.warn("[Instagram webhook] Invalid signature rejected for project", config.project_id);
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  after(async () => {
    try {
      await processInstagramWebhook(body);
    } catch (err) {
      console.error("[Instagram webhook] process error:", err);
    }
  });

  return NextResponse.json({ status: "received" }, { status: 200 });
}

async function processInstagramWebhook(body: InstagramWebhookEvent) {
  if (!body.entry) return;
  const db = supabaseAdmin();

  for (const entry of body.entry) {
    const messaging = entry.messaging || [];

    for (const item of messaging) {
      const recipientId = item.recipient?.id;
      const senderIgsid = item.sender?.id;

      const config = await resolveConfigForEntry(entry.id, recipientId);
      if (!config || config.status === "disconnected") continue;

      const accountId = config.account_id;
      const projectId = config.project_id;
      const configOwnerUserId = config.user_id;
      const tokenType = (config.token_type as InstagramTokenType | undefined) ?? null;

      let decryptedToken: string | null = null;
      if (config.access_token) {
        try {
          decryptedToken = decrypt(config.access_token);
        } catch {
          decryptedToken = null;
        }
      }

      // 1. Delivery receipt
      if (item.delivery?.mids?.length) {
        await db
          .from("messages")
          .update({ status: "delivered" })
          .eq("project_id", projectId)
          .in("message_id", item.delivery.mids)
          .neq("status", "read");
        continue;
      }

      // 2. Read receipt
      if (item.read?.watermark && senderIgsid) {
        const watermarkIso = new Date(
          item.read.watermark > 1e12 ? item.read.watermark : item.read.watermark * 1000,
        ).toISOString();
        const { data: contactRow } = await db
          .from("contacts")
          .select("id")
          .eq("project_id", projectId)
          .eq("instagram_id", senderIgsid)
          .maybeSingle();

        if (contactRow) {
          const { data: convRow } = await db
            .from("conversations")
            .select("id")
            .eq("project_id", projectId)
            .eq("contact_id", contactRow.id)
            .eq("channel", "instagram")
            .maybeSingle();
          if (convRow) {
            await db
              .from("messages")
              .update({ status: "read" })
              .eq("conversation_id", convRow.id)
              .eq("sender_type", "agent")
              .lte("created_at", watermarkIso)
              .neq("status", "read");
          }
        }
        continue;
      }

      // 3. Reaction event
      if (item.reaction?.mid) {
        const { data: targetMsg } = await db
          .from("messages")
          .select("id, conversation_id")
          .eq("project_id", projectId)
          .eq("message_id", item.reaction.mid)
          .maybeSingle();

        if (targetMsg) {
          if (item.reaction.action === "unreact") {
            await db
              .from("message_reactions")
              .delete()
              .eq("message_id", targetMsg.id)
              .eq("actor_type", "customer")
              .eq("actor_id", senderIgsid);
          } else {
            const emoji = item.reaction.emoji || "❤️";
            await db.from("message_reactions").upsert(
              {
                message_id: targetMsg.id,
                conversation_id: targetMsg.conversation_id,
                actor_type: "customer",
                actor_id: senderIgsid,
                emoji,
              },
              { onConflict: "message_id,actor_type,actor_id" },
            );
          }
        }
        continue;
      }

      // 4. Inbound DM message
      const msg = item.message;
      if (!msg || msg.is_deleted) continue;

      // Critical echo loop guard: ignore echo packets or self-originated sender IDs
      if (
        msg.is_echo ||
        !senderIgsid ||
        senderIgsid === recipientId ||
        senderIgsid === config.instagram_business_id ||
        senderIgsid === config.page_id
      ) {
        continue;
      }

      let senderName: string | null = null;
      let senderUsername: string | null = null;
      let avatarUrl: string | null = null;

      if (decryptedToken) {
        const profile = await getInstagramUserProfile(decryptedToken, senderIgsid, tokenType);
        if (profile) {
          senderName = profile.name || null;
          senderUsername = profile.username || null;
          avatarUrl = profile.profilePic || null;
        }
      }

      let mediaUrl: string | null = null;
      let mediaType: "text" | "image" | "video" | "audio" = "text";
      let text = msg.text?.trim() || null;

      if (msg.reply_to?.story?.url && !text) {
        text = "[Replied to your Story]";
      }

      if (msg.attachments && msg.attachments.length > 0) {
        const att = msg.attachments[0];
        mediaUrl = att.payload?.url || null;
        if (att.type === "video" || att.type === "reel") {
          mediaType = "video";
        } else if (att.type === "audio") {
          mediaType = "audio";
        } else {
          mediaType = "image";
        }
        if (att.type === "story_mention" && !text) {
          text = "[Mentioned you in their Story]";
        }
      }

      const rawTs = item.timestamp || Date.now();
      const timestampIso = new Date(rawTs > 1e12 ? rawTs : rawTs * 1000).toISOString();

      await ingestInstagramMessage(db, {
        accountId,
        projectId,
        configOwnerUserId,
        senderIgsid,
        senderUsername,
        senderName,
        senderAvatarUrl: avatarUrl,
        externalMessageId: msg.mid,
        text,
        mediaUrl,
        mediaType,
        replyToExternalMid: msg.reply_to?.mid || null,
        timestampIso,
        fromMe: false,
        isHistory: false,
      });
    }

    // 5. Comment Webhook Events (optional automatic public reply + Comment-to-DM)
    for (const change of entry.changes || []) {
      if (change.field !== "comments" || !change.value) continue;

      const config = await resolveConfigForEntry(entry.id, undefined);
      if (!config || !config.comment_auto_reply_enabled || !config.access_token) continue;

      const commentId = change.value.id || change.value.comment_id;
      const commentText = change.value.text || "";
      const commenterId = change.value.from?.id;
      const commenterUsername = change.value.from?.username;

      if (!commentId) continue;
      // Ignore comments made by our own business account
      if (
        commenterId === config.instagram_business_id ||
        (commenterUsername &&
          config.username &&
          commenterUsername.toLowerCase() === config.username.toLowerCase())
      ) {
        continue;
      }

      // Keyword match (blank or '*' matches every comment; comma-separated for multi-keyword)
      const keywordRaw = (config.comment_auto_reply_keyword || "").trim();
      if (keywordRaw && keywordRaw !== "*") {
        const keywords = keywordRaw
          .split(",")
          .map((k) => k.trim().toLowerCase())
          .filter(Boolean);
        const lowerComment = commentText.toLowerCase();
        if (!keywords.some((kw) => lowerComment.includes(kw))) {
          continue;
        }
      }

      let decryptedToken: string;
      try {
        decryptedToken = decrypt(config.access_token);
      } catch {
        continue;
      }

      const tokenType = (config.token_type as InstagramTokenType | undefined) ?? null;

      if (config.comment_auto_reply_message?.trim()) {
        await replyToComment(
          decryptedToken,
          commentId,
          config.comment_auto_reply_message.trim(),
          tokenType,
        ).catch((err) => {
          console.warn("[Instagram webhook] comment auto-reply failed:", err);
        });
      }

      if (config.comment_auto_dm_message?.trim()) {
        await sendPrivateCommentReply(
          decryptedToken,
          commentId,
          config.comment_auto_dm_message.trim(),
          {
            tokenType,
            igId: config.instagram_business_id,
            pageId: config.page_id,
          },
        ).catch((err) => {
          console.warn("[Instagram webhook] comment auto-DM failed:", err);
        });
      }
    }
  }
}
