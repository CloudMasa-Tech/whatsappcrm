import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email/transport';
import { getSuperAdminSupportEmail } from '@/lib/email/tickets';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/tickets/[id]/replies
 * Retrieves replies for a ticket.
 */
export async function GET(req: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: profile } = await supabaseAdmin()
      .from('profiles')
      .select('platform_role')
      .eq('id', user.id)
      .maybeSingle();

    const isSuperAdmin = profile?.platform_role === 'super_admin';

    let query = supabaseAdmin()
      .from('ticket_replies')
      .select('*')
      .eq('ticket_id', id)
      .order('created_at', { ascending: true });

    if (!isSuperAdmin) {
      query = query.eq('is_internal', false);
    }

    const { data: replies, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ replies: replies || [] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/tickets/[id]/replies
 * Appends a message to the ticket thread and notifies the recipient by email.
 */
export async function POST(req: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { message, is_internal = false, attachment_urls = [] } = body;

    if (!message || !message.trim()) {
      return NextResponse.json({ error: 'Message cannot be empty' }, { status: 400 });
    }

    // Resolve ticket
    const { data: ticket, error: ticketError } = await supabaseAdmin()
      .from('tickets')
      .select('*, projects(name), accounts(name)')
      .eq('id', id)
      .single();

    if (ticketError || !ticket) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }

    const { data: profile } = await supabaseAdmin()
      .from('profiles')
      .select('platform_role, full_name, email')
      .eq('id', user.id)
      .maybeSingle();

    const isSuperAdmin = profile?.platform_role === 'super_admin';
    const userRole = isSuperAdmin ? 'super_admin' : 'agent';
    const userName = profile?.full_name || user.email?.split('@')[0] || 'User';

    const newReply = {
      ticket_id: id,
      user_id: user.id,
      user_name: userName,
      user_email: user.email || 'unknown@client.com',
      user_role: userRole,
      message: message.trim(),
      is_internal: Boolean(is_internal && isSuperAdmin),
      attachment_urls: Array.isArray(attachment_urls) ? attachment_urls : [],
    };

    const { data: insertedReply, error: insertError } = await supabaseAdmin()
      .from('ticket_replies')
      .insert(newReply)
      .select()
      .single();

    if (insertError) {
      console.warn('[POST /api/tickets/[id]/replies] Insert error:', insertError);
    }

    // Update ticket updated_at
    await supabaseAdmin()
      .from('tickets')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', id);

    // Email Notification logic (only if not an internal note)
    if (!is_internal) {
      const baseUrl = (process.env.NEXT_PUBLIC_SITE_URL || 'https://masacrm.cloudmasa.com').trim().replace(/\/+$/, '');

      if (isSuperAdmin) {
        // Super Admin replied -> Notify customer
        if (ticket.created_by_email) {
          const userTicketUrl = `${baseUrl}/tickets`;
          const subject = `[Support Reply] Ticket #${ticket.ticket_number}: ${ticket.subject}`;
          const html = `
            <div style="font-family: -apple-system, sans-serif; background-color: #090d16; color: #f8fafc; padding: 24px;">
              <div style="max-width: 580px; margin: 0 auto; background-color: #111827; border-radius: 12px; padding: 28px; border: 1px solid #1f2937;">
                <h2 style="color: #ffffff; margin-top: 0;">New Message on Support Ticket #${ticket.ticket_number}</h2>
                <p style="color: #cbd5e1; font-size: 14px;"><strong>${userName} (CloudMaSa Support Team)</strong> replied:</p>
                <div style="background-color: #1a2234; border-left: 4px solid #3b82f6; padding: 16px; border-radius: 4px; color: #e2e8f0; font-size: 14px; white-space: pre-wrap; line-height: 1.6;">${message.trim()}</div>
                <div style="margin-top: 24px; text-align: center;">
                  <a href="${userTicketUrl}" style="background-color: #2563eb; color: #ffffff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: 600;">View Conversation in CRM &rarr;</a>
                </div>
              </div>
            </div>
          `;
          try {
            await sendEmail({
              to: ticket.created_by_email,
              subject,
              html,
              text: `New Reply on Ticket #${ticket.ticket_number}\n\n${userName} replied:\n${message.trim()}\n\nView Ticket: ${userTicketUrl}`,
            });
          } catch (e) {
            console.error('[Tickets] Error notifying customer of reply:', e);
          }
        }
      } else {
        // Customer replied -> Notify Super Admin (info@cloudmasa.com)
        const superAdminEmail = getSuperAdminSupportEmail();
        const adminTicketUrl = `${baseUrl}/admin/tickets?ticketId=${encodeURIComponent(ticket.id)}`;
        const subject = `💬 [Client Reply] Support Ticket #${ticket.ticket_number}: ${ticket.subject}`;
        const html = `
          <div style="font-family: -apple-system, sans-serif; background-color: #090d16; color: #f8fafc; padding: 24px;">
            <div style="max-width: 580px; margin: 0 auto; background-color: #111827; border-radius: 12px; padding: 28px; border: 1px solid #1f2937;">
              <h2 style="color: #ffffff; margin-top: 0;">Client Reply on Ticket #${ticket.ticket_number}</h2>
              <p style="color: #cbd5e1; font-size: 14px;"><strong>${userName} (${user.email})</strong> added a message:</p>
              <div style="background-color: #1a2234; border-left: 4px solid #10b981; padding: 16px; border-radius: 4px; color: #e2e8f0; font-size: 14px; white-space: pre-wrap; line-height: 1.6;">${message.trim()}</div>
              <div style="margin-top: 24px; text-align: center;">
                <a href="${adminTicketUrl}" style="background-color: #2563eb; color: #ffffff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: 600;">Open Ticket in Admin Console &rarr;</a>
              </div>
            </div>
          </div>
        `;
        try {
          await sendEmail({
            to: superAdminEmail,
            subject,
            html,
            text: `Client Reply on Ticket #${ticket.ticket_number}\n\n${userName} (${user.email}):\n${message.trim()}\n\nAdmin View: ${adminTicketUrl}`,
          });
        } catch (e) {
          console.error('[Tickets] Error notifying Super Admin of reply:', e);
        }
      }
    }

    return NextResponse.json({
      success: true,
      reply: insertedReply || newReply,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
