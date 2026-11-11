import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendTicketStatusUpdateEmail } from '@/lib/email/tickets';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/tickets/[id]
 * Retrieves full ticket profile with conversation replies.
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

    const { data: ticket, error: ticketError } = await supabaseAdmin()
      .from('tickets')
      .select(
        `
        *,
        projects (
          id,
          name
        ),
        accounts (
          id,
          name
        )
      `
      )
      .eq('id', id)
      .single();

    if (ticketError || !ticket) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }

    // Check permissions: Super Admin or creator or account member
    const { data: profile } = await supabaseAdmin()
      .from('profiles')
      .select('platform_role')
      .eq('id', user.id)
      .maybeSingle();

    const isSuperAdmin = profile?.platform_role === 'super_admin';

    if (!isSuperAdmin && ticket.created_by !== user.id) {
      // Check account membership
      const { data: membership } = await supabaseAdmin()
        .from('account_members')
        .select('id')
        .eq('account_id', ticket.account_id)
        .eq('user_id', user.id)
        .maybeSingle();

      if (!membership) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    // Fetch replies
    let repliesQuery = supabaseAdmin()
      .from('ticket_replies')
      .select('*')
      .eq('ticket_id', id)
      .order('created_at', { ascending: true });

    // Non-super-admins cannot see internal notes
    if (!isSuperAdmin) {
      repliesQuery = repliesQuery.eq('is_internal', false);
    }

    const { data: replies } = await repliesQuery;

    return NextResponse.json({
      ticket,
      replies: replies || [],
      isSuperAdmin,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * PATCH /api/tickets/[id]
 * Updates ticket status, priority, resolution notes, or assigned agent.
 */
export async function PATCH(req: Request, context: RouteContext) {
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
    const { status, priority, category, resolution_notes, assigned_to } = body;

    // Fetch current ticket
    const { data: currentTicket, error: fetchErr } = await supabaseAdmin()
      .from('tickets')
      .select('*, projects(name), accounts(name)')
      .eq('id', id)
      .single();

    if (fetchErr || !currentTicket) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }

    const { data: profile } = await supabaseAdmin()
      .from('profiles')
      .select('platform_role, full_name')
      .eq('id', user.id)
      .maybeSingle();

    const isSuperAdmin = profile?.platform_role === 'super_admin';

    // Only super_admin or ticket creator / account admins can edit
    if (!isSuperAdmin && currentTicket.created_by !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (status) updates.status = status;
    if (priority) updates.priority = priority;
    if (category) updates.category = category;
    if (resolution_notes !== undefined) updates.resolution_notes = resolution_notes;
    if (assigned_to !== undefined) updates.assigned_to = assigned_to;

    if (status === 'resolved' && currentTicket.status !== 'resolved') {
      updates.resolved_at = new Date().toISOString();
    }

    const { data: updatedTicket, error: updateErr } = await supabaseAdmin()
      .from('tickets')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    // If status changed or resolution notes added, notify submitter via email
    if (
      status &&
      status !== currentTicket.status &&
      currentTicket.created_by_email
    ) {
      const proj = currentTicket.projects as unknown as { name?: string } | null;
      const acc = currentTicket.accounts as unknown as { name?: string } | null;

      try {
        await sendTicketStatusUpdateEmail({
          ticket: updatedTicket || currentTicket,
          projectName: proj?.name || null,
          accountName: acc?.name || null,
          oldStatus: currentTicket.status,
          newStatus: status,
          resolutionNotes: resolution_notes || currentTicket.resolution_notes,
        });
      } catch (mailErr) {
        console.error('[PATCH /api/tickets/[id]] Status update email error:', mailErr);
      }
    }

    return NextResponse.json({
      success: true,
      ticket: updatedTicket,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/tickets/[id]
 * Super admin can delete tickets.
 */
export async function DELETE(req: Request, context: RouteContext) {
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

    if (profile?.platform_role !== 'super_admin') {
      return NextResponse.json({ error: 'Only Super Admins can delete tickets' }, { status: 403 });
    }

    const { error: delErr } = await supabaseAdmin()
      .from('tickets')
      .delete()
      .eq('id', id);

    if (delErr) {
      return NextResponse.json({ error: delErr.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
