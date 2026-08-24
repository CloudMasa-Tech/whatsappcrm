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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
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
export async function GET() {
  try {
    const ctx = await requireSuperAdmin();

    const { data, error } = await ctx.supabase
      .from('onboarded_customers')
      .select('id, user_id, email, full_name, project_id, created_at')
      .eq('onboarded_by_account_id', ctx.accountId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[GET /api/admin/users] fetch error:', error);
      return NextResponse.json(
        { error: 'Failed to load customers' },
        { status: 500 },
      );
    }

    // Enrich with role from profiles
    const userIds = (data ?? []).map((c) => c.user_id).filter(Boolean);
    const userProfilesMap: Record<string, { role?: string | null; platform_role?: string | null; account_role?: string | null }> = {};
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
    }

    const customersWithRole = (data ?? []).map((c) => {
      const prof = userProfilesMap[c.user_id];
      const assignedRole = prof?.role === 'admin' ? 'admin' : 'agent';
      return {
        ...c,
        role: assignedRole,
      };
    });

    return NextResponse.json({ customers: customersWithRole });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// POST — create an admin/agent user and assign them to a project.
//
// The user's profile is placed in the ADMIN's account (same
// account_id as the caller), NOT in a new isolated account. The
// handle_new_user trigger skips account/project creation when it
// sees created_by_admin = true in user_metadata, so the API can
// create the profile and project_members row directly.
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
      { error: 'A valid email address is required' },
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
      { error: 'A project must be selected for the user' },
      { status: 400 },
    );
  }
  const projectId = body.projectId.trim();

  // Validate the project exists and belongs to the admin's account
  // via RLS (resolveProject checks is_project_member, and the admin
  // is auto-granted access to all projects in their account).
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

  // Create the auth user via the service role. `email_confirm: true`
  // means the customer can sign in with the password immediately — no
  // verification email in the way of onboarding.
  //
  // created_by_admin = true tells the handle_new_user trigger to skip
  // creating an account/project/profile — the API handles that below.
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

  // Create the profile in the account.
  // account_role = 'admin' for project admins (full project configuration),
  // or 'agent' for customers (operational messaging access).
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

  // Grant project access. Since the user has account_role = 'agent',
  // they need an explicit project_members row to see the project.
  const { error: memberErr } = await supabaseAdmin()
    .from('project_members')
    .insert({
      project_id: projectId,
      user_id: userId,
      created_by: ctx.userId,
    });

  if (memberErr) {
    console.error('[POST /api/admin/users] project_members insert error:', memberErr);
    // Best-effort rollback: delete the profile and the auth user.
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

  // Track the onboarding so the admin can see who they've created.
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

  // The password is returned ONCE so the admin can hand it over in
  // person/over the phone — same spirit as the one-time invite link.
  return NextResponse.json(
    {
      customer: { id: userId, email, full_name: fullName, role: assignedRole },
      credentials: { email, password, role: assignedRole },
      signInUrl: signInUrl(request),
    },
    { status: 201 },
  );
}
