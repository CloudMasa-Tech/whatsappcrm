import { NextResponse, after } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/whatsapp/encryption";
import { getInstagramUserProfile } from "@/lib/instagram/meta-client";
import { runAutomationsForTrigger } from "@/lib/automations/engine";
import { dispatchInboundToFlows } from "@/lib/flows/engine";
import { dispatchInboundToAiReply } from "@/lib/ai/auto-reply";
import { dispatchWebhookEvent } from "@/lib/webhooks/deliver";
import type { InstagramWebhookEvent } from "@/lib/instagram/types";

export const maxDuration = 60;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null;
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }
  return _adminClient;
}

// GET - Meta Webhook Verification
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get("hub.mode");
    const challenge = searchParams.get("hub.challenge");
    const verifyToken = searchParams.get("hub.verify_token");

    if (mode !== "subscribe" || !challenge || !verifyToken) {
      return NextResponse.json({ error: "Missing verification parameters" }, { status: 400 });
    }

    // Fetch all instagram configs
    const { data: configs, error } = await supabaseAdmin()
      .from("instagram_config")
      .select("id, verify_token");

    if (error || !configs) {
      console.error("Error fetching configs for Instagram verification:", error);
      return NextResponse.json({ error: "Verification failed" }, { status: 403 });
    }

    let matched = false;
    for (const config of configs) {
      if (!config.verify_token) continue;
      try {
        if (decrypt(config.verify_token) === verifyToken || config.verify_token === verifyToken) {
          matched = true;
          break;
        }
      } catch {
        if (config.verify_token === verifyToken) {
          matched = true;
          break;
        }
      }
    }

    if (matched) {
      return new Response(challenge, {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }

    return NextResponse.json({ error: "Verification token mismatch" }, { status: 403 });
  } catch (err) {
    console.error("Error in Instagram webhook GET verification:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST - Receive incoming Instagram events & DMs
export async function POST(request: Request) {
  let body: InstagramWebhookEvent;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Process asynchronously within after()
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

  for (const entry of body.entry) {
    const messaging = entry.messaging || [];
    for (const item of messaging) {
      if (!item.message) continue;

      const recipientId = item.recipient.id;
      const senderIgsid = item.sender.id;

      // Find the project owning this Instagram Business ID
      const { data: configRows } = await supabaseAdmin()
        .from("instagram_config")
        .select("*")
        .eq("instagram_business_id", recipientId);

      if (!configRows || configRows.length === 0) {
        // Fallback: check matching page_id or single connected account
        continue;
      }

      const config = configRows[0];
      const accountId = config.account_id;
      const projectId = config.project_id;
      const configOwnerUserId = config.user_id;

      let decryptedToken: string | null = null;
      if (config.access_token) {
        try {
          decryptedToken = decrypt(config.access_token);
        } catch {
          // Ignore
        }
      }

      // Fetch user profile if token available
      let senderName = `Instagram User (${senderIgsid.slice(0, 6)})`;
      let senderUsername = `ig_${senderIgsid.slice(0, 8)}`;
      let avatarUrl: string | null = null;

      if (decryptedToken) {
        const profile = await getInstagramUserProfile(decryptedToken, senderIgsid);
        if (profile) {
          if (profile.name) senderName = profile.name;
          if (profile.username) senderUsername = profile.username;
          if (profile.profilePic) avatarUrl = profile.profilePic;
        }
      }

      // 1. Resolve or create Contact
      let contactId: string;
      const { data: existingContact } = await supabaseAdmin()
        .from("contacts")
        .select("id")
        .eq("project_id", projectId)
        .or(`instagram_id.eq.${senderIgsid},instagram_username.eq.${senderUsername}`)
        .maybeSingle();

      if (existingContact) {
        contactId = existingContact.id;
      } else {
        const { data: newContact, error: contactErr } = await supabaseAdmin()
          .from("contacts")
          .insert({
            account_id: accountId,
            project_id: projectId,
            user_id: configOwnerUserId,
            name: senderName,
            instagram_id: senderIgsid,
            instagram_username: senderUsername,
            phone: `ig:${senderIgsid}`,
            avatar_url: avatarUrl,
            channel: "instagram",
          })
          .select("id")
          .single();

        if (contactErr || !newContact) {
          console.error("[Instagram webhook] failed to create contact:", contactErr);
          continue;
        }
        contactId = newContact.id;
      }

      // 2. Resolve or create Conversation
      let conversationId: string;
      const { data: existingConv } = await supabaseAdmin()
        .from("conversations")
        .select("id, unread_count")
        .eq("project_id", projectId)
        .eq("contact_id", contactId)
        .maybeSingle();

      if (existingConv) {
        conversationId = existingConv.id;
      } else {
        const { data: newConv, error: convErr } = await supabaseAdmin()
          .from("conversations")
          .insert({
            account_id: accountId,
            project_id: projectId,
            contact_id: contactId,
            user_id: configOwnerUserId,
            status: "open",
            channel: "instagram",
          })
          .select("id, unread_count")
          .single();

        if (convErr || !newConv) {
          console.error("[Instagram webhook] failed to create conversation:", convErr);
          continue;
        }
        conversationId = newConv.id;
      }

      // 3. Parse message content
      const msg = item.message;
      const text = msg.text || null;
      let mediaUrl: string | null = null;
      let contentType = "text";

      if (msg.attachments && msg.attachments.length > 0) {
        const att = msg.attachments[0];
        mediaUrl = att.payload?.url || null;
        if (att.type === "image" || att.type === "video" || att.type === "audio") {
          contentType = att.type;
        } else {
          contentType = "image";
        }
      }

      // 4. Insert message
      const { error: msgErr } = await supabaseAdmin()
        .from("messages")
        .insert({
          conversation_id: conversationId,
          project_id: projectId,
          sender_type: "customer",
          content_type: contentType,
          content_text: text,
          media_url: mediaUrl,
          message_id: msg.mid,
          status: "delivered",
          channel: "instagram",
          created_at: new Date(item.timestamp || Date.now()).toISOString(),
        });

      if (msgErr) {
        console.error("[Instagram webhook] failed to insert message:", msgErr);
        continue;
      }

      // 5. Update conversation preview
      await supabaseAdmin()
        .from("conversations")
        .update({
          last_message_text: text || (mediaUrl ? `[${contentType}]` : "[Instagram Message]"),
          last_message_at: new Date(item.timestamp || Date.now()).toISOString(),
          unread_count: (existingConv?.unread_count || 0) + 1,
          updated_at: new Date().toISOString(),
          channel: "instagram",
        })
        .eq("id", conversationId);

      // 6. Dispatch downstream engines (Flows, Automations, AI Reply, Webhooks)
      if (text) {
        void dispatchInboundToFlows({
          accountId,
          projectId,
          userId: configOwnerUserId,
          contactId,
          conversationId,
          message: {
            kind: "text",
            text,
            meta_message_id: msg.mid,
          },
          isFirstInboundMessage: !existingConv,
        });

        void runAutomationsForTrigger({
          accountId,
          projectId,
          triggerType: "new_message_received",
          contactId,
          context: {
            message_text: text,
            conversation_id: conversationId,
          },
        });

        void dispatchInboundToAiReply({
          accountId,
          projectId,
          conversationId,
          contactId,
          configOwnerUserId,
        });

        void dispatchWebhookEvent(supabaseAdmin(), accountId, projectId, "message.received", {
          project_id: projectId,
          conversation_id: conversationId,
          contact_id: contactId,
          text,
          channel: "instagram",
        });
      }
    }
  }
}
