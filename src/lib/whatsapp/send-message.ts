// ============================================================
// Outbound message send — the core that both the dashboard's
// `/api/whatsapp/send` route and the public `/api/v1/messages`
// endpoint call.
//
// Given a conversation and message params, this:
//   1. validates the params for the message type,
//   2. loads the conversation + contact + WhatsApp config,
//   3. sends to Meta (with phone-variant retry + contact auto-fix),
//   4. persists the message + updates the conversation,
//   5. pauses any active Flow run for the contact (agent stepped in).
//
// It is transport-agnostic: it takes a `SupabaseClient` and an
// `accountId` and throws `SendMessageError` on failure. The callers
// own auth, rate-limiting, body parsing, and mapping the error to
// their respective response shapes (internal `{ error }` vs the v1
// envelope). Behaviour is identical to the original inline route —
// this is a straight extraction so the public endpoint can reuse it
// without duplicating ~250 lines of Meta plumbing.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  sendTextMessage,
  sendTemplateMessage,
  sendMediaMessage,
  sendInteractiveButtons,
  sendInteractiveList,
  type MediaKind,
} from '@/lib/whatsapp/meta-api';
import {
  validateInteractivePayload,
  interactivePayloadPreviewText,
  type InteractiveMessagePayload,
} from '@/lib/whatsapp/interactive';
import { decrypt, encrypt, isLegacyFormat } from '@/lib/whatsapp/encryption';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils';
import type { MessageTemplate } from '@/types';
import { isMessageTemplate } from '@/lib/whatsapp/template-row-guard';
import { GatewayError, sendViaGateway } from '@/lib/channels/gateway';
import { resolveProjectChannel } from '@/lib/channels/resolve';
import {
  supportsMessageKind,
  unsupportedReason,
  type ChannelType,
} from '@/lib/channels/types';

export const MEDIA_KINDS = ['image', 'video', 'document', 'audio'] as const;
export const VALID_MESSAGE_TYPES = [
  'text',
  'template',
  'interactive',
  ...MEDIA_KINDS,
] as const;

/**
 * Typed failure with a machine `code` and a suggested HTTP `status`.
 * Callers map it to their own response shape (`toErrorResponse` for
 * the dashboard route, the v1 envelope for the public endpoint).
 */
export class SendMessageError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'SendMessageError';
    this.code = code;
    this.status = status;
  }
}

export interface SendMessageParams {
  conversationId: string;
  messageType: string;
  contentText?: string | null;
  mediaUrl?: string | null;
  filename?: string | null;
  templateName?: string | null;
  templateLanguage?: string | null;
  /** Legacy positional body params (only used if messageParams.body unset). */
  templateParams?: string[];
  /** Structured template params (header/body/buttons). */
  templateMessageParams?: unknown;
  /** Structured payload for `messageType === 'interactive'`. */
  interactivePayload?: InteractiveMessagePayload | null;
  replyToMessageId?: string | null;
}

export interface SendMessageResult {
  /** Our `messages.id` (the persisted row). */
  messageId: string;
  /** Meta's `wamid` for the delivered message. */
  whatsappMessageId: string;
}

/**
 * Send a message in an existing conversation and persist it.
 *
 * `db` may be an RLS-scoped user client (dashboard) or the service-
 * role client (public API) — every query is filtered by `accountId`
 * either way, so tenancy holds regardless of which client is passed.
 */
/**
 * Validate the message-shape params (type, required content, caption
 * cap) independently of any DB state, throwing `SendMessageError` on a
 * bad payload. Exported so a caller can reject a malformed request
 * *before* it finds-or-creates a contact/conversation — otherwise an
 * invalid payload leaves an orphan empty conversation behind. The send
 * core calls this too, so validation can't be skipped.
 */
