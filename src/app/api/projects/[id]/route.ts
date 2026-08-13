import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { resolveProject } from '@/lib/auth/project'

// PATCH — rename, archive or restore a project.
// DELETE — destroy it, and everything inside it.
//
// Both resolve the id through `resolveProject` first. That call runs
// under the caller's RLS, so an id belonging to another organisation
// (or to a project this user is not on) fails there with 403 and never
// reaches an UPDATE / DELETE.

export async function PATCH(
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
  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  try {
    await resolveProject(auth.supabase, id)
  } catch (err) {
    return toErrorResponse(err)
  }

  const patch: Record<string, unknown> = {}

  if (body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name || name.length > 80) {
      return NextResponse.json(
        { error: 'name must be between 1 and 80 characters' },
        { status: 400 },
      )
    }
    patch.name = name
  }

  if (body.archived !== undefined) {
    if (typeof body.archived !== 'boolean') {
      return NextResponse.json(
        { error: 'archived must be a boolean' },
        { status: 400 },
      )
    }
    patch.archived_at = body.archived ? new Date().toISOString() : null
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: 'Nothing to update. Supply `name` and/or `archived`.' },
      { status: 400 },
    )
  }

  // channel_type is deliberately NOT patchable. Flipping a live
  // project between Cloud API and QR would strand its existing
  // conversations on a transport that can no longer send to them;
  // the supported path is a new project.

  const { data, error } = await auth.supabase
    .from('projects')
    .update(patch)
    .eq('id', id)
    .select('id, name, slug, channel_type, archived_at')
    .maybeSingle()

  if (error) {
    console.error('[projects PATCH] update error:', error)
    return NextResponse.json({ error: 'Failed to update project' }, { status: 500 })
  }
  if (!data) {
    // RLS refused the write even though the read succeeded — the
    // caller can see the project but is not an admin of its account.
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  return NextResponse.json({ project: data })
}

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params

  let auth
  try {
    // Owner-only, matching the projects_delete policy: this cascades
    // through contacts, conversations, messages, flows and the
    // WhatsApp session credentials. There is no undo.
    auth = await requireRole('owner')
  } catch (err) {
    return toErrorResponse(err)
  }

  try {
    await resolveProject(auth.supabase, id)
  } catch (err) {
    return toErrorResponse(err)
  }

  // Refuse to delete the last project: the dashboard has nothing to
  // scope to without one, and getCurrentProject() would start throwing
  // for every member of the account.
  const { count, error: countError } = await auth.supabase
    .from('projects')
    .select('id', { count: 'exact', head: true })

  if (countError) {
    console.error('[projects DELETE] count error:', countError)
    return NextResponse.json({ error: 'Failed to delete project' }, { status: 500 })
  }
  if ((count ?? 0) <= 1) {
    return NextResponse.json(
      { error: 'Cannot delete the only project in an account. Create another first.' },
      { status: 409 },
    )
  }

  const { error } = await auth.supabase.from('projects').delete().eq('id', id)

  if (error) {
    console.error('[projects DELETE] delete error:', error)
    return NextResponse.json({ error: 'Failed to delete project' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
