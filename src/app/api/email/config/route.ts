import { NextResponse } from 'next/server';
import { toErrorResponse } from '@/lib/auth/account';
import { requireProjectRole, requireProject, getCurrentProject } from '@/lib/auth/project';
import { supabaseAdmin } from '@/lib/supabase/admin';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const requestedProject = url.searchParams.get('project_id');

    const projectCtx = requestedProject
      ? await requireProject(requestedProject, 'viewer').catch(() => null)
      : await getCurrentProject().catch(() => null);

    const projectId = requestedProject || projectCtx?.projectId;

    if (!projectId) {
      return NextResponse.json({
        configured: false,
        config: null,
      });
    }

    const { data } = await supabaseAdmin()
      .from('email_configs')
      .select('*')
      .eq('project_id', projectId)
      .eq('is_connected', true)
      .maybeSingle();

    if (!data) {
      return NextResponse.json({
        configured: false,
        project_id: projectId,
        config: null,
      });
    }

    return NextResponse.json({
      configured: true,
      project_id: projectId,
      config: {
        provider: data.provider || 'smtp',
        host: data.smtp_host,
        port: data.smtp_port || 587,
        secure: Boolean(data.smtp_secure),
        user: data.email_address,
        fromEmail: data.email_address,
        fromName: data.from_name || 'MaSa CRM',
        replyTo: data.reply_to || '',
        hasPassword: Boolean(data.email_password),
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as {
      project_id?: string;
      projectId?: string;
      provider?: string;
      host?: string;
      port?: number;
      secure?: boolean;
      user?: string;
      pass?: string;
      fromName?: string;
      fromEmail?: string;
      replyTo?: string;
    } | null;

    const requestedProject = body?.project_id || body?.projectId;

    const ctx = requestedProject
      ? await requireProject(requestedProject, 'admin')
      : await requireProjectRole('admin');

    const projectId = ctx.projectId;
    const accountId = ctx.accountId;

    if (!body || !body.host || !body.user || !body.fromEmail) {
      return NextResponse.json(
        { error: 'Host, Username, and From Email are required.' },
        { status: 400 }
      );
    }

    const host = body.host.trim();
    const port = Number(body.port) || (body.secure ? 465 : 587);
    const secure = Boolean(body.secure ?? port === 465);
    const user = body.user.trim();
    const pass = body.pass ? body.pass.trim() : '';
    const fromName = body.fromName?.trim() || 'MaSa CRM';
    const fromEmail = body.fromEmail.trim().toLowerCase();
    const replyTo = body.replyTo?.trim() || null;
    const provider = body.provider || 'smtp';

    // Check if existing config row exists for this project
    const { data: existing } = await supabaseAdmin()
      .from('email_configs')
      .select('id, email_password')
      .eq('project_id', projectId)
      .maybeSingle();

    // If updating without new password, retain existing password
    const finalPass = pass || (existing?.email_password ?? '');

    if (!finalPass) {
      return NextResponse.json(
        { error: 'Password is required to configure SMTP server.' },
        { status: 400 }
      );
    }

    const { error: upsertErr } = await supabaseAdmin()
      .from('email_configs')
      .upsert(
        {
          project_id: projectId,
          account_id: accountId,
          email_address: fromEmail,
          email_password: finalPass,
          provider,
          smtp_host: host,
          smtp_port: port,
          smtp_secure: secure,
          from_name: fromName,
          reply_to: replyTo,
          is_connected: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'project_id' }
      );

    if (upsertErr) {
      console.error('[POST /api/email/config] upsert error:', upsertErr);
      return NextResponse.json(
        { error: 'Failed to save email configuration for project.' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Email configuration saved successfully for this project.',
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    const requestedProject = url.searchParams.get('project_id');

    const ctx = requestedProject
      ? await requireProject(requestedProject, 'admin')
      : await requireProjectRole('admin');

    const { error } = await supabaseAdmin()
      .from('email_configs')
      .delete()
      .eq('project_id', ctx.projectId);

    if (error) {
      console.error('[DELETE /api/email/config] error:', error);
      return NextResponse.json(
        { error: 'Failed to disconnect email configuration.' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Email disconnected successfully for this project.',
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
