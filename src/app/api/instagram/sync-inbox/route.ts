import { NextResponse } from "next/server";
import { requireProjectRole } from "@/lib/auth/project";
import { toErrorResponse } from "@/lib/auth/account";
import { decrypt } from "@/lib/whatsapp/encryption";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  fetchInstagramConversations,
  InstagramMetaError,
} from "@/lib/instagram/meta-client";
import { fetchDirectInboxThreads } from "@/lib/instagram/direct-client";
import { ingestInstagramMessage } from "@/lib/instagram/inbound";
import type { InstagramTokenType } from "@/lib/instagram/types";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const ctx = await requireProjectRole("agent");
    const db = supabaseAdmin();

    const { data: config } = await db
      .from("instagram_config")
      .select("*")
      .eq("project_id", ctx.projectId)
      .eq("status", "connected")
      .maybeSingle();

    if (!config) {
      return NextResponse.json(
        { error: "Instagram is not connected for this project." },
        { status: 400 },
      );
    }

    let threadsSynced = 0;
    let messagesIngested = 0;

    if (config.connection_method === "direct") {
      if (!config.session_data) {
        return NextResponse.json(
          { error: "Direct session cookies are missing. Reconnect your account." },
          { status: 400 },
        );
      }

      const decryptedSession = decrypt(config.session_data);
      const threads = await fetchDirectInboxThreads(decryptedSession, 15);

      for (const thread of threads) {
        threadsSynced++;
        for (const item of thread.messages) {
          const res = await ingestInstagramMessage(db, {
            accountId: ctx.accountId,
            projectId: ctx.projectId,
            configOwnerUserId: (config.user_id as string) || ctx.userId,
            senderIgsid: thread.recipientPk,
            senderUsername: thread.recipientUsername,
            senderName: thread.recipientName,
            senderAvatarUrl: thread.recipientAvatar || null,
            externalMessageId: item.itemId,
            text: item.text,
            mediaUrl: item.mediaUrl,
            mediaType: item.mediaType,
            timestampIso: item.timestamp,
            fromMe: item.isFromMe,
            isHistory: true,
          });
          if (res?.ingested) messagesIngested++;
        }
      }

      return NextResponse.json({
        success: true,
        threadsSynced,
        messagesIngested,
      });
    }

    // Meta Cloud API / Instagram Login sync
    if (!config.access_token) {
      return NextResponse.json(
        { error: "Meta Access Token is missing." },
        { status: 400 },
      );
    }

    const decryptedToken = decrypt(config.access_token);
    const selfIds = new Set<string>(
      [config.instagram_business_id, config.page_id].filter(Boolean).map(String),
    );
    const selfUsername = (config.username || "").toLowerCase();

    const convs = await fetchInstagramConversations(decryptedToken, {
      tokenType: (config.token_type as InstagramTokenType | undefined) ?? null,
      igId: config.instagram_business_id,
      pageId: config.page_id,
      limit: 20,
    });

    for (const conv of convs) {
      threadsSynced++;
      const otherParticipant = conv.participants.find(
        (p) => !selfIds.has(String(p.id)) && (!selfUsername || p.username?.toLowerCase() !== selfUsername),
      );
      if (!otherParticipant) continue;

      const sortedMsgs = [...conv.messages].sort(
        (a, b) => new Date(a.created_time).getTime() - new Date(b.created_time).getTime(),
      );

      for (const m of sortedMsgs) {
        const fromId = String(m.from?.id || "");
        const fromMe =
          selfIds.has(fromId) ||
          Boolean(selfUsername && m.from?.username?.toLowerCase() === selfUsername);

        let mediaUrl: string | null = null;
        let mediaType: "text" | "image" | "video" | "audio" = "text";
        const firstAtt = m.attachments?.[0];
        if (firstAtt) {
          if (firstAtt.video_data?.url) {
            mediaUrl = firstAtt.video_data.url;
            mediaType = "video";
          } else if (firstAtt.audio_data?.url) {
            mediaUrl = firstAtt.audio_data.url;
            mediaType = "audio";
          } else if (firstAtt.image_data?.url) {
            mediaUrl = firstAtt.image_data.url;
            mediaType = "image";
          } else if (firstAtt.file_url) {
            mediaUrl = firstAtt.file_url;
            mediaType = "image";
          }
        }

        const res = await ingestInstagramMessage(db, {
          accountId: ctx.accountId,
          projectId: ctx.projectId,
          configOwnerUserId: (config.user_id as string) || ctx.userId,
          senderIgsid: String(otherParticipant.id),
          senderUsername: otherParticipant.username || null,
          senderName: otherParticipant.name || otherParticipant.username || null,
          externalMessageId: m.id,
          text: m.message || null,
          mediaUrl,
          mediaType,
          timestampIso: m.created_time || new Date().toISOString(),
          fromMe,
          isHistory: true,
        });
        if (res?.ingested) messagesIngested++;
      }
    }

    return NextResponse.json({
      success: true,
      threadsSynced,
      messagesIngested,
    });
  } catch (err) {
    if (err instanceof InstagramMetaError) {
      return NextResponse.json({ error: err.message }, { status: err.status || 400 });
    }
    if (err instanceof Error) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return toErrorResponse(err);
  }
}

