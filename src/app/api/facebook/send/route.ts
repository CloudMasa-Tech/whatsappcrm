/**
 * POST /api/facebook/send
 *
 * Send a Messenger reply from the connected Page and record it on the
 * conversation, so the agent sees their own message in the thread.
 *
 * The recipient is derived from the conversation's contact, never taken
 * from the request: accepting a caller-supplied PSID would let any
 * member of one project message a person belonging to another.
 */

import { NextResponse } from 'next/server';

import { requireProjectRole } from '@/lib/auth/project';
import { toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { decrypt } from '@/lib/whatsapp/encryption';
import { sendFacebookMessage } from '@/lib/facebook/meta-client';

const MAX_TEXT_LEN = 2000;

export async function POST(request: Request) {
  let ctx;
  try {
    ctx = await requireProjectRole('agent');
  } catch (err) {
    return toErrorResponse(err);
  }

  const limit = checkRateLimit(`facebook:send:${ctx.userId}`, RATE_LIMITS.adminAction);
  if (!limit.success) return rateLimitResponse(limit);

  const body = (await request.json().catch(() => null)) as {
    conversationId?: unknown;
    text?: unknown;
    mediaUrl?: unknown;
    mediaType?: unknown;
  } | null;

  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const conversationId =
    typeof body.conversationId === 'string' ? body.conversationId.trim() : '';
  if (!conversationId) {
    return NextResponse.json({ error: 'conversationId is required' }, { status: 400 });
  }

  const text = typeof body.text === 'string' ? body.text.trim() : '';
  const mediaUrl = typeof body.mediaUrl === 'string' ? body.mediaUrl.trim() : '';

  if (!text && !mediaUrl) {
    return NextResponse.json(
      { error: 'Either text or mediaUrl is required' },
      { status: 400 },
    );
  }
  if (text.length > MAX_TEXT_LEN) {
    return NextResponse.json(
      { error: `Message must be ${MAX_TEXT_LEN} characters or fewer` },
      { status: 400 },
    );
  }

  const db = supabaseAdmin();

  // Scope by project: the service-role client bypasses RLS, so this
  // equality is the tenant isolation.
  const { data: conversation } = await db
    .from('conversations')
    .select('id, channel, contact:contacts(id, phone, name)')
    .eq('id', conversationId)
    .eq('project_id', ctx.projectId)
    .maybeSingle();

  if (!conversation) {
    return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
  }
  if (conversation.channel !== 'facebook') {
    return NextResponse.json(
      { error: 'This conversation is not a Facebook thread' },
      { status: 400 },
    );
  }

  const contact = Array.isArray(conversation.contact)
    ? conversation.contact[0]
    : conversation.contact;

  // The webhook stores the PSID as `fb:<psid>` in the phone column.
  const psid =
    typeof contact?.phone === 'string' && contact.phone.startsWith('fb:')
      ? contact.phone.slice(3)
      : null;

  if (!psid) {
    return NextResponse.json(
      { error: 'This contact has no Facebook page-scoped id' },
      { status: 400 },
    );
  }

  const { data: config } = await db
    .from('facebook_config')
    .select('access_token, status')
    .eq('project_id', ctx.projectId)
    .maybeSingle();

  if (!config?.access_token || config.status !== 'connected') {
    return NextResponse.json(
      { error: 'Facebook is not connected for this project' },
      { status: 400 },
    );
  }

  let pageToken: string;
  try {
    pageToken = decrypt(config.access_token);
  } catch {
    return NextResponse.json(
      { error: 'Stored Facebook credentials could not be decrypted' },
      { status: 500 },
    );
  }

  const result = await sendFacebookMessage({
    pageAccessToken: pageToken,
    recipientPsid: psid,
    text: text || undefined,
    mediaUrl: mediaUrl || undefined,
    mediaType:
      body.mediaType === 'video' || body.mediaType === 'audio' || body.mediaType === 'file'
        ? body.mediaType
        : 'image',
  });

  if (!result.success) {
    // Record the failure so the thread shows what happened rather than
    // silently dropping the agent's message.
    await db.from('messages').insert({
      conversation_id: conversationId,
      project_id: ctx.projectId,
      sender_type: 'agent',
      sender_id: ctx.userId,
      content_type: mediaUrl ? 'image' : 'text',
      content_text: text || null,
      media_url: mediaUrl || null,
      status: 'failed',
      channel: 'facebook',
    });

    // Surface the credential problem on the config row too, so the
    // readiness strip stops claiming the channel is healthy.
    if (/token|OAuth|permission/i.test(result.error ?? '')) {
      await db
        .from('facebook_config')
        .update({ status: 'error', last_error: result.error ?? null })
        .eq('project_id', ctx.projectId);
    }

    return NextResponse.json(
      { error: result.error ?? 'Failed to send the message' },
      { status: 502 },
    );
  }

  const sentAt = new Date().toISOString();

  const { data: message } = await db
    .from('messages')
    .insert({
      conversation_id: conversationId,
      project_id: ctx.projectId,
      sender_type: 'agent',
      sender_id: ctx.userId,
      content_type: mediaUrl ? 'image' : 'text',
      content_text: text || null,
      media_url: mediaUrl || null,
      message_id: result.messageId ?? null,
      status: 'sent',
      channel: 'facebook',
      created_at: sentAt,
    })
    .select('id')
    .single();

  await db
    .from('conversations')
    .update({
      last_message_text: text || '[Attachment]',
      last_message_at: sentAt,
      updated_at: sentAt,
    })
    .eq('id', conversationId);

  return NextResponse.json({
    success: true,
    messageId: result.messageId ?? null,
    id: message?.id ?? null,
  });
}
