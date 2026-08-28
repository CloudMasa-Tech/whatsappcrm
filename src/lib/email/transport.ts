import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  type EmailServerConfig,
  type SendEmailOptions,
  getPresetSmtpConfig,
} from './presets';

export type { EmailServerConfig, SendEmailOptions };
export { getPresetSmtpConfig };



/**
 * Resolves active email configuration for a given project/account,
 * falling back to environment variables.
 */
export async function resolveEmailConfig(
  projectId?: string,
  accountId?: string
): Promise<EmailServerConfig | null> {
  // 1. Check database for project-specific or account-specific email_configs
  if (projectId || accountId) {
    try {
      let query = supabaseAdmin().from('email_configs').select('*').limit(1);
      if (projectId) {
        query = query.eq('project_id', projectId);
      } else if (accountId) {
        query = query.eq('account_id', accountId);
      }

      const { data } = await query.maybeSingle();

      if (data && data.smtp_host && data.smtp_user && data.smtp_pass) {
        return {
          host: data.smtp_host,
          port: Number(data.smtp_port) || 587,
          secure: Boolean(data.smtp_secure ?? Number(data.smtp_port) === 465),
          user: data.smtp_user,
          pass: data.smtp_pass,
          fromEmail: data.from_email || data.smtp_user,
          fromName: data.from_name || 'MaSa CRM',
          replyTo: data.reply_to || undefined,
        };
      }
    } catch {
      // Table may not exist yet or query failed — proceed to env fallback
    }
  }

  // 2. Fallback to server environment variables
  const envHost = process.env.SMTP_HOST || process.env.EMAIL_SERVER_HOST;
  const envUser = process.env.SMTP_USER || process.env.EMAIL_SERVER_USER;
  const envPass = process.env.SMTP_PASS || process.env.EMAIL_SERVER_PASSWORD || process.env.SMTP_PASSWORD;

  if (envHost && envUser && envPass) {
    const port = Number(process.env.SMTP_PORT || process.env.EMAIL_SERVER_PORT) || 587;
    return {
      host: envHost,
      port,
      secure: process.env.SMTP_SECURE === 'true' || port === 465,
      user: envUser,
      pass: envPass,
      fromEmail: process.env.SMTP_FROM || process.env.EMAIL_FROM || envUser,
      fromName: process.env.SMTP_FROM_NAME || 'MaSa WhatsApp CRM',
      replyTo: process.env.SMTP_REPLY_TO,
    };
  }

  return null;
}

/**
 * Creates a configured Nodemailer Transporter
 */
export function createMailTransporter(config: EmailServerConfig): Transporter {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass,
    },
    tls: {
      rejectUnauthorized: process.env.SMTP_TLS_REJECT_UNAUTHORIZED === 'true',
    },
  });
}

/**
 * Sends an email using the resolved server/project configuration
 */
export async function sendEmail(
  options: SendEmailOptions
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const config = await resolveEmailConfig(options.projectId, options.accountId);

  if (!config) {
    console.warn(
      `[Email Service] No SMTP configuration found (DB or env vars). Simulating send to ${options.to}. Subject: "${options.subject}"`
    );
    return {
      success: true,
      messageId: `simulated-${Date.now()}`,
    };
  }

  try {
    const transporter = createMailTransporter(config);
    const fromAddress = options.fromEmail || config.fromEmail;
    const fromName = options.fromName || config.fromName || 'MaSa CRM';
    const fromHeader = `"${fromName}" <${fromAddress}>`;

    const info = await transporter.sendMail({
      from: fromHeader,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      replyTo: options.replyTo || config.replyTo,
      headers: {
        'X-Entity-Ref-ID': `${Date.now()}`,
        'X-Mailer': 'RegiBIZ CloudMaSa CRM',
      },
    });

    console.log(`[Email Service] Successfully sent email to ${options.to} (Message ID: ${info.messageId})`);
    return {
      success: true,
      messageId: info.messageId,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown mail transport error';
    console.error(`[Email Service] Failed to send email to ${options.to}:`, errorMessage);
    return {
      success: false,
      error: errorMessage,
    };
  }
}
