import { NextResponse } from 'next/server';

import {
  getCurrentAccount,
  requireSuperAdmin,
  toErrorResponse,
} from '@/lib/auth/account';
import { hasMinRole } from '@/lib/auth/roles';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendOnboardingWelcomeEmail } from '@/lib/email/onboarding';

const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const MIN_PASSWORD_LEN = 8;
const MAX_NAME_LEN = 80;

function signInUrl(request?: Request): string {
  const site = (process.env.NEXT_PUBLIC_SITE_URL || 'https://wacrm.cloudmasa.com').trim().replace(/\/+$/, '');
  return `${site}/login`;
}

function isDuplicateEmailError(err: { message?: string } | null): boolean {
  if (!err?.message) return false;
  const msg = err.message.toLowerCase();
  return msg.includes('already been registered') || msg.includes('already registered');
}

// GET — the onboarding admin's list of customers/users they've created.
export async function GET(request: Request) {
  try {
    const ctx = await requireSuperAdmin();
    const { searchParams } = new URL(request.url);
    const filterProjectId = searchParams.get('projectId')?.trim();

    const { data, error } = await ctx.supabase
      .from('onboarded_customers')
      .select('id, user_id, email, full_name, project_id, created_at, project:projects(id, name, slug, channel_type)')
      .eq('onboarded_by_account_id', ctx.accountId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[GET /api/admin/users] fetch error:', error);
      return NextResponse.json(
        { error: 'Failed to load customers' },
        { status: 500 },
      );
    }

    // Enrich with role from profiles and project assignments from project_members
    const userIds = (data ?? []).map((c) => c.user_id).filter(Boolean);
    const userProfilesMap: Record<string, { role?: string | null; platform_role?: string | null; account_role?: string | null }> = {};
    const userProjectsMap: Record<string, { id: string; name: string; channel_type?: string }> = {};

    if (userIds.length > 0) {
      const { data: profilesData } = await supabaseAdmin()
        .from('profiles')
        .select('user_id, role, platform_role, account_role')
        .in('user_id', userIds);

      if (profilesData) {
        for (const p of profilesData) {
          userProfilesMap[p.user_id] = p;
        }
      }

      // Query project_members to ensure project is resolved even if onboarded_customers.project_id was unset
      const { data: pmData } = await supabaseAdmin()
        .from('project_members')
        .select('user_id, project_id, project:projects(id, name, channel_type)')
        .in('user_id', userIds);

      if (pmData) {
        for (const pm of pmData) {
          const proj = Array.isArray(pm.project) ? pm.project[0] : pm.project;
          if (proj && proj.id && proj.name) {
            userProjectsMap[pm.user_id] = {
              id: proj.id,
              name: proj.name,
              channel_type: proj.channel_type,
            };
          }
        }
      }
    }

    let customersWithRole = (data ?? []).map((c: any) => {
      const prof = userProfilesMap[c.user_id];
      const assignedRole = prof?.role === 'admin' ? 'admin' : 'agent';
      const rawProj = Array.isArray(c.project) ? c.project[0] : c.project;
      const fallbackProj = userProjectsMap[c.user_id];
      const projectObj = rawProj ?? fallbackProj ?? null;

      return {
        ...c,
        role: assignedRole,
        project_id: c.project_id || projectObj?.id || null,
        project: projectObj,
        project_name: projectObj?.name ?? null,
      };
    });

    if (filterProjectId && filterProjectId !== 'all') {
      customersWithRole = customersWithRole.filter(
        (c) => c.project_id === filterProjectId || c.project?.id === filterProjectId
      );
    }

    return NextResponse.json({ customers: customersWithRole });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// POST — create an admin/agent user and assign them to a project.
export async function POST(request: Request) {
  let ctx;
  try {
    ctx = await requireSuperAdmin();
  } catch (err) {
    return toErrorResponse(err);
  }

  const limit = checkRateLimit(
    `admin:customerCreate:${ctx.userId}`,
    RATE_LIMITS.adminAction,
  );
  if (!limit.success) return rateLimitResponse(limit);

  const body = (await request
    .json()
    .catch(() => null)) as {
    email?: unknown;
    password?: unknown;
    fullName?: unknown;
    projectId?: unknown;
    role?: unknown;
  } | null;
  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const email =
    typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json(
      { error: 'A valid email address is required (e.g. name@example.com)' },
      { status: 400 },
    );
  }

  const password = typeof body.password === 'string' ? body.password : '';
  if (password.length < MIN_PASSWORD_LEN) {
    return NextResponse.json(
      {
        error: `Password must be at least ${MIN_PASSWORD_LEN} characters long`,
      },
      { status: 400 },
    );
  }

  // Selected role: 'admin' vs 'agent' (default)
  const assignedRole = body.role === 'admin' ? 'admin' : 'agent';

  // Project assignment — required. The user must be placed in a
  // specific project so they can access WhatsApp and domain data.
  if (typeof body.projectId !== 'string' || body.projectId.trim() === '') {
    return NextResponse.json(
      { error: 'A project must be selected for the customer' },
      { status: 400 },
    );
  }
  const projectId = body.projectId.trim();

  // Validate the project exists and belongs to the admin's account
  const { data: project, error: projectErr } = await ctx.supabase
    .from('projects')
    .select('id, name, archived_at')
    .eq('id', projectId)
    .maybeSingle();

  if (projectErr || !project) {
    return NextResponse.json(
      { error: 'Project not found or not accessible' },
      { status: 400 },
    );
  }

  let fullName: string | null = null;
  if (typeof body.fullName === 'string') {
    const trimmed = body.fullName.trim();
    if (trimmed.length > MAX_NAME_LEN) {
      return NextResponse.json(
        { error: `Name must be ${MAX_NAME_LEN} characters or fewer` },
        { status: 400 },
      );
    }
    fullName = trimmed === '' ? null : trimmed;
  }

  let userId: string;

  // Create or retrieve auth user
  const { data: created, error: createErr } = await supabaseAdmin().auth.admin
    .createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        ...(fullName ? { full_name: fullName } : {}),
        created_by_admin: true,
      },
    })
    .catch((e: unknown) => ({ data: null, error: e }));

  if (createErr || !created?.user) {
    if (isDuplicateEmailError(createErr as { message?: string } | null)) {
      // Find the existing auth user
      const { data: userList } = await supabaseAdmin().auth.admin.listUsers();
      const existingAuthUser = (userList?.users ?? []).find(
        (u) => u.email?.toLowerCase() === email.toLowerCase(),
      );

      if (!existingAuthUser) {
        return NextResponse.json(
          { error: 'A user with this email address already exists in authentication.' },
          { status: 409 },
        );
      }

      // Check if the user is a super admin
      const { data: existingProfile } = await supabaseAdmin()
        .from('profiles')
        .select('platform_role')
        .eq('user_id', existingAuthUser.id)
        .maybeSingle();

      if (existingProfile?.platform_role === 'super_admin') {
        return NextResponse.json(
          { error: 'This email belongs to a Super Administrator account and cannot be modified as a customer.' },
          { status: 400 },
        );
      }

      // Update password & metadata for the existing user
      await supabaseAdmin().auth.admin.updateUserById(existingAuthUser.id, {
        password,
        email_confirm: true,
        user_metadata: {
          ...(fullName ? { full_name: fullName } : {}),
          created_by_admin: true,
        },
      });

      userId = existingAuthUser.id;
    } else {
      console.error('[POST /api/admin/users] createUser error:', createErr);
      return NextResponse.json(
        { error: 'Failed to create the user account: ' + ((createErr as { message?: string })?.message || 'Unknown error') },
        { status: 500 },
      );
    }
  } else {
    userId = created.user.id;
  }

  // Create or update the profile in the account
  const accountRoleForProfile = assignedRole === 'admin' ? 'admin' : 'agent';

  const { error: profileErr } = await supabaseAdmin()
    .from('profiles')
    .upsert(
      {
        user_id: userId,
        full_name: fullName,
        email,
        account_id: ctx.accountId,
        account_role: accountRoleForProfile,
        role: assignedRole,
        platform_role: 'customer',
      },
      { onConflict: 'user_id' },
    );

  if (profileErr) {
    console.error('[POST /api/admin/users] profile upsert error:', profileErr);
    return NextResponse.json(
      { error: 'Failed to create or update the customer profile' },
      { status: 500 },
    );
  }

  // Grant project access in project_members (clean previous project membership for single project isolation)
  await supabaseAdmin()
    .from('project_members')
    .delete()
    .eq('user_id', userId);

  const { error: memberErr } = await supabaseAdmin()
    .from('project_members')
    .insert({
      project_id: projectId,
      user_id: userId,
      created_by: ctx.userId,
    });

  if (memberErr) {
    console.error('[POST /api/admin/users] project_members insert error:', memberErr);
    return NextResponse.json(
      { error: 'Failed to assign project to customer' },
      { status: 500 },
    );
  }

  // Track the onboarding
  const { data: existingCust } = await supabaseAdmin()
    .from('onboarded_customers')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle();

  if (existingCust) {
    await supabaseAdmin()
      .from('onboarded_customers')
      .update({
        email,
        full_name: fullName,
        project_id: projectId,
        onboarded_by_account_id: ctx.accountId,
        onboarded_by_user_id: ctx.userId,
      })
      .eq('id', existingCust.id);
  } else {
    await ctx.supabase.from('onboarded_customers').insert({
      user_id: userId,
      email,
      full_name: fullName,
      project_id: projectId,
      onboarded_by_account_id: ctx.accountId,
      onboarded_by_user_id: ctx.userId,
    });
  }

  const loginUrl = signInUrl(request);

  // Send onboarding welcome email notification via nodemailer / SMTP
  const emailResult = await sendOnboardingWelcomeEmail({
    toEmail: email,
    fullName,
    temporaryPassword: password,
    role: assignedRole,
    projectName: project.name,
    signInUrl: loginUrl,
    projectId,
    accountId: ctx.accountId,
  }).catch((emailErr) => {
    console.error('[POST /api/admin/users] email delivery notification error:', emailErr);
    return { success: false, error: String(emailErr) };
  });

  return NextResponse.json(
    {
      customer: {
        id: userId,
        email,
        full_name: fullName,
        role: assignedRole,
        project_id: projectId,
        project_name: project.name,
      },
      credentials: {
        email,
        password,
        role: assignedRole,
        projectName: project.name,
        signInUrl: loginUrl,
      },
      signInUrl: loginUrl,
      emailDispatched: emailResult?.success ?? true,
    },
    { status: 201 },
  );
}

