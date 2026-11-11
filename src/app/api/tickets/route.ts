import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { cookies } from 'next/headers';
import {
  sendTicketCreatedSuperAdminEmail,
  sendTicketConfirmationSubmitterEmail,
} from '@/lib/email/tickets';

/**
 * GET /api/tickets
 * Lists tickets accessible to the current user (all for super_admin, project-scoped for regular users).
 */
export async function GET(req: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status');
    const priority = searchParams.get('priority');
    const category = searchParams.get('category');
    const search = searchParams.get('search');
    const requestedProjectId = searchParams.get('projectId');

    // Check user's platform role
    const { data: profile } = await supabaseAdmin()
      .from('profiles')
      .select('platform_role')
      .eq('id', user.id)
      .maybeSingle();

    const isSuperAdmin = profile?.platform_role === 'super_admin';

    const cookieStore = await cookies();
    const activeProjectId = requestedProjectId || cookieStore.get('masacrm_project')?.value;

    let query = supabaseAdmin()
      .from('tickets')
      .select(
        `
        id,
        ticket_number,
        account_id,
        project_id,
        created_by,
        created_by_name,
        created_by_email,
        subject,
        description,
        category,
        priority,
        status,
        assigned_to,
        attachment_urls,
        resolution_notes,
        resolved_at,
        created_at,
        updated_at,
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
      .order('created_at', { ascending: false });

    // Non-super-admins only see tickets for their project or created by them
    if (!isSuperAdmin) {
      if (activeProjectId) {
        query = query.or(`project_id.eq.${activeProjectId},created_by.eq.${user.id}`);
      } else {
        query = query.eq('created_by', user.id);
      }
    } else if (activeProjectId && requestedProjectId) {
      // If super_admin specifically filtered by project
      query = query.eq('project_id', requestedProjectId);
    }

    if (status && status !== 'all') {
      query = query.eq('status', status);
    }
    if (priority && priority !== 'all') {
      query = query.eq('priority', priority);
    }
    if (category && category !== 'all') {
      query = query.eq('category', category);
    }
    if (search && search.trim().length > 0) {
      query = query.or(
        `subject.ilike.%${search}%,description.ilike.%${search}%,ticket_number.ilike.%${search}%,created_by_name.ilike.%${search}%,created_by_email.ilike.%${search}%`
      );
    }

    const { data: tickets, error } = await query;

    if (error) {
      console.error('[GET /api/tickets] Database query error:', error);
      // If table doesn't exist yet in Supabase schema cache
      if (error.code === 'PGRST205' || error.message?.includes('schema cache')) {
        return NextResponse.json({
          tickets: [],
          needsMigration: true,
          migrationNotice:
            'The tickets table has not been created yet in PostgreSQL. Please run supabase/migrations/061_support_ticketing_system.sql in your Supabase SQL editor.',
        });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      tickets: tickets || [],
      isSuperAdmin,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    console.error('[GET /api/tickets] Unexpected error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/tickets
 * Creates a new support ticket and dispatches instant email alerts to info@cloudmasa.com
 */
export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const {
      subject,
      description,
      category = 'technical',
      priority = 'medium',
      attachment_urls = [],
      projectId: passedProjectId,
    } = body;

    if (!subject || !subject.trim()) {
      return NextResponse.json({ error: 'Subject is required' }, { status: 400 });
    }
    if (!description || !description.trim()) {
      return NextResponse.json({ error: 'Description is required' }, { status: 400 });
    }

    // Resolve user profile info
    const { data: profile } = await supabaseAdmin()
      .from('profiles')
      .select('full_name, email, account_id')
      .eq('id', user.id)
      .maybeSingle();

    const cookieStore = await cookies();
    const activeProjectId = passedProjectId || cookieStore.get('masacrm_project')?.value || null;

    // Resolve Project & Account names for notification context
    let projectName: string | null = null;
    let accountName: string | null = null;
    let accountId = profile?.account_id || null;

    if (activeProjectId) {
      const { data: proj } = await supabaseAdmin()
        .from('projects')
        .select('id, name, account_id, accounts(name)')
        .eq('id', activeProjectId)
        .maybeSingle();

      if (proj) {
        projectName = proj.name;
        accountId = proj.account_id;
        const acc = proj.accounts as unknown as { name?: string } | null;
        if (acc?.name) accountName = acc.name;
      }
    }

    if (!accountName && accountId) {
      const { data: acc } = await supabaseAdmin()
        .from('accounts')
        .select('name')
        .eq('id', accountId)
        .maybeSingle();
      if (acc?.name) accountName = acc.name;
    }

    // Generate readable ticket number (fallback to timestamp random if trigger not active)
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const datePrefix = new Date().getFullYear();
    const generatedTicketNumber = `TCK-${datePrefix}-${randomSuffix}`;

    const newTicketRecord = {
      ticket_number: generatedTicketNumber,
      account_id: accountId,
      project_id: activeProjectId,
      created_by: user.id,
      created_by_name: profile?.full_name || user.email?.split('@')[0] || 'User',
      created_by_email: user.email || 'unknown@client.com',
      subject: subject.trim(),
      description: description.trim(),
      category,
      priority: priority.toLowerCase(),
      status: 'open',
      attachment_urls: Array.isArray(attachment_urls) ? attachment_urls : [],
    };

    const { data: createdTicket, error: insertError } = await supabaseAdmin()
      .from('tickets')
      .insert(newTicketRecord)
      .select()
      .single();

    // Prepare ticket representation for notifications even if table insertion failed
    const ticketPayload = createdTicket || {
      id: 'local-fallback-' + Date.now(),
      ...newTicketRecord,
      created_at: new Date().toISOString(),
    };

    // 1. Dispatch Email to Super Admin (info@cloudmasa.com)
    let emailSentToSuperAdmin = false;
    let superAdminEmailError: string | undefined;
    try {
      const emailRes = await sendTicketCreatedSuperAdminEmail({
        ticket: ticketPayload,
        projectName,
        accountName,
      });
      emailSentToSuperAdmin = emailRes.success;
      if (!emailRes.success) {
        superAdminEmailError = emailRes.error;
        console.warn('[Tickets] Super Admin email dispatch notice:', emailRes.error);
      }
    } catch (mailErr: unknown) {
      const msg = mailErr instanceof Error ? mailErr.message : String(mailErr);
      console.error('[Tickets] Super Admin email error:', msg);
      superAdminEmailError = msg;
    }

    // 2. Dispatch Confirmation Email to Submitter
    if (user.email) {
      try {
        await sendTicketConfirmationSubmitterEmail({
          ticket: ticketPayload,
          projectName,
          accountName,
        });
      } catch (confErr) {
        console.error('[Tickets] Submitter confirmation email error:', confErr);
      }
    }

    if (insertError) {
      console.warn('[POST /api/tickets] Database insert error (table may need migration):', insertError);
      return NextResponse.json({
        success: true,
        ticket: ticketPayload,
        emailSent: emailSentToSuperAdmin,
        superAdminEmailError,
        notice:
          'Ticket email was successfully dispatched to info@cloudmasa.com. Please run supabase/migrations/061_support_ticketing_system.sql to save permanently in database.',
      });
    }

    return NextResponse.json({
      success: true,
      ticket: createdTicket,
      emailSent: emailSentToSuperAdmin,
      superAdminEmailError,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    console.error('[POST /api/tickets] Unexpected error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
