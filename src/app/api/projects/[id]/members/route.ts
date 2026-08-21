import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { resolveProject } from '@/lib/auth/project'

// Per-project roster.
//
// Owners and admins reach every project in their organisation by role,
// so they never appear here. This table is what grants an AGENT or
// VIEWER access to a specific project — the mechanism that keeps two
// teams inside one organisation from seeing each other's inboxes.
//
// The account-wide member list lives at /api/account/members; this
// route only decides which of those members can enter this project.

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params

  let auth
  try {
    auth = await requireRole('admin')
  } catch (err) {
    return toErrorResponse(err)
  }

  try {
    await resolveProject(auth.supabase, id)
  } catch (err) {
    return toErrorResponse(err)
  }

  const { data: assignments, error } = await auth.supabase
    .from('project_members')
    .select('user_id, created_at')
    .eq('project_id', id)

  if (error) {
    console.error('[project members GET] fetch error:', error)
    return NextResponse.json({ error: 'Failed to load members' }, { status: 500 })
  }

  // Join to profiles for display. Two queries rather than a PostgREST
  // embed: project_members has no FK to profiles (it points at
  // auth.users), so an embed has no relationship to infer.
  const userIds = (assignments ?? []).map((a) => a.user_id as string)
  let profiles: Array<{ user_id: string; full_name: string; email: string }> = []

  if (userIds.length > 0) {
    const { data, error: profileError } = await auth.supabase
      .from('profiles')
      .select('user_id, full_name, email')
      .in('user_id', userIds)
    if (profileError) {
      console.error('[project members GET] profile fetch error:', profileError)
      return NextResponse.json({ error: 'Failed to load members' }, { status: 500 })
    }
    profiles = (data ?? []) as typeof profiles
  }

  const byId = new Map(profiles.map((p) => [p.user_id, p]))
  return NextResponse.json({
    members: (assignments ?? []).map((a) => ({
      user_id: a.user_id,
      created_at: a.created_at,
      full_name: byId.get(a.user_id as string)?.full_name ?? null,
      email: byId.get(a.user_id as string)?.email ?? null,
    })),
  })
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params

  let auth
  try {
    auth = await requireRole('admin')
  } catch (err) {
    return toErrorResponse(err)
  }

  const body = await request.json().catch(() => null)
  const userId = typeof body?.user_id === 'string' ? body.user_id : ''
  if (!userId) {
    return NextResponse.json({ error: 'user_id is required' }, { status: 400 })
  }

  try {
    await resolveProject(auth.supabase, id)
  } catch (err) {
    return toErrorResponse(err)
  }

  // The database has the last word here: project_members_modify's
  // WITH CHECK calls user_in_account(), so assigning someone from a
  // different organisation fails at the policy even if this route
  // were bypassed. Checking first only buys a clearer error.
  const { data: target, error: targetError } = await auth.supabase
    .from('profiles')
    .select('user_id')
    .eq('user_id', userId)
    .eq('account_id', auth.accountId)
    .maybeSingle()

  if (targetError) {
    console.error('[project members POST] profile lookup error:', targetError)
    return NextResponse.json({ error: 'Failed to add member' }, { status: 500 })
  }
  if (!target) {
    return NextResponse.json(
      { error: 'That user is not a member of this account.' },
      { status: 400 },
    )
  }

  const { error } = await auth.supabase
    .from('project_members')
    .upsert(
      { project_id: id, user_id: userId, created_by: auth.userId },
      { onConflict: 'project_id,user_id' },
    )

  if (error) {
    console.error('[project members POST] insert error:', error)
    return NextResponse.json({ error: 'Failed to add member' }, { status: 500 })
  }

  return NextResponse.json({ success: true }, { status: 201 })
}

export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params

  let auth
  try {
    auth = await requireRole('admin')
  } catch (err) {
    return toErrorResponse(err)
  }

  const url = new URL(request.url)
  const userId = url.searchParams.get('user_id') ?? ''
  if (!userId) {
    return NextResponse.json({ error: 'user_id is required' }, { status: 400 })
  }

  try {
    await resolveProject(auth.supabase, id)
  } catch (err) {
    return toErrorResponse(err)
  }

  const { error } = await auth.supabase
    .from('project_members')
    .delete()
    .eq('project_id', id)
    .eq('user_id', userId)

  if (error) {
    console.error('[project members DELETE] delete error:', error)
    return NextResponse.json({ error: 'Failed to remove member' }, { status: 500 })
  }

  // Access is revoked the moment the row is gone: is_project_member()
  // reads it live on every query. No cache or session to invalidate.
  return NextResponse.json({ success: true })
}
