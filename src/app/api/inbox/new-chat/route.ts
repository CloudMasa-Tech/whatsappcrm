import { NextResponse } from "next/server";
import { getCurrentProject } from "@/lib/auth/project";
import { sendInstagramMessage, InstagramSendError } from "@/lib/instagram/send-message";
import { normalizeHandle } from "@/lib/instagram/direct-client";
import { sendMessageToConversation } from "@/lib/whatsapp/send-message";
import { normalizePhone } from "@/lib/whatsapp/phone-utils";

export async function POST(request: Request) {
  try {
    const ctx = await getCurrentProject();
    const body = await request.json().catch(() => null);

    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { channel = "whatsapp", recipient, name, message } = body;

    if (!recipient || typeof recipient !== "string" || !recipient.trim()) {
      return NextResponse.json(
        { error: "Recipient is required (phone number or Instagram username)" },
        { status: 400 },
      );
    }

    if (!message || typeof message !== "string" || !message.trim()) {
      return NextResponse.json(
        { error: "Message text is required" },
        { status: 400 },
      );
    }

    // ==========================================
    // INSTAGRAM CHANNEL
    // ==========================================
    if (channel === "instagram") {
      const cleanUsername = normalizeHandle(recipient);
      if (!cleanUsername || !/^[a-zA-Z0-9._]{1,30}$/.test(cleanUsername)) {
        return NextResponse.json(
          { error: "Please enter a valid Instagram @username (letters, numbers, dots, underscores)." },
          { status: 400 },
        );
      }

      // 1. Find or create Contact (case-insensitive username check)
      let contactId: string | null = null;

      const { data: existingContact } = await ctx.supabase
        .from("contacts")
        .select("id, name, instagram_id, instagram_username, channel")
        .eq("project_id", ctx.projectId)
        .ilike("instagram_username", cleanUsername)
        .maybeSingle();

      if (existingContact) {
        contactId = existingContact.id;
      } else {
        const { data: newContact, error: contactErr } = await ctx.supabase
          .from("contacts")
          .insert({
            user_id: ctx.userId,
            account_id: ctx.accountId,
            project_id: ctx.projectId,
            name: name?.trim() || `@${cleanUsername}`,
            phone: `ig:${cleanUsername}`,
            instagram_username: cleanUsername,
            channel: "instagram",
          })
          .select("id")
          .single();

        if (contactErr) {
          if (contactErr.code === "23505") {
            const { data: raced } = await ctx.supabase
              .from("contacts")
              .select("id")
              .eq("project_id", ctx.projectId)
              .ilike("instagram_username", cleanUsername)
              .maybeSingle();
            contactId = raced?.id ?? null;
          }
          if (!contactId) {
            console.error("[new-chat] contact insert error:", contactErr);
            return NextResponse.json(
              { error: "Failed to create contact: " + contactErr.message },
              { status: 500 },
            );
          }
        } else {
          contactId = newContact.id;
        }
      }

      // 2. Find or create Instagram Conversation
      let conversationId: string | null = null;

      const { data: existingConv } = await ctx.supabase
        .from("conversations")
        .select("id")
        .eq("project_id", ctx.projectId)
        .eq("contact_id", contactId)
        .eq("channel", "instagram")
        .maybeSingle();

      if (existingConv) {
        conversationId = existingConv.id;
      } else {
        const { data: newConv, error: convErr } = await ctx.supabase
          .from("conversations")
          .insert({
            user_id: ctx.userId,
            account_id: ctx.accountId,
            project_id: ctx.projectId,
            contact_id: contactId,
            channel: "instagram",
            status: "open",
            last_message_text: message.trim(),
            last_message_at: new Date().toISOString(),
            unread_count: 0,
          })
          .select("id")
          .single();

        if (convErr) {
          if (convErr.code === "23505") {
            const { data: raced } = await ctx.supabase
              .from("conversations")
              .select("id")
              .eq("project_id", ctx.projectId)
              .eq("contact_id", contactId)
              .eq("channel", "instagram")
              .maybeSingle();
            conversationId = raced?.id ?? null;
          }
          if (!conversationId) {
            console.error("[new-chat] conv insert error:", convErr);
            return NextResponse.json(
              { error: "Failed to create conversation: " + convErr.message },
              { status: 500 },
            );
          }
        } else {
          conversationId = newConv.id;
        }
      }

      // 3. Send outbound Instagram Direct Message and surface real errors
      try {
        const sendRes = await sendInstagramMessage(ctx.supabase, {
          conversationId: conversationId!,
          projectId: ctx.projectId,
          accountId: ctx.accountId,
          userId: ctx.userId,
          contentText: message.trim(),
        });

        return NextResponse.json({
          success: true,
          conversationId,
          messageId: sendRes.messageId,
          channel: "instagram",
          recipient: cleanUsername,
        });
      } catch (sendErr: unknown) {
        if (sendErr instanceof InstagramSendError) {
          return NextResponse.json(
            {
              error: sendErr.message,
              code: sendErr.code,
              conversationId,
            },
            { status: sendErr.status },
          );
        }
        return NextResponse.json(
          {
            error:
              sendErr instanceof Error
                ? sendErr.message
                : "Failed to send Instagram Direct Message",
            conversationId,
          },
          { status: 502 },
        );
      }
    }

    // ==========================================
    // WHATSAPP CHANNEL
    // ==========================================
    const cleanPhone = normalizePhone(recipient);
    if (!cleanPhone) {
      return NextResponse.json(
        { error: "Invalid phone number format" },
        { status: 400 },
      );
    }

    // 1. Find or create Contact
    let contactId: string | null = null;
    const { data: existingContact } = await ctx.supabase
      .from("contacts")
      .select("id")
      .eq("project_id", ctx.projectId)
      .eq("phone", cleanPhone)
      .maybeSingle();

    if (existingContact) {
      contactId = existingContact.id;
    } else {
      const { data: newContact, error: contactErr } = await ctx.supabase
        .from("contacts")
        .insert({
          user_id: ctx.userId,
          account_id: ctx.accountId,
          project_id: ctx.projectId,
          name: name?.trim() || cleanPhone,
          phone: cleanPhone,
          channel: "whatsapp",
        })
        .select("id")
        .single();

      if (contactErr) {
        return NextResponse.json(
          { error: "Failed to create contact: " + contactErr.message },
          { status: 500 },
        );
      }
      contactId = newContact.id;
    }

    // 2. Find or create Conversation
    let conversationId: string | null = null;
    const { data: existingConv } = await ctx.supabase
      .from("conversations")
      .select("id")
      .eq("project_id", ctx.projectId)
      .eq("contact_id", contactId)
      .eq("channel", "whatsapp")
      .maybeSingle();

    if (existingConv) {
      conversationId = existingConv.id;
    } else {
      const { data: newConv, error: convErr } = await ctx.supabase
        .from("conversations")
        .insert({
          user_id: ctx.userId,
          account_id: ctx.accountId,
          project_id: ctx.projectId,
          contact_id: contactId,
          channel: "whatsapp",
          status: "open",
          last_message_text: message.trim(),
          last_message_at: new Date().toISOString(),
          unread_count: 0,
        })
        .select("id")
        .single();

      if (convErr) {
        return NextResponse.json(
          { error: "Failed to create conversation: " + convErr.message },
          { status: 500 },
        );
      }
      conversationId = newConv.id;
    }

    // 3. Send outbound WhatsApp Message
    try {
      await sendMessageToConversation(ctx.supabase, ctx.accountId, {
        conversationId: conversationId!,
        messageType: "text",
        contentText: message.trim(),
      });
    } catch (err: unknown) {
      console.warn("[new-chat] WhatsApp send warning:", err);
    }

    return NextResponse.json({
      success: true,
      conversationId,
      channel: "whatsapp",
      recipient: cleanPhone,
    });
  } catch (err: unknown) {
    console.error("[POST /api/inbox/new-chat] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 },
    );
  }
}
