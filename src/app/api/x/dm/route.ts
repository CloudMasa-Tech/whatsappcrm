import { NextResponse } from 'next/server';
import { toErrorResponse } from '@/lib/auth/account';
import { requireProjectRole } from '@/lib/auth/project';
import { checkRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  lookupXUserByUsername,
  normalizeXHandle,
  sendXDirectMessage,
  XApiError,
} from '@/lib/x/client';
import { loadActiveXConfig } from '@/lib/x/config-store';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const ctx = await requireProjectRole('agent');
    const limit = checkRateLimit(`x:dm:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const cfg = await loadActiveXConfig(ctx.projectId);
    if (!cfg) {
      return NextResponse.json(
        { error: 'X account is not connected for this project.' },
        { status: 400 },
      );
    }

    const body = (await request.json().catch(() => null)) as {
      recipient?: unknown;
      recipients?: unknown;
      message?: unknown;
    } | null;

    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message) {
      return NextResponse.json({ error: 'Message text is required' }, { status: 400 });
    }

    // Support single recipient or array/comma-separated campaign list
    const rawRecipients: string[] = [];
    if (typeof body.recipient === 'string' && body.recipient.trim()) {
      rawRecipients.push(body.recipient.trim());
    }
    if (Array.isArray(body.recipients)) {
      for (const r of body.recipients) {
        if (typeof r === 'string' && r.trim()) rawRecipients.push(r.trim());
      }
    }

    const cleanHandles: string[] = [];
    for (const raw of rawRecipients) {
      for (const part of raw.split(/[\s,;]+/)) {
        const h = normalizeXHandle(part);
        if (h && !cleanHandles.includes(h)) cleanHandles.push(h);
      }
    }

    if (cleanHandles.length === 0) {
      return NextResponse.json(
        { error: 'Please provide at least one valid X username (e.g. @username).' },
        { status: 400 },
      );
    }

    const db = supabaseAdmin();
    const results: Array<{
      username: string;
      status: 'sent' | 'failed';
      messageId?: string;
      conversationId?: string;
      error?: string;
    }> = [];

    for (const username of cleanHandles.slice(0, 50)) {
      try {
        // 1. Resolve contact & participant ID
        let contactId: string | null = null;
        let participantId: string | null = null;
        let displayName = `@${username}`;

        const { data: existingContact } = await db
          .from('contacts')
          .select('id, name, x_user_id, x_username')
          .eq('project_id', ctx.projectId)
          .ilike('x_username', username)
          .maybeSingle();

        if (existingContact) {
          contactId = existingContact.id;
          participantId = existingContact.x_user_id;
          if (existingContact.name) displayName = existingContact.name;
        }

        if (!participantId) {
          const userMeta = await lookupXUserByUsername(cfg.accessToken, username);
          if (!userMeta?.id) {
            results.push({
              username,
              status: 'failed',
              error: `X user @${username} not found or account is deactivated.`,
            });
            continue;
          }
          participantId = userMeta.id;
          displayName = userMeta.name || `@${username}`;

          if (contactId) {
            await db
              .from('contacts')
              .update({
                x_user_id: userMeta.id,
                name: displayName,
                x_url: `https://x.com/${userMeta.username}`,
              })
              .eq('id', contactId);
          } else {
            const { data: newContact, error: insContactErr } = await db
              .from('contacts')
              .insert({
                account_id: ctx.accountId,
                project_id: ctx.projectId,
                user_id: ctx.userId,
                name: displayName,
                phone: `x:${username}`,
                channel: 'x',
                x_username: username,
                x_user_id: userMeta.id,
                x_url: `https://x.com/${userMeta.username}`,
                source: 'x_dm',
              })
              .select('id')
              .single();

            if (!insContactErr && newContact) {
              contactId = newContact.id;
            }
          }
        }

        // 2. Resolve or create Conversation
        let conversationId: string | null = null;
        if (contactId) {
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
            const { data: newConv } = await db
              .from('conversations')
              .insert({
                account_id: ctx.accountId,
                project_id: ctx.projectId,
                user_id: ctx.userId,
                contact_id: contactId,
                channel: 'x',
                status: 'open',
                last_message_text: message,
                last_message_at: new Date().toISOString(),
                unread_count: 0,
              })
              .select('id')
              .single();
            conversationId = newConv?.id ?? null;
          }
        }

        // 3. Send via X API v2
        const sendRes = await sendXDirectMessage({
          accessToken: cfg.accessToken,
          participantId: participantId!,
          text: message,
        });

        const nowIso = new Date().toISOString();
        if (conversationId) {
          await db.from('messages').insert({
            conversation_id: conversationId,
            project_id: ctx.projectId,
            sender_type: 'agent',
            content_type: 'text',
            content_text: message,
            message_id: sendRes.dmEventId,
            status: 'sent',
            channel: 'x',
            created_at: nowIso,
          });

          await db
            .from('conversations')
            .update({
              last_message_text: message,
              last_message_at: nowIso,
              updated_at: nowIso,
            })
            .eq('id', conversationId);
        }

        results.push({
          username,
          status: 'sent',
          messageId: sendRes.dmEventId,
          conversationId: conversationId || undefined,
        });
      } catch (itemErr) {
        results.push({
          username,
          status: 'failed',
          error:
            itemErr instanceof XApiError
              ? itemErr.message
              : itemErr instanceof Error
                ? itemErr.message
                : 'Failed to send DM',
        });
      }
    }

    const sentCount = results.filter((r) => r.status === 'sent').length;
    const failedCount = results.filter((r) => r.status === 'failed').length;

    return NextResponse.json({
      success: sentCount > 0,
      total: cleanHandles.length,
      sentCount,
      failedCount,
      results,
    });
  } catch (err) {
    if (err instanceof XApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status || 400 });
    }
    return toErrorResponse(err);
  }
}

