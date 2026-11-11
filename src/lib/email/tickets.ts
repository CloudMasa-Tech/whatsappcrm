/**
 * Support Ticket Email Notification Service
 *
 * Dispatches ticket creation and status update notifications directly to
 * the Super Admin (info@cloudmasa.com) and the ticket submitters.
 */

import { sendEmail } from '@/lib/email/transport';

export interface TicketData {
  id: string;
  ticket_number: string;
  subject: string;
  description: string;
  category: string;
  priority: string;
  status: string;
  created_by_name?: string | null;
  created_by_email: string;
  account_id?: string | null;
  project_id?: string | null;
  attachment_urls?: string[] | null;
  resolution_notes?: string | null;
  created_at?: string;
}

export interface TicketEmailContext {
  ticket: TicketData;
  projectName?: string | null;
  accountName?: string | null;
}

const SUPERADMIN_DEFAULT_EMAIL = 'info@cloudmasa.com';

export function getSuperAdminSupportEmail(): string {
  return (
    process.env.SUPERADMIN_SUPPORT_EMAIL ||
    process.env.SUPERADMIN_EMAIL ||
    process.env.SMTP_FROM ||
    SUPERADMIN_DEFAULT_EMAIL
  ).trim();
}

function getPriorityColor(priority: string): { bg: string; text: string; border: string } {
  switch (priority.toLowerCase()) {
    case 'urgent':
      return { bg: '#ef4444', text: '#ffffff', border: '#b91c1c' };
    case 'high':
      return { bg: '#f97316', text: '#ffffff', border: '#c2410c' };
    case 'medium':
      return { bg: '#3b82f6', text: '#ffffff', border: '#1d4ed8' };
    case 'low':
    default:
      return { bg: '#64748b', text: '#ffffff', border: '#475569' };
  }
}

function getCategoryLabel(category: string): string {
  const map: Record<string, string> = {
    whatsapp_gateway: 'WhatsApp Gateway / Connection',
    technical: 'Technical Issue / System Error',
    bug_report: 'Bug Report',
    billing: 'Billing & Quota',
    feature_request: 'Feature Request',
    account_access: 'Account & Team Access',
    other: 'General Inquiry',
  };
  return map[category] || category.replace(/_/g, ' ').toUpperCase();
}

/**
 * Dispatches an instant high-priority alert email to the Super Admin (info@cloudmasa.com)
 * when a new support ticket is raised anywhere on the platform.
 */