// PATCH — reassign a customer's role between 'admin' and 'agent'.
//
// Allowed for a platform super_admin, or an account admin/owner acting
// within their own account. The target is always scoped to the caller's
// account, so an admin can never touch another tenant's users.
export async function PATCH(request: Request) {
  let ctx;
  try {
    ctx = await getCurrentAccount();
    if (ctx.platformRole !== 'super_admin' && !hasMinRole(ctx.role, 'admin')) {
      return NextResponse.json(
        { error: 'This action requires super admin or account admin access' },
        { status: 403 },
      );
    }
  } catch (err) {
    return toErrorResponse(err);
  }

  const limit = checkRateLimit(
    `admin:customerUpdate:${ctx.userId}`,
    RATE_LIMITS.adminAction,
  );
  if (!limit.success) return rateLimitResponse(limit);

  const body = (await request.json().catch(() => null)) as {
    userId?: unknown;
    customerId?: unknown;
    role?: unknown;
  } | null;
  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (body.role !== 'admin' && body.role !== 'agent') {
    return NextResponse.json(
      { error: "Role must be either 'admin' or 'agent'" },
      { status: 400 },
    );
  }
  const nextRole = body.role;

  let userId = typeof body.userId === 'string' ? body.userId.trim() : '';
  const customerId =
    typeof body.customerId === 'string' ? body.customerId.trim() : '';

  // Resolve user_id from the onboarding record when only the row id is known.
  if (!userId && customerId) {
    const { data: cust } = await ctx.supabase
      .from('onboarded_customers')
      .select('user_id')
      .eq('id', customerId)
      .maybeSingle();
    if (cust?.user_id) userId = cust.user_id;
  }

  if (!userId) {
    return NextResponse.json(
      { error: 'A userId or customerId is required' },
      { status: 400 },
    );
  }

  if (userId === ctx.userId) {
    return NextResponse.json(
      { error: 'You cannot change your own role' },
      { status: 400 },
    );
  }

  // The target must be a member of the caller's account, and must not be
  // a super admin — those are managed outside the customer list.
  const { data: target, error: targetErr } = await supabaseAdmin()
    .from('profiles')
    .select('user_id, account_id, platform_role, account_role')
    .eq('user_id', userId)
    .maybeSingle();

  if (targetErr || !target) {
    return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
  }

  if (target.account_id !== ctx.accountId) {
    return NextResponse.json(
      { error: 'Customer not found in your account' },
      { status: 404 },
    );
  }

  if (target.platform_role === 'super_admin') {
    return NextResponse.json(
      { error: 'A Super Administrator account cannot be reassigned' },
      { status: 400 },
    );
  }

  if (target.account_role === 'owner') {
    return NextResponse.json(
      { error: 'The account owner cannot be reassigned' },
      { status: 400 },
    );
  }

  // service_role bypasses the privilege-column trigger from 034/048,
  // which blocks role edits made as `authenticated`.
  const { error: updateErr } = await supabaseAdmin()
    .from('profiles')
    .update({ role: nextRole, account_role: nextRole })
    .eq('user_id', userId);

  if (updateErr) {
    console.error('[PATCH /api/admin/users] role update error:', updateErr);
    return NextResponse.json(
      { error: 'Failed to update the customer role' },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true, userId, role: nextRole });
}