export function validateSendMessageParams(params: {
  messageType: string;
  contentText?: string | null;
  mediaUrl?: string | null;
  templateName?: string | null;
  interactivePayload?: InteractiveMessagePayload | null;
}): void {
  const { messageType, contentText, mediaUrl, templateName, interactivePayload } =
    params;

  if (!messageType) {
    throw new SendMessageError('bad_request', 'message_type is required', 400);
  }

  const isMediaKind = (MEDIA_KINDS as readonly string[]).includes(messageType);

  if (!(VALID_MESSAGE_TYPES as readonly string[]).includes(messageType)) {
    throw new SendMessageError(
      'bad_request',
      `Unsupported message_type "${messageType}"`,
      400
    );
  }

  if (messageType === 'text' && !contentText) {
    throw new SendMessageError(
      'bad_request',
      'content_text is required for text messages',
      400
    );
  }

  if (messageType === 'template' && !templateName) {
    throw new SendMessageError(
      'bad_request',
      'template_name is required for template messages',
      400
    );
  }

  // Interactive: validate the full structured payload against Meta's
  // limits up front so a bad payload 400s before we touch Meta.
  if (messageType === 'interactive') {
    const result = validateInteractivePayload(interactivePayload);
    if (!result.ok) {
      throw new SendMessageError('bad_request', result.error, 400);
    }
  }

  if (isMediaKind && !mediaUrl) {
    throw new SendMessageError(
      'bad_request',
      `media_url is required for ${messageType} messages`,
      400
    );
  }

  // Meta caps media captions at 1024 chars (audio carries none).
  if (
    isMediaKind &&
    messageType !== 'audio' &&
    typeof contentText === 'string' &&
    contentText.length > 1024
  ) {
    throw new SendMessageError(
      'bad_request',
      'Caption exceeds the 1024-character limit',
      400
    );
  }
}