export async function sendTicketCreatedSuperAdminEmail(
  context: TicketEmailContext
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const { ticket, projectName, accountName } = context;
  const superAdminEmail = getSuperAdminSupportEmail();
  const baseUrl = (process.env.NEXT_PUBLIC_SITE_URL || 'https://masacrm.cloudmasa.com').trim().replace(/\/+$/, '');
  const adminTicketUrl = `${baseUrl}/admin/tickets?ticketId=${encodeURIComponent(ticket.id)}`;

  const pColor = getPriorityColor(ticket.priority);
  const catLabel = getCategoryLabel(ticket.category);
  const priorityUpper = ticket.priority.toUpperCase();
  const submitterName = ticket.created_by_name || 'Project User';

  const subject = `🚨 [Support Ticket #${ticket.ticket_number}] [${priorityUpper}] ${ticket.subject}`;

  const attachmentsListHtml =
    ticket.attachment_urls && ticket.attachment_urls.length > 0
      ? `
        <div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid #334155;">
          <div style="font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; margin-bottom: 8px;">
            Attached Files (${ticket.attachment_urls.length})
          </div>
          <ul style="margin: 0; padding-left: 20px; color: #38bdf8; font-size: 13px;">
            ${ticket.attachment_urls
              .map(
                (url, i) =>
                  `<li style="margin-bottom: 4px;"><a href="${url}" target="_blank" style="color: #38bdf8; text-decoration: underline;">Attachment #${i + 1} (${url.split('/').pop() || 'View File'})</a></li>`
              )
              .join('')}
          </ul>
        </div>
      `
      : '';

  const html = `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${subject}</title>
      </head>
      <body style="margin: 0; padding: 24px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #090d16; color: #f8fafc;">
        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 620px; background-color: #111827; border-radius: 12px; border: 1px solid #1f2937; padding: 32px; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);">
                <tr>
                  <td>
                    <!-- Header Bar -->
                    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 24px;">
                      <tr>
                        <td align="left">
                          <img src="${baseUrl}/logo.png" alt="CloudMaSa" width="190" style="display: block; max-width: 190px; height: auto;" />
                        </td>
                        <td align="right">
                          <span style="display: inline-block; background-color: ${pColor.bg}; color: ${pColor.text}; padding: 4px 12px; border-radius: 9999px; font-size: 11px; font-weight: 800; letter-spacing: 0.05em; text-transform: uppercase;">
                            ${priorityUpper} PRIORITY
                          </span>
                        </td>
                      </tr>
                    </table>

                    <!-- Alert Banner -->
                    <div style="background-color: #1e1b4b; border: 1px solid #3730a3; border-radius: 8px; padding: 14px 18px; margin-bottom: 24px;">
                      <div style="font-size: 13px; font-weight: 600; color: #c7d2fe; display: flex; align-items: center;">
                        <span style="font-size: 16px; margin-right: 8px;">🎫</span>
                        New Support Ticket Escalation (#${ticket.ticket_number})
                      </div>
                    </div>

                    <!-- Title & Subject -->
                    <h1 style="font-size: 20px; font-weight: 700; margin: 0 0 16px 0; color: #ffffff; line-height: 1.4;">
                      ${ticket.subject}
                    </h1>

                    <!-- Metadata Grid -->
                    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #1a2234; border: 1px solid #283548; border-radius: 8px; margin-bottom: 24px; padding: 16px;">
                      <tr>
                        <td width="50%" style="padding: 6px 12px; vertical-align: top;">
                          <div style="font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; margin-bottom: 2px;">Submitter</div>
                          <div style="font-size: 14px; font-weight: 600; color: #f8fafc;">${submitterName}</div>
                          <div style="font-size: 12px; color: #38bdf8;"><a href="mailto:${ticket.created_by_email}" style="color: #38bdf8; text-decoration: none;">${ticket.created_by_email}</a></div>
                        </td>
                        <td width="50%" style="padding: 6px 12px; vertical-align: top;">
                          <div style="font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; margin-bottom: 2px;">Category</div>
                          <div style="font-size: 13px; font-weight: 600; color: #a5b4fc;">${catLabel}</div>
                        </td>
                      </tr>
                      <tr>
                        <td width="50%" style="padding: 6px 12px; vertical-align: top; border-top: 1px solid #243044;">
                          <div style="font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; margin-bottom: 2px;">Project Workspace</div>
                          <div style="font-size: 13px; font-weight: 600; color: #e2e8f0;">${projectName || 'Default Project'}</div>
                        </td>
                        <td width="50%" style="padding: 6px 12px; vertical-align: top; border-top: 1px solid #243044;">
                          <div style="font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; margin-bottom: 2px;">Account / Client</div>
                          <div style="font-size: 13px; font-weight: 600; color: #e2e8f0;">${accountName || 'Primary Account'}</div>
                        </td>
                      </tr>
                    </table>

                    <!-- Description Box -->
                    <div style="margin-bottom: 24px;">
                      <div style="font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px;">
                        Ticket Description
                      </div>
                      <div style="background-color: #0b1120; border: 1px solid #26334d; border-radius: 8px; padding: 18px; color: #e2e8f0; font-size: 14px; line-height: 1.6; white-space: pre-wrap;">
${ticket.description}
${attachmentsListHtml}
                      </div>
                    </div>

                    <!-- Direct Action Button -->
                    <div style="text-align: center; margin: 32px 0 24px 0;">
                      <a href="${adminTicketUrl}" target="_blank" style="display: inline-block; background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); color: #ffffff; padding: 14px 28px; border-radius: 8px; font-size: 15px; font-weight: 700; text-decoration: none; box-shadow: 0 4px 14px rgba(37, 99, 235, 0.4);">
                        Open & Resolve in Super Admin Console &rarr;
                      </a>
                    </div>

                    <!-- Footer Note -->
                    <div style="border-top: 1px solid #1f2937; padding-top: 20px; font-size: 12px; color: #64748b; text-align: center; line-height: 1.5;">
                      This escalation was automatically dispatched by CloudMaSa CRM Support Engine.<br/>
                      Ticket ID: <code style="color: #94a3b8; font-family: monospace;">${ticket.id}</code> &bull; Destination: <strong>${superAdminEmail}</strong>
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

  return sendEmail({
    to: superAdminEmail,
    subject,
    html,
    text: `NEW SUPPORT TICKET #${ticket.ticket_number} [${priorityUpper}]\n\nSubject: ${ticket.subject}\nCategory: ${catLabel}\nSubmitter: ${submitterName} (${ticket.created_by_email})\nProject: ${projectName || 'N/A'}\n\nDescription:\n${ticket.description}\n\nReview Ticket: ${adminTicketUrl}`,
  });
}