// DELETE — permanently delete a customer user account (Super Admin only)
export async function DELETE(request: Request) {
  let ctx;
  try {
    ctx = await requireSuperAdmin();
  } catch (err) {
    return toErrorResponse(err);
  }

  const { searchParams } = new URL(request.url);
  let userId = searchParams.get('userId')?.trim();
  let customerId = searchParams.get('id')?.trim();

  if (!userId && !customerId) {
    const body = (await request.json().catch(() => null)) as {
      userId?: string;
      customerId?: string;
      id?: string;
    } | null;
    userId = body?.userId?.trim() || body?.id?.trim();
    customerId = body?.customerId?.trim();
  }

  if (!userId && customerId) {
    // Resolve user_id from onboarded_customers
    const { data: cust } = await ctx.supabase
      .from('onboarded_customers')
      .select('user_id')
      .eq('id', customerId)
      .maybeSingle();
    if (cust?.user_id) {
      userId = cust.user_id;
    }
  }

  if (!userId) {
    return NextResponse.json(
      { error: 'User ID or Customer ID is required' },
      { status: 400 },
    );
  }

  // Prevent superadmin from deleting themselves
  if (userId === ctx.userId) {
    return NextResponse.json(
      { error: 'You cannot delete your own super admin account' },
      { status: 400 },
    );
  }

  try {
    // 1. Remove from onboarded_customers
    await supabaseAdmin()
      .from('onboarded_customers')
      .delete()
      .or(`user_id.eq.${userId},id.eq.${customerId || userId}`);

    // 2. Remove project memberships
    await supabaseAdmin()
      .from('project_members')
      .delete()
      .eq('user_id', userId);

    // 3. Remove user profile
    await supabaseAdmin()
      .from('profiles')
      .delete()
      .eq('user_id', userId);

    // 4. Delete Supabase Auth User
    const { error: authErr } = await supabaseAdmin().auth.admin.deleteUser(userId);
    if (authErr) {
      console.warn('[DELETE /api/admin/users] auth deleteUser notice:', authErr);
    }

    return NextResponse.json({ success: true, message: 'Customer deleted successfully' });
  } catch (err) {
    console.error('[DELETE /api/admin/users] delete error:', err);
    return NextResponse.json(
      { error: 'Failed to delete customer' },
      { status: 500 },
    );
  }
}
