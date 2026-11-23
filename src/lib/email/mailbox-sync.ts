/**
 * Mailbox Sync Service
 *
 * Connects directly to the Gmail/IMAP mailbox (e.g. info@cloudmasa.com)
 * to pull customer replies, match them against campaign recipients,
 * increment the campaign's Leads counter, and place the reply threads
 * into the Unified Inbox (/inbox).
 */

import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  fetchRecentEmailsFromMailbox,
  type FetchedEmail,
  type ImapConfig,
} from './imap-client';
import {
  appendEmailMessage,
  ensureContactForEmail,
  ensureEmailConversation,
  fireEmailTrigger,
  logEmailEvent,
} from './lead-flow';

export interface MailboxSyncResult {
  success: boolean;
  scannedCount: number;
  newLeadsCount: number;
  newMessagesCount: number;
  matchedRecipients: {
    email: string;
    campaignName?: string;
    subject: string;
  }[];
  error?: string;
}

/**
 * Resolves IMAP connection configuration from database or environment variables
 */
export async function resolveImapConfig(projectId?: string | null): Promise<ImapConfig | null> {
  const db = supabaseAdmin();

  // 1. Try project-level email config if project provided
  if (projectId) {
    const { data: config } = await db
      .from('email_configs')
      .select('email_address, email_password, smtp_host, smtp_port')
      .eq('project_id', projectId)
      .eq('is_connected', true)
      .maybeSingle();

    if (config?.email_address && config.email_password) {
      let host = config.smtp_host || 'imap.gmail.com';
      if (host.includes('smtp.gmail.com')) host = 'imap.gmail.com';
      else if (host.startsWith('smtp.')) host = host.replace('smtp.', 'imap.');

      return {
        host,
        port: 993,
        secure: true,
        user: config.email_address,
        pass: config.email_password,
      };
    }
  }

  // 2. Global environment variables (Gmail SMTP/IMAP credentials)
  const user = process.env.IMAP_USER || process.env.SMTP_USER || process.env.EMAIL_SERVER_USER;
  const pass = process.env.IMAP_PASS || process.env.SMTP_PASS || process.env.EMAIL_SERVER_PASSWORD;
  let host = process.env.IMAP_HOST || process.env.SMTP_HOST || 'imap.gmail.com';

  if (host.includes('smtp.gmail.com')) host = 'imap.gmail.com';
  else if (host.startsWith('smtp.')) host = host.replace('smtp.', 'imap.');

  if (!user || !pass) {
    return null;
  }

  return {
    host,
    port: Number(process.env.IMAP_PORT) || 993,
    secure: true,
    user,
    pass,
  };
}

/**
 * Executes a full sync of the mailbox
 */
