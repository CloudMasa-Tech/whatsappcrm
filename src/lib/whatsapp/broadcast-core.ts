// ============================================================
// Public-API broadcast core.
//
// Splits a broadcast into two phases so the HTTP route can persist +
// acknowledge fast and fan out afterwards (in `after()`):
//
//   createBroadcast()  — validate, resolve contacts, insert the
//                        `broadcasts` row + `broadcast_recipients`
//                        rows (status 'pending'), return a plan.
//   deliverBroadcast() — send each recipient's template via Meta or QR Gateway
//                        (phone-variant retry), stamp each recipient
//                        row + the aggregate counts, finalize status.
//
// Recipient rows carry `whatsapp_message_id`, so the inbound webhook's
// status handler (which matches on that column) updates delivered/read
// for API broadcasts exactly as it does for dashboard ones.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { sendTemplateMessage } from '@/lib/whatsapp/meta-api';
import { decrypt } from '@/lib/whatsapp/encryption';
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils';
import { isMessageTemplate } from '@/lib/whatsapp/template-row-guard';
import type { MessageTemplate } from '@/types';
import { findOrCreateContact } from '@/lib/api/v1/contacts';
import { resolveProjectChannel } from '@/lib/channels/resolve';
import { sendViaGateway, GatewayError } from '@/lib/channels/gateway';
import { STARTER_MESSAGE_TEMPLATES } from '@/lib/whatsapp/starter-templates';
import { findExistingContact } from '@/lib/contacts/dedupe';

/** Thrown by createBroadcast on a caller-visible failure; route maps it. */
export class BroadcastError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'BroadcastError';
    this.code = code;
    this.status = status;
  }
}

export interface BroadcastRecipientInput {
  /** E.164 phone. */
  to: string;
  /** Positional body params for the template ({{1}}, {{2}}…). */
  params?: string[];
}

export interface CreateBroadcastParams {
  name?: string | null;
  templateName: string;
  templateLanguage?: string | null;
  recipients: BroadcastRecipientInput[];
}

interface PlannedRecipient {
  recipientRowId: string;
  phone: string;
  params: string[];
}

export interface BroadcastPlan {
  broadcastId: string;
  projectId: string;
  accountId: string;
  channelType: 'cloud_api' | 'qr';
  templateName: string;
  templateLanguage: string;
  phoneNumberId?: string;
  accessToken?: string;
  templateRow: MessageTemplate | null;
  planned: PlannedRecipient[];
  /** Phones rejected up front (invalid E.164) — counted as failed. */
  rejected: number;
}

const MAX_RECIPIENTS = 1000;

function renderTemplateForQr(
  templateRow: MessageTemplate | null,
  templateName: string,
  bodyParams: string[] = []
): {
  text: string;
  mediaUrl: string | null;
  kind: 'text' | 'image' | 'video' | 'document' | 'audio';
} {
  let tplBody = '';
  let tplHeader: string | undefined;
  let tplFooter: string | undefined;
  let tplButtons: any[] | undefined;
  let tplHeaderMedia: string | undefined;
  let tplHeaderFormat: string | undefined;

  if (templateRow) {
    tplBody = templateRow.body_text || '';
    tplHeader = templateRow.header_content;
    tplFooter = templateRow.footer_text;
    tplButtons = templateRow.buttons;
    tplHeaderMedia = templateRow.header_media_url;
    tplHeaderFormat = templateRow.header_type;
  } else {
    const starter = STARTER_MESSAGE_TEMPLATES.find(
      (s) => s.name === templateName || s.slug === templateName
    );
    if (starter) {
      tplBody = starter.body_text;
      tplHeader = starter.header_content;
      tplFooter = starter.footer_text;
      tplButtons = starter.buttons;
      tplHeaderMedia = starter.header_media_url;
      tplHeaderFormat = starter.header_format;
    }
  }

  let rendered = tplBody;
  if (Array.isArray(bodyParams)) {
    bodyParams.forEach((val, idx) => {
      rendered = rendered.replace(
        new RegExp(`\\{\\{${idx + 1}\\}\\}`, 'g'),
        String(val)
      );
    });
  }

  if (tplHeader && tplHeaderFormat === 'text') {
    rendered = `*${tplHeader}*\n\n${rendered}`;
  }

  if (tplFooter) {
    rendered = `${rendered}\n\n_${tplFooter}_`;
  }

  if (Array.isArray(tplButtons) && tplButtons.length > 0) {
    const buttonLines = tplButtons.map((btn: any, idx: number) => {
      if (btn.type === 'URL' && btn.url) {
        return `🔗 ${btn.text}: ${btn.url}`;
      }
      if (btn.type === 'PHONE_NUMBER' && btn.phone_number) {
        return `📞 ${btn.text}: ${btn.phone_number}`;
      }
      return `👉 ${btn.text || btn.title || 'Option ' + (idx + 1)}`;
    });
    rendered = `${rendered}\n\n${buttonLines.join('\n')}`;
  }

  let qrMediaUrl: string | null = tplHeaderMedia || null;
  let qrKind: 'text' | 'image' | 'video' | 'document' | 'audio' = 'text';

  if (qrMediaUrl) {
    if (/\.(mp4|mov|avi|webm)$/i.test(qrMediaUrl)) {
      qrKind = 'video';
    } else if (/\.(pdf|doc|docx|csv|xlsx|txt)$/i.test(qrMediaUrl)) {
      qrKind = 'document';
    } else if (/\.(mp3|ogg|wav|m4a|aac)$/i.test(qrMediaUrl)) {
      qrKind = 'audio';
    } else {
      qrKind = 'image';
    }
  }

  return {
    text: rendered || templateName,
    mediaUrl: qrMediaUrl,
    kind: qrKind,
  };
}

