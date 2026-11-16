import { NextResponse } from 'next/server';
import { requireProjectRole } from '@/lib/auth/project';
import { toErrorResponse } from '@/lib/auth/account';
import { decrypt } from '@/lib/whatsapp/encryption';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { fetchFacebookConversations } from '@/lib/facebook/meta-client';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const ctx = await requireProjectRole('agent');
    const db = supabaseAdmin();

    const { data: config, error: configError } = await db
      .from('facebook_config')
      .select('account_id, project_id, user_id, access_token, page_id, status')
      .eq('project_id', ctx.projectId)
      .eq('status', 'connected')
      .maybeSingle();

    if (configError || !config) {
      return NextResponse.json(
        { error: 'Facebook is not connected for this project.' },
        { status: 400 },
      );
    }

    if (!config.access_token || !config.page_id) {
      return NextResponse.json(
        { error: 'Facebook Page credentials or Page ID are missing.' },
        { status: 400 },
      );
    }

    const decryptedToken = decrypt(config.access_token);
    const threads = await fetchFacebookConversations(
      decryptedToken,
      config.page_id,
      20,
    );

    let threadsSynced = 0;
    let messagesIngested = 0;

    for (const thread of threads) {
      threadsSynced++;

      // 1. Find or create Contact
      let contactId: string;
      const { data: existingContact } = await db
        .from('contacts')
        .select('id')
        .eq('project_id', ctx.projectId)
        .eq('phone', `fb:${thread.participantId}`)
        .maybeSingle();

      if (existingContact) {
        contactId = existingContact.id;
      } else {
        const { data: newContact, error: contactErr } = await db
          .from('contacts')
          .insert({
            account_id: config.account_id || ctx.accountId,
            project_id: ctx.projectId,
            user_id: config.user_id || ctx.userId,
            name: thread.participantName,
            phone: `fb:${thread.participantId}`,
            channel: 'facebook',
          })
          .select('id')
          .single();

        if (contactErr || !newContact) {
          console.error('[Facebook Sync Inbox] failed to create contact:', contactErr);
          continue;
        }
        contactId = newContact.id;
      }

      // 2. Find or create Conversation
      let conversationId: string;
      const { data: existingConv } = await db
        .from('conversations')
        .select('id, unread_count')
        .eq('project_id', ctx.projectId)
        .eq('contact_id', contactId)
        .eq('channel', 'facebook')
        .maybeSingle();

      if (existingConv) {
        conversationId = existingConv.id;
      } else {
        const { data: newConv, error: convErr } = await db
          .from('conversations')
          .insert({
            account_id: config.account_id || ctx.accountId,
            project_id: ctx.projectId,
            contact_id: contactId,
            user_id: config.user_id || ctx.userId,
            status: 'open',
            channel: 'facebook',
          })
          .select('id, unread_count')
          .single();

        if (convErr || !newConv) {
          console.error('[Facebook Sync Inbox] failed to create conversation:', convErr);
          continue;
        }
        conversationId = newConv.id;
      }

      // 3. Ingest messages
      let lastText: string | null = null;
      let lastTime: string | null = null;

      for (const msg of thread.messages) {
        const { data: existingMsg } = await db
          .from('messages')
          .select('id')
          .eq('message_id', msg.id)
          .maybeSingle();

        if (!existingMsg) {
          const { error: msgErr } = await db.from('messages').insert({
            conversation_id: conversationId,
            project_id: ctx.projectId,
            sender_type: msg.isFromPage ? 'agent' : 'customer',
            content_type: msg.contentType || 'text',
            content_text: msg.text || null,
            media_url: msg.mediaUrl || null,
            message_id: msg.id,
            status: msg.isFromPage ? 'sent' : 'delivered',
            channel: 'facebook',
            created_at: msg.createdTime,
          });

          if (!msgErr) {
            messagesIngested++;
          }
        }

        lastText = msg.text || (msg.mediaUrl ? `[${msg.contentType || 'attachment'}]` : lastText);
        lastTime = msg.createdTime;
      }

      // 4. Update conversation timestamp
      if (lastTime) {
        await db
          .from('conversations')
          .update({
            last_message_text: lastText || '[Facebook Message]',
            last_message_at: lastTime,
            updated_at: new Date().toISOString(),
          })
          .eq('id', conversationId);
      }
    }

    return NextResponse.json({
      success: true,
      threadsSynced,
      messagesIngested,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

