import { NextRequest, NextResponse } from 'next/server';
import { requireProjectRole } from '@/lib/auth/project';
import { toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { decrypt } from '@/lib/whatsapp/encryption';
import { sendFacebookMessage } from '@/lib/facebook/meta-client';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireProjectRole('agent');
    const body = (await request.json().catch(() => null)) as {
      recipientPsid?: string;
      recipientName?: string;
      message?: string;
      mediaUrl?: string;
    } | null;

    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const recipientPsid = (body.recipientPsid || '').trim().replace(/^fb:/i, '');
    const messageText = (body.message || '').trim();
    const mediaUrl = (body.mediaUrl || '').trim();

    if (!recipientPsid) {
      return NextResponse.json(
        { error: 'Recipient Facebook Page-Scoped ID (PSID) is required.' },
        { status: 400 },
      );
    }

    if (!messageText && !mediaUrl) {
      return NextResponse.json(
        { error: 'A message or media URL is required.' },
        { status: 400 },
      );
    }

    const db = supabaseAdmin();

    const { data: config, error: configErr } = await db
      .from('facebook_config')
      .select('access_token, status, account_id, user_id')
      .eq('project_id', ctx.projectId)
      .eq('status', 'connected')
      .maybeSingle();

    if (configErr || !config?.access_token) {
      return NextResponse.json(
        { error: 'Facebook is not connected for this project.' },
        { status: 400 },
      );
    }

    const pageToken = decrypt(config.access_token);

    // Send to Facebook
    const sendRes = await sendFacebookMessage({
      pageAccessToken: pageToken,
      recipientPsid,
      text: messageText || undefined,
      mediaUrl: mediaUrl || undefined,
    });

    if (!sendRes.success) {
      return NextResponse.json(
        { error: sendRes.error || 'Failed to send Facebook Messenger message' },
        { status: 502 },
      );
    }

    // Resolve or create Contact
    let contactId: string;
    const { data: existingContact } = await db
      .from('contacts')
      .select('id')
      .eq('project_id', ctx.projectId)
      .eq('phone', `fb:${recipientPsid}`)
      .maybeSingle();

    if (existingContact) {
      contactId = existingContact.id;
    } else {
      const { data: newContact } = await db
        .from('contacts')
        .insert({
          account_id: config.account_id || ctx.accountId,
          project_id: ctx.projectId,
          user_id: config.user_id || ctx.userId,
          name: body.recipientName?.trim() || `Facebook User (${recipientPsid.slice(0, 6)})`,
          phone: `fb:${recipientPsid}`,
          channel: 'facebook',
        })
        .select('id')
        .single();
      contactId = newContact?.id || '';
    }

    // Resolve or create Conversation
    let conversationId: string | null = null;
    if (contactId) {
      const { data: existingConv } = await db
        .from('conversations')
        .select('id')
        .eq('project_id', ctx.projectId)
        .eq('contact_id', contactId)
        .eq('channel', 'facebook')
        .maybeSingle();

      if (existingConv) {
        conversationId = existingConv.id;
      } else {
        const { data: newConv } = await db
          .from('conversations')
          .insert({
            account_id: config.account_id || ctx.accountId,
            project_id: ctx.projectId,
            contact_id: contactId,
            user_id: config.user_id || ctx.userId,
            status: 'open',
            channel: 'facebook',
          })
          .select('id')
          .single();
        conversationId = newConv?.id || null;
      }
    }

    const sentAt = new Date().toISOString();

    if (conversationId) {
      await db.from('messages').insert({
        conversation_id: conversationId,
        project_id: ctx.projectId,
        sender_type: 'agent',
        sender_id: ctx.userId,
        content_type: mediaUrl ? 'image' : 'text',
        content_text: messageText || null,
        media_url: mediaUrl || null,
        message_id: sendRes.messageId ?? null,
        status: 'sent',
        channel: 'facebook',
        created_at: sentAt,
      });

      await db
        .from('conversations')
        .update({
          last_message_text: messageText || '[Attachment]',
          last_message_at: sentAt,
          updated_at: sentAt,
        })
        .eq('id', conversationId);
    }

    return NextResponse.json({
      success: true,
      messageId: sendRes.messageId,
      conversationId,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

