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
  // 1. Check database for project-specific email_configs
  if (projectId) {
    try {
      const { data } = await supabaseAdmin()
        .from('email_configs')
        .select('*')
        .eq('project_id', projectId)
        .eq('is_connected', true)
        .maybeSingle();

      const user = data?.email_address || data?.smtp_user;
      const pass = data?.email_password || data?.smtp_pass;
      const host = data?.smtp_host;

      if (data && host && user && pass) {
        return {
          host,
          port: Number(data.smtp_port) || 587,
          secure: Boolean(data.smtp_secure ?? Number(data.smtp_port) === 465),
          user,
          pass,
          fromEmail: data.email_address || user,
          fromName: data.from_name || 'MaSa CRM',
          replyTo: data.reply_to || undefined,
        };
      }
    } catch (err) {
      console.error('[resolveEmailConfig] db error:', err);
    }

    // If a project was explicitly specified, do NOT fall back to global .env credentials.
    // Each project must have its own connected email.
    return null;
  }

  // 2. Fallback to server environment variables ONLY for global system emails
  // (e.g. initial superadmin user welcome invitations where no project exists yet)
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
    const errorMsg = `No SMTP configuration found in environment variables or database. (Checked SMTP_HOST, SMTP_USER, SMTP_PASS)`;
    console.error(`[Email Service] ${errorMsg}`);
    return {
      success: false,
      error: errorMsg,
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
        'X-Mailer': 'CloudMaSa WhatsApp CRM',
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
