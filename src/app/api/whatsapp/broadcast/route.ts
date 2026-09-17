import { NextResponse } from 'next/server';
import { getCurrentProject } from '@/lib/auth/project';
import { createClient } from '@/lib/supabase/server';
import { sendTemplateMessage } from '@/lib/whatsapp/meta-api';
import { decrypt } from '@/lib/whatsapp/encryption';
import type { SendTimeParams } from '@/lib/whatsapp/template-send-builder';
import { isMessageTemplate } from '@/lib/whatsapp/template-row-guard';
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { resolveProjectChannel } from '@/lib/channels/resolve';
import { sendViaGateway, GatewayError } from '@/lib/channels/gateway';
import { STARTER_MESSAGE_TEMPLATES } from '@/lib/whatsapp/starter-templates';
import { findExistingContact } from '@/lib/contacts/dedupe';
import type { MessageTemplate } from '@/types';

interface BroadcastResult {
  phone: string;
  status: 'sent' | 'failed';
  whatsapp_message_id?: string;
  error?: string;
}

interface NewRecipient {
  phone: string;
  /** Body variable values, one per {{N}}. Legacy field. */
  params?: string[];
  /**
   * Structured per-send values (header text variable, media URL
   * override, URL/COPY_CODE button values).
   */
  messageParams?: SendTimeParams;
}

