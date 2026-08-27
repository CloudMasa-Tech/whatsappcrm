import { NextResponse } from 'next/server';

import {
  requireSuperAdmin,
  toErrorResponse,
} from '@/lib/auth/account';
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

function signInUrl(request: Request): string {
  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim()?.replace(/\/+$/, '');
  if (site) return `${site}/login`;
  return `${new URL(request.url).origin}/login`;
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

  // Create the auth user via the service role
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
      return NextResponse.json(
        { error: 'A user with this email address already exists' },
        { status: 409 },
      );
    }
    console.error('[POST /api/admin/users] createUser error:', createErr);
    return NextResponse.json(
      { error: 'Failed to create the user account' },
      { status: 500 },
    );
  }

  const userId = created.user.id;

  // Create the profile in the account
  const accountRoleForProfile = assignedRole === 'admin' ? 'admin' : 'agent';

  const { error: profileErr } = await supabaseAdmin()
    .from('profiles')
    .insert({
      user_id: userId,
      full_name: fullName,
      email,
      account_id: ctx.accountId,
      account_role: accountRoleForProfile,
      role: assignedRole,
      platform_role: 'customer',
    });

  if (profileErr) {
    console.error('[POST /api/admin/users] profile insert error:', profileErr);
    await supabaseAdmin().auth.admin.deleteUser(userId).catch(() => {});
    return NextResponse.json(
      { error: 'Failed to create the customer profile' },
      { status: 500 },
    );
  }

  // Grant project access in project_members
  const { error: memberErr } = await supabaseAdmin()
    .from('project_members')
    .insert({
      project_id: projectId,
      user_id: userId,
      created_by: ctx.userId,
    });

  if (memberErr) {
    console.error('[POST /api/admin/users] project_members insert error:', memberErr);
    try {
      await supabaseAdmin()
        .from('profiles')
        .delete()
        .eq('user_id', userId);
    } catch { /* best-effort */ }
    await supabaseAdmin().auth.admin.deleteUser(userId).catch(() => {});
    return NextResponse.json(
      { error: 'Failed to assign project to customer' },
      { status: 500 },
    );
  }

  // Track the onboarding
  const { error: trackErr } = await ctx.supabase.from('onboarded_customers').insert({
    user_id: userId,
    email,
    full_name: fullName,
    project_id: projectId,
    onboarded_by_account_id: ctx.accountId,
    onboarded_by_user_id: ctx.userId,
  });

  if (trackErr) {
    console.error('[POST /api/admin/users] tracking insert error:', trackErr);
  }

  const loginUrl = signInUrl(request);

  // Send onboarding welcome email notification
  await sendOnboardingWelcomeEmail({
    toEmail: email,
    fullName,
    temporaryPassword: password,
    role: assignedRole,
    projectName: project.name,
    signInUrl: loginUrl,
  }).catch((emailErr) => {
    console.error('[POST /api/admin/users] email delivery notification error:', emailErr);
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
      credentials: { email, password, role: assignedRole, projectName: project.name },
      signInUrl: loginUrl,
      emailDispatched: true,
    },
    { status: 201 },
  );
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
