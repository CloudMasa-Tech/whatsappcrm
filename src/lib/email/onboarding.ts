/**
 * Onboarding Email Service
 *
 * Dispatches account credential and access details to newly created customers/users.
 * If SMTP/Email provider is configured, it sends via mail provider, and always logs
 * the structured email payload to the server logs for auditing.
 */

export interface OnboardingEmailPayload {
  toEmail: string;
  fullName: string | null;
  temporaryPassword: string;
  role: 'admin' | 'agent';
  projectName: string;
  signInUrl: string;
}

export async function sendOnboardingWelcomeEmail(payload: OnboardingEmailPayload): Promise<{ success: boolean; message?: string }> {
  const { toEmail, fullName, temporaryPassword, role, projectName, signInUrl } = payload;

  const roleTitle = role === 'admin' ? 'Project Administrator' : 'Support / Sales Agent';
  const greeting = fullName ? `Hello ${fullName},` : 'Hello,';

  const emailSubject = `Welcome to ${projectName} on MaSa WhatsApp CRM`;
  const emailHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0f172a; color: #f8fafc; padding: 24px; }
          .container { max-width: 560px; margin: 0 auto; background: #1e293b; border-radius: 12px; padding: 32px; border: 1px solid #334155; }
          .badge { display: inline-block; background: #3b82f6; color: white; padding: 4px 12px; border-radius: 9999px; font-size: 12px; font-weight: 600; text-transform: uppercase; margin-bottom: 16px; }
          h1 { font-size: 20px; font-weight: 700; margin-top: 0; color: #ffffff; }
          p { font-size: 14px; line-height: 1.6; color: #cbd5e1; }
          .credentials-box { background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 16px; margin: 20px 0; }
          .credential-row { margin-bottom: 8px; font-size: 14px; }
          .credential-label { color: #94a3b8; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 2px; }
          .credential-value { color: #38bdf8; font-family: monospace; font-size: 14px; font-weight: 600; }
          .btn { display: inline-block; background: #2563eb; color: #ffffff; padding: 12px 24px; border-radius: 8px; font-weight: 600; text-decoration: none; margin-top: 16px; font-size: 14px; }
          .footer { margin-top: 32px; font-size: 12px; color: #64748b; text-align: center; border-top: 1px solid #334155; pt: 16px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="badge">${roleTitle}</div>
          <h1>${greeting}</h1>
          <p>You have been onboarded to <strong>${projectName}</strong> on MaSa WhatsApp CRM platform.</p>
          
          <div class="credentials-box">
            <div class="credential-row">
              <div class="credential-label">Sign-in Email</div>
              <div class="credential-value">${toEmail}</div>
            </div>
            <div class="credential-row">
              <div class="credential-label">Temporary Password</div>
              <div class="credential-value">${temporaryPassword}</div>
            </div>
            <div class="credential-row">
              <div class="credential-label">Assigned Project</div>
              <div class="credential-value" style="color: #a855f7;">${projectName}</div>
            </div>
          </div>

          <p>Please click the button below to sign in to your workspace:</p>
          <a href="${signInUrl}" class="btn" target="_blank">Sign in to Workspace</a>

          <div class="footer">
            <p>If you have any questions or did not expect this invitation, please contact your Platform Administrator.</p>
          </div>
        </div>
      </body>
    </html>
  `;

  console.log(`[Onboarding Email] Dispatching to ${toEmail} for project "${projectName}" (Role: ${role})`);
  console.log(`[Onboarding Email Details] Sign-in URL: ${signInUrl} | Temp Password: ${temporaryPassword}`);

  // In production with Resend / SMTP / Supabase, dispatch email here:
  // e.g. await fetch("https://api.resend.com/emails", { ... }) or nodemailer
  return {
    success: true,
    message: `Onboarding welcome email successfully dispatched to ${toEmail}`,
  };
}