/**
 * Validate + persist a broadcast, resolving each recipient to a
 * contact. Returns a plan for {@link deliverBroadcast}. Throws
 * {@link BroadcastError} on bad input / missing config / a malformed
 * template / a DB failure — nothing is sent in this phase.
 */
export async function createBroadcast(
  db: SupabaseClient,
  accountId: string,
  projectId: string,
  auditUserId: string,
  params: CreateBroadcastParams
): Promise<BroadcastPlan> {
  const { name, templateName, recipients } = params;
  const templateLanguage = params.templateLanguage || 'en_US';

  if (!templateName) {
    throw new BroadcastError('bad_request', "'template_name' is required", 400);
  }
  if (!Array.isArray(recipients) || recipients.length === 0) {
    throw new BroadcastError(
      'bad_request',
      "'recipients' must be a non-empty array of { to, params? }",
      400
    );
  }
  if (recipients.length > MAX_RECIPIENTS) {
    throw new BroadcastError(
      'bad_request',
      `A broadcast is capped at ${MAX_RECIPIENTS} recipients per request; split larger sends`,
      400
    );
  }

  const channel = await resolveProjectChannel(db, projectId);
  const channelType = channel?.channelType ?? 'cloud_api';
  let phoneNumberId = '';
  let accessToken = '';

  if (channelType === 'cloud_api') {
    const { data: config, error: configError } = await db
      .from('whatsapp_config')
      .select('*')
      .eq('project_id', projectId)
      .single();
    if (configError || !config) {
      throw new BroadcastError(
        'whatsapp_not_configured',
        'WhatsApp not configured. Please set up your WhatsApp integration first.',
        400
      );
    }
    phoneNumberId = config.phone_number_id;
    accessToken = decrypt(config.access_token);
  }

  // Template row (once) for header/button components; guard a
  // malformed local row rather than N identical opaque failures.
  const { data: rawTemplateRow } = await db
    .from('message_templates')
    .select('*')
    .eq('project_id', projectId)
    .eq('name', templateName)
    .eq('language', templateLanguage)
    .maybeSingle();
  if (rawTemplateRow && !isMessageTemplate(rawTemplateRow)) {
    throw new BroadcastError(
      'template_malformed',
      'Template row is malformed locally — run "Sync from Meta" in Settings to repair it before broadcasting.',
      500
    );
  }
  const templateRow = (rawTemplateRow as MessageTemplate | null) ?? null;

  // Resolve each recipient to a contact. Invalid phones are dropped
  // (counted as rejected) rather than aborting the whole broadcast.
  const resolved: { contactId: string; phone: string; params: string[] }[] = [];
  let rejected = 0;
  for (const r of recipients) {
    const sanitized = sanitizePhoneForMeta(typeof r.to === 'string' ? r.to : '');
    if (!isValidE164(sanitized)) {
      rejected++;
      continue;
    }
    const { id } = await findOrCreateContact(db, accountId, projectId, auditUserId, {
      phone: sanitized,
    });
    resolved.push({
      contactId: id,
      phone: sanitized,
      params: Array.isArray(r.params)
        ? r.params.filter((p): p is string => typeof p === 'string')
        : [],
    });
  }

  // Collapse recipients that resolved to the SAME contact (the caller
  // listed a phone twice, or two numbers fuzzy-matched to one contact).
  const seenContact = new Set<string>();
  const deduped = resolved.filter((r) => {
    if (seenContact.has(r.contactId)) return false;
    seenContact.add(r.contactId);
    return true;
  });

  if (deduped.length === 0) {
    throw new BroadcastError(
      'bad_request',
      'No recipients had a valid E.164 phone number',
      400
    );
  }

  const { data: broadcast, error: bErr } = await db
    .from('broadcasts')
    .insert({
      account_id: accountId,
      project_id: projectId,
      user_id: auditUserId,
      name: name || `API broadcast (${templateName})`,
      template_name: templateName,
      template_language: templateLanguage,
      status: 'sending',
      total_recipients: deduped.length,
    })
    .select('id')
    .single();
  if (bErr || !broadcast) {
    console.error('[broadcast-core] create broadcast error:', bErr);
    throw new BroadcastError('internal', 'Failed to create broadcast', 500);
  }

  const { data: recipientRows, error: rErr } = await db
    .from('broadcast_recipients')
    .insert(
      deduped.map((r) => ({
        broadcast_id: broadcast.id,
        contact_id: r.contactId,
        status: 'pending' as const,
      }))
    )
    .select('id, contact_id');
  if (rErr || !recipientRows) {
    console.error('[broadcast-core] insert recipients error:', rErr);
    await db
      .from('broadcasts')
      .update({ status: 'failed', failed_count: deduped.length })
      .eq('id', broadcast.id);
    throw new BroadcastError(
      'internal',
      'Failed to create broadcast recipients',
      500
    );
  }

  const idByContact = new Map(
    recipientRows.map((row) => [row.contact_id, row.id])
  );
  const planned: PlannedRecipient[] = [];
  for (const r of deduped) {
    const rowId = idByContact.get(r.contactId);
    if (rowId) {
      planned.push({
        recipientRowId: rowId,
        phone: r.phone,
        params: r.params,
      });
    }
  }

  return {
    broadcastId: broadcast.id,
    projectId,
    accountId,
    channelType,
    templateName,
    templateLanguage,
    phoneNumberId: phoneNumberId || undefined,
    accessToken: accessToken || undefined,
    templateRow,
    planned,
    rejected,
  };
}

