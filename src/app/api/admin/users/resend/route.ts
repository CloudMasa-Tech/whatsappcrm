import { NextResponse } from 'next/server';
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendOnboardingWelcomeEmail } from '@/lib/email/onboarding';

function signInUrl(): string {
  const site = (process.env.NEXT_PUBLIC_SITE_URL || 'https://crm.cloudmasa.com').trim().replace(/\/+$/, '');
  return `${site}/login`;
}

export async function POST(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    if (ctx.platformRole !== 'super_admin' && ctx.role !== 'owner' && ctx.role !== 'admin') {
      return NextResponse.json(
        { error: 'Forbidden: Super Admin or Account Admin required' },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => null);
    if (!body || (!body.userId && !body.customerId)) {
      return NextResponse.json(
        { error: 'userId or customerId is required' },
        { status: 400 }
      );
    }

    const userId = (body.userId || '').trim();
    const customerId = (body.customerId || '').trim();

    // 1. Fetch onboarding / profile record
    let custRecord = null;
    if (customerId) {
      const { data } = await supabaseAdmin()
        .from('onboarded_customers')
        .select('*, project:projects(id, name)')
        .eq('id', customerId)
        .maybeSingle();
      custRecord = data;
    } else if (userId) {
      const { data } = await supabaseAdmin()
        .from('onboarded_customers')
        .select('*, project:projects(id, name)')
        .eq('user_id', userId)
        .maybeSingle();
      custRecord = data;
    }

    const resolvedUserId = custRecord?.user_id || userId;

    // Fetch user from auth
    const { data: userAuth, error: authGetErr } = await supabaseAdmin().auth.admin.getUserById(resolvedUserId);
    if (authGetErr || !userAuth?.user) {
      return NextResponse.json(
        { error: 'User account not found in authentication system' },
        { status: 404 }
      );
    }

    const email = userAuth.user.email || custRecord?.email;
    if (!email) {
      return NextResponse.json(
        { error: 'No email found for this user' },
        { status: 400 }
      );
    }

    // Resolve profile details
    const { data: profile } = await supabaseAdmin()
      .from('profiles')
      .select('full_name, role, account_role')
      .eq('user_id', resolvedUserId)
      .maybeSingle();

    // Resolve project name
    let projectName = 'Default Workspace';
    let projectId = custRecord?.project_id;

    if (custRecord?.project) {
      const p = Array.isArray(custRecord.project) ? custRecord.project[0] : custRecord.project;
      if (p?.name) projectName = p.name;
    } else {
      const { data: pm } = await supabaseAdmin()
        .from('project_members')
        .select('project_id, project:projects(id, name)')
        .eq('user_id', resolvedUserId)
        .limit(1)
        .maybeSingle();
      if (pm?.project) {
        const p = Array.isArray(pm.project) ? pm.project[0] : pm.project;
        if (p?.name) projectName = p.name;
        projectId = pm.project_id;
      }
    }

    const fullName = profile?.full_name || custRecord?.full_name || email.split('@')[0];
    const role = (profile?.role === 'admin' ? 'admin' : 'agent') as 'admin' | 'agent';

    // Generate or use provided password
    const temporaryPassword = body.newPassword?.trim() || `Welcome@${Math.floor(1000 + Math.random() * 9000)}`;

    // Update password in Supabase Auth
    const { error: updateAuthErr } = await supabaseAdmin().auth.admin.updateUserById(resolvedUserId, {
      password: temporaryPassword,
      email_confirm: true,
    });

    if (updateAuthErr) {
      console.error('[POST /api/admin/users/resend] update password error:', updateAuthErr);
      return NextResponse.json(
        { error: `Failed to update password: ${updateAuthErr.message}` },
        { status: 500 }
      );
    }

    const loginUrl = signInUrl();

    // Dispatch welcome email via SMTP
    const emailResult = await sendOnboardingWelcomeEmail({
      toEmail: email,
      fullName,
      temporaryPassword,
      role,
      projectName,
      signInUrl: loginUrl,
      projectId,
      accountId: ctx.accountId,
    });

    if (!emailResult.success) {
      return NextResponse.json(
        {
          error: emailResult.error || 'Failed to dispatch email via mail transport',
          temporaryPassword,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Welcome credentials email successfully delivered to ${email}!`,
      email,
      temporaryPassword,
      projectName,
      signInUrl: loginUrl,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