export async function syncMailbox(options: {
  projectId?: string | null;
  maxEmails?: number;
} = {}): Promise<MailboxSyncResult> {
  const imapConfig = await resolveImapConfig(options.projectId);

  if (!imapConfig) {
    return {
      success: false,
      scannedCount: 0,
      newLeadsCount: 0,
      newMessagesCount: 0,
      matchedRecipients: [],
      error: 'No email credentials found in environment (SMTP_USER/SMTP_PASS) or project configuration.',
    };
  }

  let emails: FetchedEmail[] = [];
  try {
    emails = await fetchRecentEmailsFromMailbox(imapConfig, {
      maxEmails: options.maxEmails ?? 40,
    });
  } catch (err) {
    console.error('[mailbox-sync] IMAP connection failed:', err);
    const anyErr = err as { message?: string; code?: string; errors?: Error[] };
    let errMsg = anyErr?.message || anyErr?.code || (anyErr?.errors?.[0]?.message) || String(err) || 'Failed to connect to IMAP server';
    if (errMsg.toLowerCase().includes('timed out') || errMsg.toLowerCase().includes('etimedout')) {
      errMsg = `IMAP connection to ${imapConfig.host}:993 timed out. Your ISP, router, or local network may be blocking outbound port 993. When testing locally, you can use the Inbound Webhook (Option 2) or verify on a server with open ports.`;
    }
    return {
      success: false,
      scannedCount: 0,
      newLeadsCount: 0,
      newMessagesCount: 0,
      matchedRecipients: [],
      error: errMsg,
    };
  }

  const db = supabaseAdmin();
  let newLeadsCount = 0;
  let newMessagesCount = 0;
  const matchedRecipients: { email: string; campaignName?: string; subject: string }[] = [];

  for (const email of emails) {
    const fromEmail = email.fromEmail;
    if (!fromEmail || fromEmail === imapConfig.user.toLowerCase()) {
      // Skip outgoing emails sent by us
      continue;
    }

    // 1. Check if this exact message was already recorded
    if (email.messageId) {
      const { data: existingMsg } = await db
        .from('messages')
        .select('id')
        .eq('email_message_id', email.messageId)
        .limit(1)
        .maybeSingle();

      if (existingMsg?.id) {
        // Already recorded
        continue;
      }
    }

    // 2. Check if sender matches any campaign recipient
    const { data: recipient } = await db
      .from('email_campaign_recipients')
      .select(
        'id, campaign_id, contact_id, email, name, status, campaign:email_campaigns(id, account_id, project_id, user_id, replied_count, name, subject)',
      )
      .ilike('email', fromEmail)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const campaign = recipient
      ? Array.isArray(recipient.campaign)
        ? recipient.campaign[0]
        : recipient.campaign
      : null;

    let accountId: string | null = (campaign?.account_id as string) ?? null;
    let projectId: string | null = (campaign?.project_id as string | null) ?? options.projectId ?? null;
    let ownerUserId: string | null = (campaign?.user_id as string) ?? null;
    let contactId: string | null = (recipient?.contact_id as string | null) ?? null;

    // 3. If no campaign recipient, check if it matches an existing Contact in CRM
    if (!accountId) {
      const { data: contact } = await db
        .from('contacts')
        .select('id, account_id, project_id, user_id, name')
        .ilike('email', fromEmail)
        .limit(1)
        .maybeSingle();

      if (contact) {
        accountId = contact.account_id;
        projectId = contact.project_id ?? options.projectId ?? null;
        ownerUserId = contact.user_id;
        contactId = contact.id;
      }
    }

    // If completely unrelated and not in CRM, skip so we don't pollute the CRM
    if (!accountId || !ownerUserId) {
      continue;
    }

    // 4. Ensure Contact in CRM
    const contact = await ensureContactForEmail({
      accountId,
      projectId,
      ownerUserId,
      email: fromEmail,
      name: email.fromName || recipient?.name || fromEmail.split('@')[0],
      contactId,
    });

    if (!contact) continue;

    // 5. Ensure Conversation in Unified Inbox
    const conversationId = await ensureEmailConversation({
      accountId,
      projectId,
      ownerUserId,
      contactId: contact.contactId,
      subject: email.subject,
    });

    if (!conversationId) continue;

    // 6. Append incoming message
    await appendEmailMessage({
      conversationId,
      projectId,
      senderType: 'customer',
      subject: email.subject,
      bodyText: email.snippet || email.subject,
      emailMessageId: email.messageId,
      inReplyTo: email.inReplyTo,
      incrementUnread: true,
    });
    newMessagesCount++;

    // 7. If this was a campaign recipient, record Lead and increment replied_count
    if (recipient?.id && campaign?.id) {
      const wasAlreadyReplied = recipient.status === 'replied';

      const { error: rpcErr } = await db.rpc('record_email_reply', {
        p_recipient_id: recipient.id,
        p_conversation_id: conversationId,
      });

      if (rpcErr) {
        await db
          .from('email_campaign_recipients')
          .update({
            replied_at: email.date ? email.date.toISOString() : new Date().toISOString(),
            conversation_id: conversationId,
            status: 'replied',
          })
          .eq('id', recipient.id);

        if (!wasAlreadyReplied) {
          await db
            .from('email_campaigns')
            .update({
              replied_count: ((campaign as { replied_count?: number }).replied_count || 0) + 1,
            })
            .eq('id', campaign.id);
        }
      }

      if (!wasAlreadyReplied) {
        newLeadsCount++;
        matchedRecipients.push({
          email: fromEmail,
          campaignName: (campaign as { name?: string }).name,
          subject: email.subject,
        });

        await logEmailEvent({
          accountId,
          projectId,
          campaignId: campaign.id as string,
          recipientId: recipient.id,
          contactId: contact.contactId,
          eventType: 'reply',
          metadata: { subject: email.subject, source: 'imap_mailbox_sync' },
        });

        await fireEmailTrigger({
          accountId,
          projectId,
          contactId: contact.contactId,
          triggerType: 'email_replied',
          conversationId,
          messageText: email.snippet,
        });
      }
    }
  }

  return {
    success: true,
    scannedCount: emails.length,
    newLeadsCount,
    newMessagesCount,
    matchedRecipients,
  };
}

