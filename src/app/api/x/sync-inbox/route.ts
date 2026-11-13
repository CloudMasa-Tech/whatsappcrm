import { NextResponse } from 'next/server';
import { toErrorResponse } from '@/lib/auth/account';
import { requireProjectRole } from '@/lib/auth/project';
import { checkRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { fetchXDirectMessages, XApiError } from '@/lib/x/client';
import { loadActiveXConfig } from '@/lib/x/config-store';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const ctx = await requireProjectRole('agent');
    const limit = checkRateLimit(`x:sync-inbox:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const cfg = await loadActiveXConfig(ctx.projectId);
    if (!cfg || !cfg.xUserId) {
      return NextResponse.json(
        { error: 'X account is not connected for this project.' },
        { status: 400 },
      );
    }

    const events = await fetchXDirectMessages({
      accessToken: cfg.accessToken,
      maxResults: 50,
    });

    const db = supabaseAdmin();
    let messagesIngested = 0;
    const touchedConvs = new Set<string>();

    for (const ev of events) {
      if (!ev.text) continue;

      const isOutbound = ev.senderId === cfg.xUserId;
      const otherUserId = isOutbound ? ev.recipientId || ev.conversationId : ev.senderId;
      if (!otherUserId) continue;

      const otherUsername = isOutbound
        ? null
        : ev.senderUsername || otherUserId;
      const otherName = isOutbound
        ? null
        : ev.senderName || (otherUsername ? `@${otherUsername}` : 'X User');

      // 1. Resolve Contact
      let contactId: string | null = null;
      const { data: existingContact } = await db
        .from('contacts')
        .select('id, x_user_id, x_username')
        .eq('project_id', ctx.projectId)
        .eq('x_user_id', otherUserId)
        .maybeSingle();

      if (existingContact) {
        contactId = existingContact.id;
      } else {
        const { data: createdContact } = await db
          .from('contacts')
          .insert({
            account_id: ctx.accountId,
            project_id: ctx.projectId,
            user_id: ctx.userId,
            name: otherName || `@${otherUserId}`,
            phone: `x:${otherUsername || otherUserId}`,
            channel: 'x',
            x_user_id: otherUserId,
            x_username: otherUsername,
            x_url: otherUsername ? `https://x.com/${otherUsername}` : null,
            source: 'x_dm_sync',
          })
          .select('id')
          .maybeSingle();
        contactId = createdContact?.id ?? null;
      }

      if (!contactId) continue;

      // 2. Resolve Conversation
      let conversationId: string | null = null;
      const { data: existingConv } = await db
        .from('conversations')
        .select('id')
        .eq('project_id', ctx.projectId)
        .eq('contact_id', contactId)
        .eq('channel', 'x')
        .maybeSingle();

      if (existingConv) {
        conversationId = existingConv.id;
      } else {
        const { data: createdConv } = await db
          .from('conversations')
          .insert({
            account_id: ctx.accountId,
            project_id: ctx.projectId,
            user_id: ctx.userId,
            contact_id: contactId,
            channel: 'x',
            status: 'open',
            last_message_text: ev.text,
            last_message_at: ev.createdAt || new Date().toISOString(),
            unread_count: isOutbound ? 0 : 1,
          })
          .select('id')
          .maybeSingle();
        conversationId = createdConv?.id ?? null;
      }

      if (!conversationId) continue;
      touchedConvs.add(conversationId);

      // 3. Deduplicate & insert message
      const { data: existingMsg } = await db
        .from('messages')
        .select('id')
        .eq('conversation_id', conversationId)
        .eq('message_id', ev.id)
        .maybeSingle();

      if (!existingMsg) {
        const { error: insMsgErr } = await db.from('messages').insert({
          conversation_id: conversationId,
          project_id: ctx.projectId,
          sender_type: isOutbound ? 'agent' : 'customer',
          content_type: 'text',
          content_text: ev.text,
          message_id: ev.id,
          status: 'delivered',
          channel: 'x',
          created_at: ev.createdAt || new Date().toISOString(),
        });
        if (!insMsgErr) messagesIngested++;
      }
    }

    return NextResponse.json({
      success: true,
      eventsSynced: events.length,
      threadsSynced: touchedConvs.size,
      messagesIngested,
    });
  } catch (err) {
    if (err instanceof XApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status || 400 });
    }
    return toErrorResponse(err);
  }
}