function renderTemplateForQr(
  templateRow: MessageTemplate | null,
  templateName: string,
  bodyParams: string[] = [],
  messageParams?: SendTimeParams
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
    tplHeaderMedia =
      messageParams?.headerMediaUrl || templateRow.header_media_url;
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
      tplHeaderMedia =
        messageParams?.headerMediaUrl || starter.header_media_url;
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
    const headerText = messageParams?.headerText || tplHeader;
    rendered = `*${headerText}*\n\n${rendered}`;
  }

  if (tplFooter) {
    rendered = `${rendered}\n\n_${tplFooter}_`;
  }

  if (Array.isArray(tplButtons) && tplButtons.length > 0) {
    const buttonLines = tplButtons.map((btn: any, idx: number) => {
      if (btn.type === 'URL' && btn.url) {
        const urlVal = messageParams?.buttonParams?.[idx] || '';
        const finalUrl = btn.url.replace('{{1}}', urlVal);
        return `🔗 ${btn.text}: ${finalUrl}`;
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

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const limit = checkRateLimit(`broadcast:${user.id}`, RATE_LIMITS.broadcast);
    if (!limit.success) {
      return rateLimitResponse(limit);
    }

    const { accountId, projectId: currentProjectId } = await getCurrentProject();
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const {
      recipients: newRecipients,
      phone_numbers,
      template_name,
      template_language,
      template_params,
      projectId: bodyProjectId,
    } = body;

    const projectId = bodyProjectId || currentProjectId;
    if (!projectId) {
      return NextResponse.json(
        { error: 'No active project selected.' },
        { status: 400 }
      );
    }

    // Normalize to a list of {phone, params} regardless of shape.
    let recipients: NewRecipient[];
    if (Array.isArray(newRecipients) && newRecipients.length > 0) {
      recipients = newRecipients;
    } else if (Array.isArray(phone_numbers) && phone_numbers.length > 0) {
      const shared: string[] = Array.isArray(template_params)
        ? template_params
        : [];
      recipients = phone_numbers.map((phone: string) => ({
        phone,
        params: shared,
      }));
    } else {
      return NextResponse.json(
        {
          error:
            'Provide either `recipients` (preferred) or `phone_numbers` — must be a non-empty array',
        },
        { status: 400 }
      );
    }

    if (!template_name) {
      return NextResponse.json(
        { error: 'template_name is required' },
        { status: 400 }
      );
    }

    // Load template row
    let templateRow: MessageTemplate | null = null;
    const { data: rawTemplateRow } = await supabase
      .from('message_templates')
      .select('*')
      .eq('name', template_name)
      .eq('language', template_language || 'en_US')
      .maybeSingle();

    if (rawTemplateRow && !isMessageTemplate(rawTemplateRow)) {
      return NextResponse.json(
        {
          error:
            'Template row is malformed locally — run "Sync from Meta" in Settings to repair it before broadcasting.',
        },
        { status: 500 }
      );
    }
    templateRow = rawTemplateRow ?? null;

    // Resolve channel type
    const channel = await resolveProjectChannel(supabase, projectId);
    const channelType = channel?.channelType ?? 'cloud_api';

    const results: BroadcastResult[] = [];
    let sentCount = 0;
    let failedCount = 0;

    if (channelType === 'qr') {
      // ------------------------------------------------------------
      // QR Channel sending via Gateway
      // ------------------------------------------------------------
      for (let i = 0; i < recipients.length; i++) {
        const recipient = recipients[i];
        const sanitized = sanitizePhoneForMeta(recipient.phone);

        if (!isValidE164(sanitized)) {
          results.push({
            phone: recipient.phone,
            status: 'failed',
            error: 'Invalid phone number format',
          });
          failedCount++;
          continue;
        }

        const {
          text: qrText,
          mediaUrl: qrMediaUrl,
          kind: qrKind,
        } = renderTemplateForQr(
          templateRow,
          template_name,
          recipient.params,
          recipient.messageParams
        );

        try {
          const res = await sendViaGateway({
            projectId,
            to: sanitized,
            kind: qrKind,
            text: qrText,
            mediaUrl: qrMediaUrl,
          });

          const sentMessageId = res.externalId;

          // Best-effort message and conversation sync for inbox
          try {
            let contact = await findExistingContact(supabase, accountId, sanitized, projectId);

            if (!contact) {
              const { data: newContact } = await supabase
                .from('contacts')
                .insert({
                  account_id: accountId,
                  project_id: projectId,
                  user_id: user.id,
                  phone: sanitized,
                })
                .select('id')
                .maybeSingle();
              contact = newContact as any;
            }

            if (contact) {
              let { data: conv } = await supabase
                .from('conversations')
                .select('id')
                .eq('project_id', projectId)
                .eq('contact_id', contact.id)
                .maybeSingle();

              if (!conv) {
                const { data: newConv } = await supabase
                  .from('conversations')
                  .insert({
                    account_id: accountId,
                    project_id: projectId,
                    contact_id: contact.id,
                    user_id: user.id,
                    status: 'open',
                    unread_count: 0,
                    last_message_text: qrText || `[${template_name}]`,
                    last_message_at: new Date().toISOString(),
                  })
                  .select('id')
                  .single();
                conv = newConv;
              }

              if (conv) {
                await supabase.from('messages').insert({
                  conversation_id: conv.id,
                  project_id: projectId,
                  sender_type: 'agent',
                  content_type: qrKind === 'text' ? 'template' : qrKind,
                  content_text: qrText,
                  media_url: qrMediaUrl,
                  template_name,
                  message_id: sentMessageId,
                  status: 'sent',
                });

                await supabase
                  .from('conversations')
                  .update({
                    last_message_text: qrText || `[${template_name}]`,
                    last_message_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                  })
                  .eq('id', conv.id);
              }
            }
          } catch (dbSyncErr) {
            console.warn('[broadcast-qr] best-effort DB sync notice:', dbSyncErr);
          }

          results.push({
            phone: recipient.phone,
            status: 'sent',
            whatsapp_message_id: sentMessageId,
          });
          sentCount++;
        } catch (err) {
          const errorMessage =
            err instanceof GatewayError
              ? err.message
              : err instanceof Error
              ? err.message
              : 'Failed to send via WhatsApp gateway';

          console.error(`[broadcast-qr] Failed for ${recipient.phone}:`, errorMessage);
          results.push({
            phone: recipient.phone,
            status: 'failed',
            error: errorMessage,
          });
          failedCount++;
        }

        // 5-second delay between sends
        if (i < recipients.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 5000));
        }
      }
    } else {
      // ------------------------------------------------------------
      // Cloud API Channel sending
      // ------------------------------------------------------------
      const { data: config, error: configError } = await supabase
        .from('whatsapp_config')
        .select('*')
        .eq('project_id', projectId)
        .single();

      if (configError || !config) {
        return NextResponse.json(
          {
            error:
              'WhatsApp not configured. Please set up your WhatsApp integration first.',
          },
          { status: 400 }
        );
      }

      const accessToken = decrypt(config.access_token);

      for (let i = 0; i < recipients.length; i++) {
        const recipient = recipients[i];
        const sanitized = sanitizePhoneForMeta(recipient.phone);

        if (!isValidE164(sanitized)) {
          results.push({
            phone: recipient.phone,
            status: 'failed',
            error: 'Invalid phone number format',
          });
          failedCount++;
          continue;
        }

        const variants = phoneVariants(sanitized);
        let sentMessageId: string | null = null;
        let lastError: string | null = null;

        for (const variant of variants) {
          try {
            const result = await sendTemplateMessage({
              phoneNumberId: config.phone_number_id,
              accessToken,
              to: variant,
              templateName: template_name,
              language: template_language || 'en_US',
              template: templateRow ?? undefined,
              messageParams: recipient.messageParams,
              params: recipient.params ?? [],
            });
            sentMessageId = result.messageId;
            lastError = null;
            break;
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : 'Unknown error';
            if (!isRecipientNotAllowedError(errorMessage)) {
              lastError = errorMessage;
              break;
            }
            lastError = errorMessage;
          }
        }

        if (sentMessageId) {
          results.push({
            phone: recipient.phone,
            status: 'sent',
            whatsapp_message_id: sentMessageId,
          });
          sentCount++;
        } else {
          console.error(
            `Failed to send broadcast to ${recipient.phone}:`,
            lastError
          );
          results.push({
            phone: recipient.phone,
            status: 'failed',
            error: lastError || 'Unknown error',
          });
          failedCount++;
        }

        if (i < recipients.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 5000));
        }
      }
    }

    return NextResponse.json({
      success: true,
      total: recipients.length,
      sent: sentCount,
      failed: failedCount,
      results,
    });
  } catch (error) {
    console.error('Error in WhatsApp broadcast POST:', error);
    return NextResponse.json(
      { error: 'Failed to process broadcast' },
      { status: 500 }
    );
  }
}