export async function sendMessageToConversation(
  db: SupabaseClient,
  accountId: string,
  params: SendMessageParams
): Promise<SendMessageResult> {
  const {
    conversationId,
    messageType,
    contentText,
    mediaUrl,
    filename,
    templateName,
    templateLanguage,
    templateParams,
    templateMessageParams,
    interactivePayload,
    replyToMessageId,
  } = params;

  if (!conversationId) {
    throw new SendMessageError(
      'bad_request',
      'conversation_id is required',
      400
    );
  }

  validateSendMessageParams({
    messageType,
    contentText,
    mediaUrl,
    templateName,
    interactivePayload,
  });

  const isMediaKind = (MEDIA_KINDS as readonly string[]).includes(messageType);

  // Conversation + contact. Scoped by account_id, not project_id, and
  // deliberately so: the conversation row is where the project comes
  // FROM (read just below), so filtering on it here would be circular.
  // The account filter is the isolation check at this point; the
  // project it yields then scopes everything downstream.
  const { data: conversation, error: convError } = await db
    .from('conversations')
    .select('*, contact:contacts(*)')
    .eq('id', conversationId)
    .eq('account_id', accountId)
    .single();

  if (convError || !conversation) {
    throw new SendMessageError('not_found', 'Conversation not found', 404);
  }

  const contact = conversation.contact;
  if (!contact?.phone) {
    throw new SendMessageError(
      'bad_request',
      'Contact phone number not found',
      400
    );
  }

  const sanitizedPhone = sanitizePhoneForMeta(contact.phone);
  if (!isValidE164(sanitizedPhone)) {
    throw new SendMessageError(
      'bad_request',
      'Invalid phone number format',
      400
    );
  }

  // The project owning this conversation decides the transport. Taken
  // from the conversation row rather than a caller argument: it is the
  // authoritative value, and it means no call site can send a message
  // into project A over project B's connection.
  const projectId: string | null = conversation.project_id ?? null;
  if (!projectId) {
    throw new SendMessageError(
      'project_missing',
      'This conversation is not linked to a project. Re-run the database migrations (042_project_scoping.sql).',
      500
    );
  }

  const channel = await resolveProjectChannel(db, projectId);
  const channelType: ChannelType = channel?.channelType ?? 'cloud_api';

  // Refuse transport-impossible sends up front with an explanation,
  // instead of letting them fail deep inside a provider call.
  if (!supportsMessageKind(channelType, messageType)) {
    throw new SendMessageError(
      'unsupported_on_channel',
      unsupportedReason(channelType, messageType),
      400
    );
  }

  // ---- QR channel ------------------------------------------------
  // Hands off to the gateway, then falls through to the shared
  // persistence below so a QR message lands in the inbox looking
  // exactly like a Cloud API one.
  if (channelType === 'qr') {
    const { externalId } = await sendViaQrChannel({
      projectId,
      to: sanitizedPhone,
      messageType,
      contentText,
      mediaUrl,
      filename,
      replyToMessageId,
      conversationId,
      db,
    });
    return persistSentMessage({
      db,
      accountId,
      projectId,
      conversationId,
      contactId: contact.id,
      messageType,
      contentText,
      mediaUrl,
      templateName,
      interactivePayload,
      replyToMessageId,
      waMessageId: externalId,
    });
  }

  // ---- Cloud API channel ------------------------------------------
  // WhatsApp config is per PROJECT post-042 (it used to be one row per
  // account). Scoping by account_id alone would hit multiple rows the
  // moment an organisation has two Cloud API projects, and `.single()`
  // would throw PGRST116.
  const { data: config, error: configError } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('project_id', projectId)
    .single();

  if (configError || !config) {
    throw new SendMessageError(
      'whatsapp_not_configured',
      'WhatsApp not configured for this project. Connect a number in Settings first.',
      400
    );
  }

  const accessToken = decrypt(config.access_token);

  // Self-heal legacy CBC ciphertexts. Fire-and-forget; idempotent.
  if (isLegacyFormat(config.access_token)) {
    void db
      .from('whatsapp_config')
      .update({ access_token: encrypt(accessToken) })
      .eq('id', config.id)
      .then(({ error }: { error: { message: string } | null }) => {
        if (error) {
          console.warn(
            '[send-message] access_token GCM upgrade failed:',
            error.message
          );
        }
      });
  }

  // Resolve the reply target to its Meta message_id. The parent must
  // belong to this same conversation — otherwise a caller could quote
  // messages they can't see by guessing UUIDs.
  let contextMessageId: string | undefined;
  if (replyToMessageId) {
    const { data: parent, error: parentError } = await db
      .from('messages')
      .select('message_id, conversation_id')
      .eq('id', replyToMessageId)
      .eq('conversation_id', conversationId)
      .maybeSingle();

    if (parentError || !parent) {
      throw new SendMessageError(
        'bad_request',
        'reply_to_message_id not found in this conversation',
        400
      );
    }
    if (!parent.message_id) {
      console.warn(
        '[send-message] reply target has no Meta message_id; sending without context'
      );
    } else {
      contextMessageId = parent.message_id;
    }
  }

  // Template row (for header + button components). isMessageTemplate
  // guards against a malformed local row crashing the send-builder.
  let templateRow: MessageTemplate | null = null;
  if (messageType === 'template' && templateName) {
    const { data } = await db
      .from('message_templates')
      .select('*')
      // Project-scoped post-042: two projects in one organisation may
      // each hold a template of the same name against their own number.
      .eq('project_id', projectId)
      .eq('name', templateName)
      .eq('language', templateLanguage || 'en_US')
      .maybeSingle();
    if (data && !isMessageTemplate(data)) {
      throw new SendMessageError(
        'template_malformed',
        'Template row is malformed locally — run "Sync from Meta" in Settings to repair it.',
        500
      );
    }
    templateRow = data ?? null;
  }

  const attempt = async (phone: string): Promise<string> => {
    if (messageType === 'template') {
      const result = await sendTemplateMessage({
        phoneNumberId: config.phone_number_id,
        accessToken,
        to: phone,
        templateName: templateName!,
        language: templateLanguage || 'en_US',
        template: templateRow ?? undefined,
        messageParams: templateMessageParams ?? undefined,
        params: templateParams || [],
        contextMessageId,
      });
      return result.messageId;
    }
    if (isMediaKind) {
      const result = await sendMediaMessage({
        phoneNumberId: config.phone_number_id,
        accessToken,
        to: phone,
        kind: messageType as MediaKind,
        link: mediaUrl!,
        caption: contentText || undefined,
        filename: filename || undefined,
        contextMessageId,
      });
      return result.messageId;
    }
    if (messageType === 'interactive') {
      const p = interactivePayload!;
      if (p.kind === 'buttons') {
        const result = await sendInteractiveButtons({
          phoneNumberId: config.phone_number_id,
          accessToken,
          to: phone,
          bodyText: p.body,
          headerText: p.header || undefined,
          footerText: p.footer || undefined,
          buttons: p.buttons,
          contextMessageId,
        });
        return result.messageId;
      }
      const result = await sendInteractiveList({
        phoneNumberId: config.phone_number_id,
        accessToken,
        to: phone,
        bodyText: p.body,
        buttonLabel: p.button_label,
        headerText: p.header || undefined,
        footerText: p.footer || undefined,
        sections: p.sections,
        contextMessageId,
      });
      return result.messageId;
    }
    const result = await sendTextMessage({
      phoneNumberId: config.phone_number_id,
      accessToken,
      to: phone,
      text: contentText!,
      contextMessageId,
    });
    return result.messageId;
  };

  // Send via Meta — retry across phone-number variants if Meta rejects
  // with "recipient not in allowed list"; persist a working variant
  // back to the contact so the next send goes straight through.
  let waMessageId = '';
  let workingPhone = sanitizedPhone;
  try {
    const variants = phoneVariants(sanitizedPhone);
    let lastError: unknown = null;

    for (const variant of variants) {
      try {
        waMessageId = await attempt(variant);
        workingPhone = variant;
        lastError = null;
        break;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!isRecipientNotAllowedError(message)) {
          throw err;
        }
        lastError = err;
        console.warn(
          `[send-message] variant "${variant}" rejected by Meta, trying next…`
        );
      }
    }

    if (lastError) throw lastError;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Unknown Meta API error';
    console.error('[send-message] Meta send failed for all variants:', message);
    // Meta #132001 — the template name/language does not exist on the
    // connected WhatsApp number. Usually the local catalog is stale
    // (the phone number or WABA was changed, or the template was renamed
    // on Meta) — surface an actionable error instead of the raw Meta text
    // so the user runs "Sync from Meta" rather than guessing.
    if (/132001|does not exist in the translation/i.test(message)) {
      throw new SendMessageError(
        'template_not_found',
        `Template "${templateName}" (${templateLanguage || 'en_US'}) is not available on your connected WhatsApp number. Run "Sync from Meta" in Settings → Templates, then choose the approved template to send.`,
        400
      );
    }
    throw new SendMessageError('meta_error', `Meta API error: ${message}`, 502);
  }

  if (workingPhone !== sanitizedPhone) {
    console.log(
      `[send-message] Auto-corrected contact phone: ${sanitizedPhone} → ${workingPhone}`
    );
    await db
      .from('contacts')
      .update({ phone: workingPhone })
      .eq('id', contact.id);
  }

  return persistSentMessage({
    db,
    accountId,
    projectId,
    conversationId,
    contactId: contact.id,
    messageType,
    contentText,
    mediaUrl,
    templateName,
    interactivePayload,
    replyToMessageId,
    waMessageId,
  });
}