/**
 * Sends a confirmation receipt email back to the user who submitted the ticket.
 */
export async function sendTicketConfirmationSubmitterEmail(
  context: TicketEmailContext
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const { ticket, projectName } = context;
  const baseUrl = (process.env.NEXT_PUBLIC_SITE_URL || 'https://masacrm.cloudmasa.com').trim().replace(/\/+$/, '');
  const userTicketUrl = `${baseUrl}/tickets`;

  const subject = `[Received] Support Ticket #${ticket.ticket_number}: ${ticket.subject}`;

  const html = `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${subject}</title>
      </head>
      <body style="margin: 0; padding: 24px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #090d16; color: #f8fafc;">
        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 580px; background-color: #111827; border-radius: 12px; border: 1px solid #1f2937; padding: 32px;">
                <tr>
                  <td>
                    <div style="margin-bottom: 24px;">
                      <img src="${baseUrl}/logo.png" alt="CloudMaSa CRM" width="180" style="display: block; max-width: 180px; height: auto;" />
                    </div>

                    <h1 style="font-size: 20px; font-weight: 700; margin: 0 0 12px 0; color: #ffffff;">
                      Support Ticket Received (#${ticket.ticket_number})
                    </h1>

                    <p style="font-size: 14px; line-height: 1.6; color: #cbd5e1; margin: 0 0 20px 0;">
                      Hello ${ticket.created_by_name || 'there'},<br/>
                      We have received your support request regarding <strong>"${ticket.subject}"</strong>. Our engineering & support team at <strong>info@cloudmasa.com</strong> has been notified and is reviewing your ticket.
                    </p>

                    <div style="background-color: #1a2234; border: 1px solid #283548; border-radius: 8px; padding: 18px; margin-bottom: 24px;">
                      <div style="font-size: 12px; color: #94a3b8; margin-bottom: 4px;">Ticket Reference Number</div>
                      <div style="font-size: 16px; font-weight: 700; color: #38bdf8; font-family: monospace;">#${ticket.ticket_number}</div>
                      <div style="margin-top: 10px; font-size: 13px; color: #e2e8f0;">
                        <strong>Priority:</strong> ${ticket.priority.toUpperCase()} &bull; <strong>Status:</strong> ${ticket.status.toUpperCase()}
                      </div>
                    </div>

                    <div style="text-align: center; margin: 28px 0;">
                      <a href="${userTicketUrl}" target="_blank" style="display: inline-block; background-color: #2563eb; color: #ffffff; padding: 12px 24px; border-radius: 6px; font-size: 14px; font-weight: 600; text-decoration: none;">
                        View Your Tickets in CRM &rarr;
                      </a>
                    </div>

                    <p style="font-size: 12px; color: #64748b; line-height: 1.5; margin: 0;">
                      If you have further updates, reply to this email or post a message directly in your CRM ticket view.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;

  return sendEmail({
    to: ticket.created_by_email,
    subject,
    html,
    text: `Support Ticket Received (#${ticket.ticket_number})\n\nWe received your support request: "${ticket.subject}". Our support team (info@cloudmasa.com) is currently reviewing it.\n\nTicket Reference: #${ticket.ticket_number}\nStatus: ${ticket.status.toUpperCase()}`,
  });
}

