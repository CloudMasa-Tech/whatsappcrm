import type { SupabaseClient } from '@supabase/supabase-js';
import {
  lookupXUserByUsername,
  normalizeXHandle,
  sendXDirectMessage,
  XApiError,
} from './client';
import { loadActiveXConfig } from './config-store';

export class XSendError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 400, code = 'x_send_error') {
    super(message);
    this.name = 'XSendError';
    this.status = status;
    this.code = code;
  }
}

export interface SendXMessageParams {
  conversationId: string;
  projectId: string;
  accountId: string;
  userId?: string;
  contentText?: string | null;
}

export async function sendXDirectMessageToConversation(
  db: SupabaseClient,
  params: SendXMessageParams,
): Promise<{ messageId: string; externalId: string }> {
  const { conversationId, projectId, contentText } = params;

  const trimmedText = contentText?.trim() || '';
  if (!trimmedText) {
    throw new XSendError('Message must have text content.', 400, 'empty_message');
  }

  const cfg = await loadActiveXConfig(projectId);
  if (!cfg) {
    throw new XSendError('X account is not connected for this project.', 400, 'not_connected');
  }

  // 1. Resolve contact to find x_user_id or x_username
  const { data: conv } = await db
    .from('conversations')
    .select('id, contact_id, contacts(id, name, x_user_id, x_username)')
    .eq('id', conversationId)
    .eq('project_id', projectId)
    .maybeSingle();

  if (!conv || !conv.contacts) {
    throw new XSendError('Conversation or recipient contact not found.', 404, 'contact_not_found');
  }

  const contact = Array.isArray(conv.contacts) ? conv.contacts[0] : conv.contacts;
  let participantId = contact?.x_user_id;

  // If x_user_id is not cached, look it up by username
  if (!participantId && contact?.x_username) {
    const lookedUp = await lookupXUserByUsername(cfg.accessToken, contact.x_username);
    if (lookedUp?.id) {
      participantId = lookedUp.id;
      await db
        .from('contacts')
        .update({
          x_user_id: lookedUp.id,
          name: contact.name || lookedUp.name,
          x_url: `https://x.com/${lookedUp.username}`,
        })
        .eq('id', contact.id);
    }
  }

  if (!participantId) {
    throw new XSendError(
      `Could not resolve recipient's X user ID for @${contact?.x_username || 'user'}.`,
      400,
      'unknown_participant',
    );
  }

  let sendResult: { dmConversationId: string; dmEventId: string };
  try {
    sendResult = await sendXDirectMessage({
      accessToken: cfg.accessToken,
      participantId,
      text: trimmedText,
    });
  } catch (err) {
    if (err instanceof XApiError) {
      throw new XSendError(err.message, err.status, 'x_api_error');
    }
    throw new XSendError(
      err instanceof Error ? err.message : 'Failed to send X Direct Message',
      502,
    );
  }

  // 2. Insert into messages table
  const nowIso = new Date().toISOString();
  const { data: inserted, error: insertErr } = await db
    .from('messages')
    .insert({
      conversation_id: conversationId,
      project_id: projectId,
      sender_type: 'agent',
      content_type: 'text',
      content_text: trimmedText,
      message_id: sendResult.dmEventId,
      status: 'sent',
      channel: 'x',
      created_at: nowIso,
    })
    .select('id')
    .single();

  if (insertErr || !inserted) {
    console.error('[X send] message insertion failed:', insertErr);
  }

  // 3. Update conversation last message preview
  await db
    .from('conversations')
    .update({
      last_message_text: trimmedText,
      last_message_at: nowIso,
      updated_at: nowIso,
      channel: 'x',
    })
    .eq('id', conversationId)
    .eq('project_id', projectId);

  return {
    messageId: inserted?.id || sendResult.dmEventId,
    externalId: sendResult.dmEventId,
  };
}