/**
 * Fan out a {@link BroadcastPlan}: send each recipient's template
 * and stamp its `broadcast_recipients` row.
 */
export async function deliverBroadcast(
  db: SupabaseClient,
  plan: BroadcastPlan
): Promise<void> {
  let sentCount = 0;

  for (let i = 0; i < plan.planned.length; i++) {
    const recipient = plan.planned[i];
    let sentMessageId: string | null = null;
    let lastError: string | null = null;

    if (plan.channelType === 'qr') {
      const sanitized = sanitizePhoneForMeta(recipient.phone);
      const { text: qrText, mediaUrl: qrMediaUrl, kind: qrKind } =
        renderTemplateForQr(plan.templateRow, plan.templateName, recipient.params);

      try {
        const res = await sendViaGateway({
          projectId: plan.projectId,
          to: sanitized,
          kind: qrKind,
          text: qrText,
          mediaUrl: qrMediaUrl,
        });
        sentMessageId = res.externalId;
      } catch (err) {
        lastError =
          err instanceof GatewayError
            ? err.message
            : err instanceof Error
            ? err.message
            : 'Gateway error';
      }
    } else {
      const variants = phoneVariants(recipient.phone);
      for (const variant of variants) {
        try {
          const result = await sendTemplateMessage({
            phoneNumberId: plan.phoneNumberId!,
            accessToken: plan.accessToken!,
            to: variant,
            templateName: plan.templateName,
            language: plan.templateLanguage,
            template: plan.templateRow ?? undefined,
            params: recipient.params,
          });
          sentMessageId = result.messageId;
          lastError = null;
          break;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Unknown error';
          lastError = message;
          if (!isRecipientNotAllowedError(message)) break;
        }
      }
    }

    if (sentMessageId) {
      sentCount++;
      await db
        .from('broadcast_recipients')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          whatsapp_message_id: sentMessageId,
          error_message: null,
        })
        .eq('id', recipient.recipientRowId);

      // Best-effort inbox sync
      try {
        let contact = await findExistingContact(db, plan.accountId, recipient.phone, plan.projectId);
        if (!contact) {
          const { data: newContact } = await db
            .from('contacts')
            .insert({
              account_id: plan.accountId,
              project_id: plan.projectId,
              phone: recipient.phone,
            })
            .select('id')
            .maybeSingle();
          contact = newContact as any;
        }

        if (contact) {
          let { data: conv } = await db
            .from('conversations')
            .select('id')
            .eq('project_id', plan.projectId)
            .eq('contact_id', contact.id)
            .maybeSingle();

          if (!conv) {
            const { data: newConv } = await db
              .from('conversations')
              .insert({
                account_id: plan.accountId,
                project_id: plan.projectId,
                contact_id: contact.id,
                status: 'open',
                unread_count: 0,
                last_message_text: `[${plan.templateName}]`,
                last_message_at: new Date().toISOString(),
              })
              .select('id')
              .single();
            conv = newConv;
          }

          if (conv) {
            await db.from('messages').insert({
              conversation_id: conv.id,
              project_id: plan.projectId,
              sender_type: 'agent',
              content_type: 'template',
              content_text: plan.templateRow?.body_text || `[${plan.templateName}]`,
              template_name: plan.templateName,
              message_id: sentMessageId,
              status: 'sent',
            });

            await db
              .from('conversations')
              .update({
                last_message_text: plan.templateRow?.body_text || `[${plan.templateName}]`,
                last_message_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              })
              .eq('id', conv.id);
          }
        }
      } catch (dbErr) {
        console.warn('[broadcast-core] best-effort inbox sync notice:', dbErr);
      }
    } else {
      await db
        .from('broadcast_recipients')
        .update({
          status: 'failed',
          error_message: lastError || 'Unknown error',
        })
        .eq('id', recipient.recipientRowId);
    }

    if (i < plan.planned.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }

  await db
    .from('broadcasts')
    .update({
      status: sentCount > 0 ? 'sent' : 'failed',
      updated_at: new Date().toISOString(),
    })
    .eq('id', plan.broadcastId);
}