/**
 * Dispatches an email notification when a ticket's status is changed (e.g. In Progress, Resolved).
 */
export async function sendTicketStatusUpdateEmail(
  context: TicketEmailContext & { oldStatus: string; newStatus: string; resolutionNotes?: string | null }
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const { ticket, newStatus, resolutionNotes } = context;
  const baseUrl = (process.env.NEXT_PUBLIC_SITE_URL || 'https://masacrm.cloudmasa.com').trim().replace(/\/+$/, '');
  const userTicketUrl = `${baseUrl}/tickets`;

  const subject = `[Status Update] Support Ticket #${ticket.ticket_number} is now ${newStatus.toUpperCase()}`;

  const resolutionBox =
    resolutionNotes && resolutionNotes.trim().length > 0
      ? `
        <div style="background-color: #0f172a; border-left: 4px solid #10b981; padding: 14px 18px; margin: 20px 0; border-radius: 0 8px 8px 0;">
          <div style="font-size: 11px; font-weight: 700; color: #34d399; text-transform: uppercase; margin-bottom: 4px;">Resolution / Support Notes</div>
          <div style="font-size: 14px; color: #e2e8f0; line-height: 1.5; white-space: pre-wrap;">${resolutionNotes}</div>
        </div>
      `
      : '';

  const html = `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${subject}</title>
      </head>
      <body style="margin: 0; padding: 24px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #090d16; color: #f8fafc;">
        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 580px; background-color: #111827; border-radius: 12px; border: 1px solid #1f2937; padding: 32px;">
                <tr>
                  <td>
                    <div style="margin-bottom: 24px;">
                      <img src="${baseUrl}/logo.png" alt="CloudMaSa CRM" width="180" style="display: block; max-width: 180px; height: auto;" />
                    </div>

                    <h1 style="font-size: 20px; font-weight: 700; margin: 0 0 12px 0; color: #ffffff;">
                      Ticket Status Updated: ${newStatus.toUpperCase()}
                    </h1>

                    <p style="font-size: 14px; line-height: 1.6; color: #cbd5e1; margin: 0 0 16px 0;">
                      Your support ticket <strong>#${ticket.ticket_number}</strong> (${ticket.subject}) has been updated to <strong>${newStatus.toUpperCase()}</strong> by the CloudMaSa support team.
                    </p>

                    ${resolutionBox}

                    <div style="text-align: center; margin: 28px 0;">
                      <a href="${userTicketUrl}" target="_blank" style="display: inline-block; background-color: #2563eb; color: #ffffff; padding: 12px 24px; border-radius: 6px; font-size: 14px; font-weight: 600; text-decoration: none;">
                        View Ticket Details &rarr;
                      </a>
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

  return sendEmail({
    to: ticket.created_by_email,
    subject,
    html,
    text: `Support Ticket #${ticket.ticket_number} Status Updated\n\nYour ticket "${ticket.subject}" is now ${newStatus.toUpperCase()}.\n\n${resolutionNotes ? `Resolution Notes:\n${resolutionNotes}\n\n` : ''}View Ticket: ${userTicketUrl}`,
  });
}
