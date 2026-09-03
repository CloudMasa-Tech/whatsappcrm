/**
 * Onboarding Email Service
 *
 * Dispatches account credential and access details to newly created customers/users
 * via the configured SMTP / Email provider.
 */

import { sendEmail } from '@/lib/email/transport';

export interface OnboardingEmailPayload {
  toEmail: string;
  fullName: string | null;
  temporaryPassword: string;
  role: 'admin' | 'agent';
  projectName: string;
  signInUrl: string;
  projectId?: string;
  accountId?: string;
}

export async function sendOnboardingWelcomeEmail(
  payload: OnboardingEmailPayload
): Promise<{ success: boolean; message?: string; error?: string }> {
  const { toEmail, fullName, temporaryPassword, role, projectName, projectId, accountId } = payload;

  // Ensure signInUrl is always a clean valid https URL pointing to crm.cloudmasa.com
  const baseUrl = (process.env.NEXT_PUBLIC_SITE_URL || 'https://crm.cloudmasa.com').trim().replace(/\/+$/, '');
  const signInUrl = `${baseUrl}/login`;

  const roleTitle = role === 'admin' ? 'Project Administrator' : 'Support / Sales Agent';
  const greeting = fullName ? `Hello ${fullName},` : 'Hello,';

  const emailSubject = `Welcome to ${projectName} on MaSa WhatsApp CRM`;
  const emailHtml = `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${emailSubject}</title>
      </head>
      <body style="margin: 0; padding: 24px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0f172a; color: #f8fafc;">
        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 580px; background-color: #1e293b; border-radius: 12px; border: 1px solid #334155; padding: 32px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.3);">
                <tr>
                  <td>
                    <!-- Brand Logo -->
                    <div style="margin-bottom: 24px;">
                      <img src="${baseUrl}/logo.png" alt="CloudMaSa CRM" width="240" style="display: block; max-width: 240px; height: auto;" />
                    </div>

                    <!-- Role Badge -->
                    <div style="display: inline-block; background-color: #2563eb; color: #ffffff; padding: 6px 14px; border-radius: 20px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 20px;">
                      ${roleTitle}
                    </div>

                    <!-- Greeting -->
                    <h1 style="font-size: 22px; font-weight: 700; margin: 0 0 12px 0; color: #ffffff;">
                      ${greeting}
                    </h1>
                    <p style="font-size: 15px; line-height: 1.6; color: #cbd5e1; margin: 0 0 20px 0;">
                      You have been onboarded to <strong>${projectName}</strong> on MaSa WhatsApp CRM platform.
                    </p>

                    <!-- Credentials Box -->
                    <div style="background-color: #0f172a; border: 1px solid #334155; border-radius: 10px; padding: 20px; margin: 24px 0;">
                      <div style="margin-bottom: 12px;">
                        <div style="color: #94a3b8; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px;">
                          Sign-in Email
                        </div>
                        <div style="color: #38bdf8; font-family: monospace, Consolas, sans-serif; font-size: 15px; font-weight: 600;">
                          ${toEmail}
                        </div>
                      </div>

                      <div style="margin-bottom: 12px;">
                        <div style="color: #94a3b8; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px;">
                          Temporary Password
                        </div>
                        <div style="color: #4ade80; font-family: monospace, Consolas, sans-serif; font-size: 16px; font-weight: 700; letter-spacing: 0.02em;">
                          ${temporaryPassword}
                        </div>
                      </div>

                      <div>
                        <div style="color: #94a3b8; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px;">
                          Assigned Project
                        </div>
                        <div style="color: #c084fc; font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: 15px; font-weight: 600;">
                          ${projectName}
                        </div>
                      </div>
                    </div>

                    <!-- CTA Button -->
                    <p style="font-size: 14px; color: #cbd5e1; margin: 0 0 16px 0;">
                      Click the button below to sign in to your workspace:
                    </p>

                    <!-- Bulletproof Email Button -->
                    <table role="presentation" border="0" cellspacing="0" cellpadding="0" style="margin: 0 0 24px 0;">
                      <tr>
                        <td align="center" style="border-radius: 8px; background-color: #2563eb;">
                          <a href="${signInUrl}" target="_blank" rel="noopener noreferrer" style="display: inline-block; padding: 14px 28px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 15px; color: #ffffff; text-decoration: none; font-weight: 700; border-radius: 8px; background-color: #2563eb; border: 1px solid #3b82f6;">
                            Sign in to Workspace &rarr;
                          </a>
                        </td>
                      </tr>
                    </table>

                    <!-- Fallback Link -->
                    <div style="border-top: 1px solid #334155; padding-top: 16px; margin-top: 16px;">
                      <p style="font-size: 12px; color: #94a3b8; margin: 0 0 6px 0;">
                        Or copy and paste this link into your browser:
                      </p>
                      <a href="${signInUrl}" target="_blank" rel="noopener noreferrer" style="font-size: 13px; color: #38bdf8; word-break: break-all; text-decoration: underline;">
                        ${signInUrl}
                      </a>
                    </div>

                    <!-- Footer -->
                    <div style="margin-top: 32px; font-size: 12px; color: #64748b; text-align: center; border-top: 1px solid #334155; padding-top: 16px;">
                      <p style="margin: 0;">If you have any questions, please contact your Platform Administrator at info@cloudmasa.com.</p>
                      <p style="margin: 6px 0 0 0; color: #475569;">MaSa CRM &bull; Powered by CloudMaSa</p>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;

  const emailText = `${greeting}\n\nYou have been onboarded to ${projectName} on MaSa WhatsApp CRM.\n\nSign-in Email: ${toEmail}\nTemporary Password: ${temporaryPassword}\nAssigned Project: ${projectName}\n\nSign in at: ${signInUrl}\n\n(If you have questions, contact info@cloudmasa.com)\n`;

  console.log(`[Onboarding Email] Dispatching to ${toEmail} for project "${projectName}" (Login URL: ${signInUrl})`);

  const result = await sendEmail({
    to: toEmail,
    subject: emailSubject,
    html: emailHtml,
    text: emailText,
    projectId,
    accountId,
  });

  if (!result.success) {
    console.error(`[Onboarding Email] Delivery failed for ${toEmail}:`, result.error);
    return {
      success: false,
      error: result.error,
    };
  }

  return {
    success: true,
    message: `Onboarding welcome email successfully dispatched to ${toEmail}`,
  };
}