// ------------------------------------------------------------
// Shared post-send persistence
//
// Extracted so the Cloud API and QR paths cannot drift: whichever
// transport carried the message, the inbox row, the conversation
// preview and the flow-pause behave identically. The only difference
// between the two is what `waMessageId` means — a Meta wamid or a
// Baileys key id — and nothing downstream cares which.
// ------------------------------------------------------------
interface PersistSentMessageArgs {
  db: SupabaseClient;
  accountId: string;
  projectId: string;
  conversationId: string;
  contactId: string;
  messageType: string;
  contentText?: string | null;
  mediaUrl?: string | null;
  templateName?: string | null;
  interactivePayload?: InteractiveMessagePayload | null;
  replyToMessageId?: string | null;
  waMessageId: string;
}

async function persistSentMessage(
  args: PersistSentMessageArgs
): Promise<SendMessageResult> {
  const {
    db,
    projectId,
    conversationId,
    contactId,
    messageType,
    contentText,
    mediaUrl,
    templateName,
    interactivePayload,
    replyToMessageId,
    waMessageId,
  } = args;

  // Interactive messages persist the body as content_text (so the
  // conversation-list preview reads sensibly) plus the full structured
  // payload so the thread can re-render the buttons / rows.
  const interactiveBody =
    messageType === 'interactive' ? interactivePayload!.body : null;

  const { data: messageRecord, error: msgError } = await db
    .from('messages')
    .insert({
      conversation_id: conversationId,
      // NOT NULL post-042, and the column Realtime filters on — a
      // message without it would be invisible to the live inbox.
      project_id: projectId,
      sender_type: 'agent',
      content_type: messageType,
      content_text: interactiveBody ?? contentText ?? null,
      media_url: mediaUrl || null,
      template_name: templateName || null,
      interactive_payload:
        messageType === 'interactive' ? interactivePayload : null,
      message_id: waMessageId,
      status: 'sent',
      reply_to_message_id: replyToMessageId || null,
    })
    .select()
    .single();

  if (msgError) {
    console.error('[send-message] error inserting sent message:', msgError);
    throw new SendMessageError(
      'db_error',
      `Message was sent but failed to save to DB: ${msgError.message}`,
      500
    );
  }

  const lastMessageText =
    messageType === 'interactive'
      ? interactivePayloadPreviewText(interactivePayload!)
      : contentText || `[${messageType}]`;

  await db
    .from('conversations')
    .update({
      last_message_text: lastMessageText,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationId);

  // Pause any active Flow run for this contact — the agent stepping in
  // is the strongest "yield, human is here" signal. Best-effort.
  //
  // Scoped by project_id, not account_id: the admin client bypasses
  // RLS, so an account-wide filter would pause a run belonging to a
  // sibling project that happens to share a contact id. (It cannot
  // today — contacts are project-scoped — but the filter must not
  // depend on that holding.)
  try {
    const { error: pauseErr } = await supabaseAdmin()
      .from('flow_runs')
      .update({
        status: 'paused_by_agent',
        ended_at: new Date().toISOString(),
        end_reason: 'agent_replied',
      })
      .eq('project_id', projectId)
      .eq('contact_id', contactId)
      .eq('status', 'active');
    if (pauseErr) {
      console.error('[flows] pause-on-agent-send failed:', pauseErr.message);
    }
  } catch (err) {
    console.error(
      '[flows] pause-on-agent-send threw:',
      err instanceof Error ? err.message : err
    );
  }

  return { messageId: messageRecord.id, whatsappMessageId: waMessageId };
}

// ------------------------------------------------------------
// QR transport
//
// Everything Meta-specific (templates, interactive payloads, the
// phone-variant retry, token decryption) is absent here by design: a
// QR session sends to the number as typed, and the capability check
// above has already rejected the kinds this channel cannot express.
// ------------------------------------------------------------
interface QrSendArgs {
  db: SupabaseClient;
  projectId: string;
  conversationId: string;
  to: string;
  messageType: string;
  contentText?: string | null;
  mediaUrl?: string | null;
  filename?: string | null;
  replyToMessageId?: string | null;
}

async function sendViaQrChannel(
  args: QrSendArgs
): Promise<{ externalId: string }> {
  const {
    db,
    projectId,
    conversationId,
    to,
    messageType,
    contentText,
    mediaUrl,
    filename,
    replyToMessageId,
  } = args;

  // Resolve the quoted message to its transport id, with the same
  // same-conversation guard the Cloud API path uses — otherwise a
  // caller could quote messages they cannot see by guessing UUIDs.
  let quotedExternalId: string | null = null;
  if (replyToMessageId) {
    const { data: parent } = await db
      .from('messages')
      .select('message_id')
      .eq('id', replyToMessageId)
      .eq('conversation_id', conversationId)
      .maybeSingle();
    quotedExternalId = parent?.message_id ?? null;
  }

  try {
    const result = await sendViaGateway({
      projectId,
      to,
      kind: messageType as 'text' | 'image' | 'video' | 'document' | 'audio',
      text: contentText ?? null,
      mediaUrl: mediaUrl ?? null,
      filename: filename ?? null,
      quotedExternalId,
    });
    if (!result?.externalId) {
      throw new SendMessageError(
        'gateway_error',
        'The WhatsApp gateway accepted the message but returned no id.',
        502
      );
    }
    return result;
  } catch (err) {
    if (err instanceof SendMessageError) throw err;
    if (err instanceof GatewayError) {
      // Pass the gateway's own code through: the UI distinguishes
      // "this project is not paired yet" from "the gateway is down",
      // and they need different fixes.
      throw new SendMessageError(err.code, err.message, err.status);
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new SendMessageError('gateway_error', message, 502);
  }
}
