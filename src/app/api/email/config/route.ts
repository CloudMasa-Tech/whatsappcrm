import { NextResponse } from 'next/server';
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { resolveEmailConfig } from '@/lib/email/transport';

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const config = await resolveEmailConfig(undefined, ctx.accountId);

    if (!config) {
      return NextResponse.json({
        configured: false,
        config: null,
      });
    }

    return NextResponse.json({
      configured: true,
      config: {
        host: config.host,
        port: config.port,
        secure: config.secure,
        user: config.user,
        fromEmail: config.fromEmail,
        fromName: config.fromName,
        replyTo: config.replyTo,
        // Mask password for safety
        hasPassword: Boolean(config.pass),
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    // SMTP credentials decide where every outbound email originates, so
    // writing them is an admin action. Read (GET) stays open to members,
    // which only reveals whether email is configured.
    const ctx = await requireRole('admin');
    const body = (await request.json().catch(() => null)) as {
      host?: string;
      port?: number;
      secure?: boolean;
      user?: string;
      pass?: string;
      fromName?: string;
      fromEmail?: string;
      replyTo?: string;
    } | null;

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

    // Check if config row exists
    const { data: existing } = await supabaseAdmin()
      .from('email_configs')
      .select('id, smtp_pass')
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    // If updating without new password, retain existing password
    const finalPass = pass || (existing?.smtp_pass ?? '');

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
          account_id: ctx.accountId,
          smtp_host: host,
          smtp_port: port,
          smtp_secure: secure,
          smtp_user: user,
          smtp_pass: finalPass,
          from_name: fromName,
          from_email: fromEmail,
          reply_to: replyTo,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'account_id,project_id' }
      );

    if (upsertErr) {
      console.error('[POST /api/email/config] upsert error:', upsertErr);
      return NextResponse.json(
        { error: 'Failed to save email configuration.' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Email configuration saved successfully.',
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
