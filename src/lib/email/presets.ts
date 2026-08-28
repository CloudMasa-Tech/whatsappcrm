export interface EmailServerConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  fromEmail: string;
  fromName?: string;
  replyTo?: string;
}

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  fromName?: string;
  fromEmail?: string;
  replyTo?: string;
  projectId?: string;
  accountId?: string;
}

/**
 * Auto-detect provider SMTP configurations based on email domain or provider name.
 * Safe to import in both Client and Server components.
 */
export function getPresetSmtpConfig(emailOrProvider: string): Partial<EmailServerConfig> {
  const normalized = emailOrProvider.toLowerCase().trim();

  if (normalized.includes('gmail.com') || normalized === 'gmail') {
    return {
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
    };
  }

  if (
    normalized.includes('outlook.com') ||
    normalized.includes('hotmail.com') ||
    normalized.includes('office365.com') ||
    normalized === 'outlook'
  ) {
    return {
      host: 'smtp.office365.com',
      port: 587,
      secure: false,
    };
  }

  if (normalized.includes('zoho.com') || normalized === 'zoho') {
    return {
      host: 'smtp.zoho.com',
      port: 465,
      secure: true,
    };
  }

  if (normalized.includes('yahoo.com') || normalized === 'yahoo') {
    return {
      host: 'smtp.mail.yahoo.com',
      port: 465,
      secure: true,
    };
  }

  return {
    port: 587,
    secure: false,
  };
}
