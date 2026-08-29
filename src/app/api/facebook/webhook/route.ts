/**
 * /api/facebook/webhook
 *
 * Meta Messenger Platform webhook for a connected Facebook Page.
 *
 * GET  — Meta's subscription handshake (hub.challenge)
 * POST — inbound Messenger events → contacts / conversations / messages,
 *        then the same downstream engines the other channels use.
 *
 * Mirrors /api/instagram/webhook — same platform, same payload shape —
 * with one deliberate addition: POST bodies are verified against
 * X-Hub-Signature-256 before anything is written. Without that, anyone
 * who learns the URL can inject messages into a shared inbox.
 */

import crypto from 'node:crypto';

import { NextResponse, after } from 'next/server';
import { createClient } from '@supabase/supabase-js';

import { decrypt } from '@/lib/whatsapp/encryption';
import { runAutomationsForTrigger } from '@/lib/automations/engine';
import { dispatchInboundToFlows } from '@/lib/flows/engine';
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply';
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver';
import { getFacebookUserProfile } from '@/lib/facebook/meta-client';

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

interface MessengerAttachment {
  type?: string;
  payload?: { url?: string };
}

interface MessengerEvent {
  sender: { id: string };
  recipient: { id: string };
  timestamp?: number;
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    attachments?: MessengerAttachment[];
  };
}

interface MessengerWebhookBody {
  object?: string;
  entry?: { id?: string; messaging?: MessengerEvent[] }[];
}

// ---------------------------------------------------------------
// GET — subscription handshake
// ---------------------------------------------------------------
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get('hub.mode');
    const challenge = searchParams.get('hub.challenge');
    const verifyToken = searchParams.get('hub.verify_token');

    if (mode !== 'subscribe' || !challenge || !verifyToken) {
      return new NextResponse('Bad Request', { status: 400 });
    }

    // The token is stored encrypted, so every candidate row is decrypted
    // and compared. Plaintext is also accepted for rows written before
    // encryption, matching the Instagram route's behaviour.
    const { data: configs } = await supabaseAdmin()
      .from('facebook_config')
      .select('verify_token');

    for (const config of configs ?? []) {
      if (!config.verify_token) continue;
      let stored = config.verify_token as string;
      try {
        stored = decrypt(config.verify_token);
      } catch {
        // Not encrypted — fall through to the raw comparison.
      }
      if (stored === verifyToken || config.verify_token === verifyToken) {
        return new NextResponse(challenge, { status: 200 });
      }
    }

    return new NextResponse('Forbidden', { status: 403 });
  } catch (err) {
    console.error('[Facebook webhook] verification error:', err);
    return new NextResponse('Server Error', { status: 500 });
  }
}

/**
 * Verify Meta's payload signature.
 *
 * Returns false when no app secret is stored — failing closed. An
 * unverified webhook is a write endpoint for anyone who guesses the
 * URL, and this one creates contacts and messages.
 */
function verifySignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header?.startsWith('sha256=')) return false;

  const expected = crypto
    .createHmac('sha256', appSecret)
    .update(rawBody, 'utf8')
    .digest('hex');
  const received = header.slice('sha256='.length);

  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(received, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ---------------------------------------------------------------
// POST — inbound events
// ---------------------------------------------------------------
export async function POST(request: Request) {
  // Read the body as text: the signature covers the exact bytes, so
  // re-serialising parsed JSON would not reproduce the same digest.
  const raw = await request.text();

  let body: MessengerWebhookBody;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const signature = request.headers.get('x-hub-signature-256');

  // The Page this delivery is addressed to determines whose app secret
  // verifies it, so resolve the config before trusting anything.
  const pageId = body.entry?.[0]?.id ?? null;
  if (!pageId) {
    return NextResponse.json({ status: 'ignored' }, { status: 200 });
  }

  const { data: config } = await supabaseAdmin()
    .from('facebook_config')
    .select('*')
    .eq('page_id', pageId)
    .maybeSingle();

  if (!config) {
    // Unknown Page — accept so Meta stops retrying, but write nothing.
    return NextResponse.json({ status: 'unknown_page' }, { status: 200 });
  }

  let appSecret: string | null = null;
  if (config.app_secret) {
    try {
      appSecret = decrypt(config.app_secret);
    } catch {
      appSecret = null;
    }
  }
  appSecret = appSecret || process.env.META_APP_SECRET || null;

  if (!appSecret || !verifySignature(raw, signature, appSecret)) {
    console.warn('[Facebook webhook] signature rejected for page', pageId);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  // Meta retries anything slower than a few seconds, so acknowledge
  // immediately and do the work after the response.
  after(async () => {
    try {
      await processFacebookWebhook(body, config);
    } catch (err) {
      console.error('[Facebook webhook] process error:', err);
    }
  });

  return NextResponse.json({ status: 'received' }, { status: 200 });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function processFacebookWebhook(body: MessengerWebhookBody, config: any) {
  const accountId = config.account_id as string;
  const projectId = config.project_id as string;
  const configOwnerUserId = config.user_id as string;
  const pageId = config.page_id as string;

  let pageToken: string | null = null;
  if (config.access_token) {
    try {
      pageToken = decrypt(config.access_token);
    } catch {
      pageToken = null;
    }
  }

  for (const entry of body.entry ?? []) {
    for (const item of entry.messaging ?? []) {
      if (!item.message) continue;

      // Echoes are our own outbound messages coming back; the send route
      // already recorded them, so ingesting these would duplicate them.
      if (item.message.is_echo) continue;

      const senderId = item.sender?.id;
      if (!senderId || senderId === pageId) continue;

      // 1. Resolve or create the contact
      let senderName = `Facebook User (${senderId.slice(0, 6)})`;
      let avatarUrl: string | null = null;

      if (pageToken) {
        const profile = await getFacebookUserProfile(pageToken, senderId);
        if (profile) {
          if (profile.name) senderName = profile.name;
          if (profile.profilePic) avatarUrl = profile.profilePic;
        }
      }

      let contactId: string;
      const { data: existingContact } = await supabaseAdmin()
        .from('contacts')
        .select('id')
        .eq('project_id', projectId)
        .eq('phone', `fb:${senderId}`)
        .maybeSingle();

      if (existingContact) {
        contactId = existingContact.id;
      } else {
        const { data: newContact, error: contactErr } = await supabaseAdmin()
          .from('contacts')
          .insert({
            account_id: accountId,
            project_id: projectId,
            user_id: configOwnerUserId,
            name: senderName,
            // `phone` is NOT NULL in this WhatsApp-first schema; the
            // synthetic value mirrors the Instagram channel's `ig:` form
            // and stays outside the phone dedup index.
            phone: `fb:${senderId}`,
            avatar_url: avatarUrl,
            channel: 'facebook',
          })
          .select('id')
          .single();

        if (contactErr || !newContact) {
          console.error('[Facebook webhook] failed to create contact:', contactErr);
          continue;
        }
        contactId = newContact.id;
      }

      // 2. Resolve or create the conversation
      let conversationId: string;
      const { data: existingConv } = await supabaseAdmin()
        .from('conversations')
        .select('id, unread_count')
        .eq('project_id', projectId)
        .eq('contact_id', contactId)
        .eq('channel', 'facebook')
        .maybeSingle();

      if (existingConv) {
        conversationId = existingConv.id;
      } else {
        const { data: newConv, error: convErr } = await supabaseAdmin()
          .from('conversations')
          .insert({
            account_id: accountId,
            project_id: projectId,
            contact_id: contactId,
            user_id: configOwnerUserId,
            status: 'open',
            channel: 'facebook',
          })
          .select('id, unread_count')
          .single();

        if (convErr || !newConv) {
          console.error('[Facebook webhook] failed to create conversation:', convErr);
          continue;
        }
        conversationId = newConv.id;
      }

      // 3. Parse the message
      const msg = item.message;
      const text = msg.text || null;
      let mediaUrl: string | null = null;
      let contentType = 'text';

      if (msg.attachments && msg.attachments.length > 0) {
        const att = msg.attachments[0];
        mediaUrl = att.payload?.url || null;
        if (att.type === 'image' || att.type === 'video' || att.type === 'audio') {
          contentType = att.type;
        } else {
          // The content_type CHECK constraint has no 'file' member.
          contentType = 'document';
        }
      }

      const occurredAt = new Date(item.timestamp || Date.now()).toISOString();

      // 4. Insert the message
      const { error: msgErr } = await supabaseAdmin()
        .from('messages')
        .insert({
          conversation_id: conversationId,
          project_id: projectId,
          sender_type: 'customer',
          content_type: contentType,
          content_text: text,
          media_url: mediaUrl,
          message_id: msg.mid,
          status: 'delivered',
          channel: 'facebook',
          created_at: occurredAt,
        });

      if (msgErr) {
        console.error('[Facebook webhook] failed to insert message:', msgErr);
        continue;
      }

      // 5. Refresh the inbox preview
      await supabaseAdmin()
        .from('conversations')
        .update({
          last_message_text:
            text || (mediaUrl ? `[${contentType}]` : '[Facebook Message]'),
          last_message_at: occurredAt,
          unread_count: (existingConv?.unread_count || 0) + 1,
          updated_at: new Date().toISOString(),
          channel: 'facebook',
        })
        .eq('id', conversationId);

      // 6. Downstream engines — same set the other channels dispatch to.
      if (text) {
        // The flow runner dedupes on meta_message_id to survive Meta's
        // retries. Without a mid there is no idempotency key, so skip
        // rather than invent one and risk advancing a run twice.
        if (msg.mid) {
          void dispatchInboundToFlows({
            accountId,
            projectId,
            userId: configOwnerUserId,
            contactId,
            conversationId,
            message: { kind: 'text', text, meta_message_id: msg.mid },
            isFirstInboundMessage: !existingConv,
          });
        }

        void runAutomationsForTrigger({
          accountId,
          projectId,
          triggerType: 'new_message_received',
          contactId,
          context: { message_text: text, conversation_id: conversationId },
        });

        void dispatchInboundToAiReply({
          accountId,
          projectId,
          conversationId,
          contactId,
          configOwnerUserId,
        });

        void dispatchWebhookEvent(
          supabaseAdmin(),
          accountId,
          projectId,
          'message.received',
          {
            project_id: projectId,
            conversation_id: conversationId,
            contact_id: contactId,
            text,
            channel: 'facebook',
          },
        );
      }
    }
  }
}
