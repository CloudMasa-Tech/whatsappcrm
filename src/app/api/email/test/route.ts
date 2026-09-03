import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { sendEmail, createMailTransporter } from '@/lib/email/transport';

export async function POST(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const body = (await request.json().catch(() => null)) as {
      projectId?: string;
      project_id?: string;
      toEmail?: string;
      host?: string;
      port?: number;
      secure?: boolean;
      user?: string;
      pass?: string;
      fromName?: string;
      fromEmail?: string;
    } | null;

    const projectId = body?.projectId || body?.project_id;

    let to = body?.toEmail?.trim();
    if (!to) {
      const {
        data: { user },
      } = await ctx.supabase.auth.getUser();
      to = user?.email ?? '';
    }

    if (!to) {
      return NextResponse.json(
        { error: 'A recipient email address is required for testing.' },
        { status: 400 }
      );
    }

    // If ad-hoc SMTP parameters are passed in the request, test those directly
    if (body?.host && body?.user && body?.pass) {
      const port = Number(body.port) || (body.secure ? 465 : 587);
      const secure = Boolean(body.secure ?? port === 465);
      const fromEmail = body.fromEmail?.trim() || body.user.trim();
      const fromName = body.fromName?.trim() || 'MaSa CRM Test';

      try {
        const transporter = createMailTransporter({
          host: body.host.trim(),
          port,
          secure,
          user: body.user.trim(),
          pass: body.pass.trim(),
          fromEmail,
          fromName,
        });

        // Verify connection first
        await transporter.verify();

        // Send test email
        const info = await transporter.sendMail({
          from: `"${fromName}" <${fromEmail}>`,
          to,
          subject: 'MaSa WhatsApp CRM — Email Connection Test',
          html: `
            <div style="font-family: sans-serif; padding: 24px; background: #0f172a; color: #f8fafc; border-radius: 12px; max-width: 500px;">
              <h2 style="color: #38bdf8; margin-top: 0;">Email Connection Successful! 🎉</h2>
              <p style="color: #cbd5e1; font-size: 14px;">This test message confirms that your SMTP server (<strong>${body.host}</strong>) is correctly configured and ready to send emails.</p>
              <div style="background: #1e293b; padding: 12px; border-radius: 8px; font-size: 12px; color: #94a3b8; margin-top: 16px;">
                Timestamp: ${new Date().toUTCString()}
              </div>
            </div>
          `,
          text: `Email Connection Successful!\n\nThis test message confirms that your SMTP server (${body.host}) is correctly configured and ready to send emails.`,
        });

        return NextResponse.json({
          success: true,
          message: `Test email successfully sent to ${to}! (Message ID: ${info.messageId})`,
        });
      } catch (transportErr) {
        const msg = transportErr instanceof Error ? transportErr.message : 'SMTP connection test failed';
        console.error('[POST /api/email/test] direct test failed:', msg);
        return NextResponse.json({ error: msg }, { status: 400 });
      }
    }

    // Otherwise test the stored configuration for the project/account
    const result = await sendEmail({
      to,
      subject: 'MaSa WhatsApp CRM — Email Connection Test',
      html: `
        <div style="font-family: sans-serif; padding: 24px; background: #0f172a; color: #f8fafc; border-radius: 12px; max-width: 500px;">
          <h2 style="color: #38bdf8; margin-top: 0;">Email Connection Successful! 🎉</h2>
          <p style="color: #cbd5e1; font-size: 14px;">This test message confirms that your email provider is connected and ready to send onboarding credentials and broadcasts.</p>
          <div style="background: #1e293b; padding: 12px; border-radius: 8px; font-size: 12px; color: #94a3b8; margin-top: 16px;">
            Timestamp: ${new Date().toUTCString()}
          </div>
        </div>
      `,
      text: `Email Connection Successful!\n\nThis test message confirms that your email provider is connected.`,
      projectId,
      accountId: ctx.accountId,
    });

    if (!result.success) {
      return NextResponse.json({ error: result.error || 'Failed to send test email' }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      message: `Test email successfully sent to ${to}!`,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
