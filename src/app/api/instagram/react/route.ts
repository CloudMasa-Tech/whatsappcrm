import { NextResponse } from "next/server";
import { requireProjectRole } from "@/lib/auth/project";
import { toErrorResponse } from "@/lib/auth/account";
import { decrypt } from "@/lib/whatsapp/encryption";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendMetaReaction, InstagramMetaError } from "@/lib/instagram/meta-client";
import type { InstagramTokenType } from "@/lib/instagram/types";

export async function POST(request: Request) {
  try {
    const ctx = await requireProjectRole("agent");
    const body = await request.json().catch(() => null);
    const messageId = typeof body?.message_id === "string" ? body.message_id : "";
    const emoji = typeof body?.emoji === "string" ? body.emoji : null;

    if (!messageId || emoji === null) {
      return NextResponse.json({ error: "message_id and emoji are required" }, { status: 400 });
    }

    const db = supabaseAdmin();

    const { data: targetMessage } = await db
      .from("messages")
      .select("id, message_id, conversation_id")
      .eq("id", messageId)
      .eq("project_id", ctx.projectId)
      .maybeSingle();

    if (!targetMessage) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }
    if (!targetMessage.message_id) {
      return NextResponse.json(
        { error: "Cannot react to a message without an Instagram message ID" },
        { status: 400 },
      );
    }

    const { data: conv } = await db
      .from("conversations")
      .select("id, channel, contacts(instagram_id)")
      .eq("id", targetMessage.conversation_id)
      .eq("project_id", ctx.projectId)
      .maybeSingle();

    if (!conv || conv.channel !== "instagram") {
      return NextResponse.json({ error: "Instagram conversation not found" }, { status: 404 });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const contact = (Array.isArray(conv.contacts) ? conv.contacts[0] : conv.contacts) as any;
    const igsid = contact?.instagram_id ? String(contact.instagram_id) : null;

    const { data: config } = await db
      .from("instagram_config")
      .select("*")
      .eq("project_id", ctx.projectId)
      .eq("status", "connected")
      .maybeSingle();

    if (!config || config.connection_method !== "cloud_api" || !config.access_token || !igsid) {
      return NextResponse.json(
        { error: "Instagram message reactions require Meta Cloud API and recipient IGSID." },
        { status: 400 },
      );
    }

    const accessToken = decrypt(config.access_token);
    await sendMetaReaction(accessToken, igsid, targetMessage.message_id, emoji, {
      tokenType: (config.token_type as InstagramTokenType | undefined) ?? null,
      igId: config.instagram_business_id,
      pageId: config.page_id,
    });

    if (emoji === "") {
      await db
        .from("message_reactions")
        .delete()
        .eq("message_id", targetMessage.id)
        .eq("actor_type", "agent")
        .eq("actor_id", ctx.userId);
    } else {
      await db.from("message_reactions").upsert(
        {
          message_id: targetMessage.id,
          conversation_id: targetMessage.conversation_id,
          actor_type: "agent",
          actor_id: ctx.userId,
          emoji,
        },
        { onConflict: "message_id,actor_type,actor_id" },
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof InstagramMetaError) {
      return NextResponse.json({ error: err.message }, { status: err.status || 400 });
    }
    return toErrorResponse(err);
  }
}

