import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { getCurrentProject, isChannelType, listProjects } from '@/lib/auth/project'

// Projects — the data-isolation boundary inside an organisation.
// GET lists the ones the caller may reach; POST creates a new one.
//
// Both go through the caller's own Supabase client so RLS
// (projects_select / projects_insert from migration 041) is the
// authority. No service-role client here: there is nothing this route
// needs to see that the user is not allowed to see, and reaching for
// the admin client would mean re-implementing the membership check by
// hand.

/** Max projects per organisation. A guardrail, not a product limit. */
const MAX_PROJECTS_PER_ACCOUNT = 50

/**
 * URL-safe handle derived from the display name. Uniqueness is per
 * account (the UNIQUE (account_id, slug) constraint), so a collision
 * only means "this organisation already has one" — we suffix rather
 * than reject, since the name itself is the user-facing identifier.
 */
function slugify(name: string): string {
  const base = name
    .toLowerCase()
    // Split accents off their base letters, then drop the combining
    // marks (U+0300–U+036F) so "Café" slugs to "cafe", not "caf".
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return base || 'project'
}

export async function GET() {
  try {
    const ctx = await getCurrentProject()
    const projects = await listProjects(ctx.supabase)
    return NextResponse.json({
      projects,
      active_project_id: ctx.projectId,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  let ctx
  try {
    // Creating a project is an organisation-level act (it spends
    // quota and creates a new isolation boundary), so it gates on the
    // account role rather than membership of any existing project.
    ctx = await requireRole('admin')
  } catch (err) {
    return toErrorResponse(err)
  }

  const body = await request.json().catch(() => null)
  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }
  if (name.length > 80) {
    return NextResponse.json(
      { error: 'name must be 80 characters or fewer' },
      { status: 400 },
    )
  }

  const channelType = body.channel_type ?? 'qr'
  if (!isChannelType(channelType)) {
    return NextResponse.json(
      { error: "channel_type must be 'qr' or 'cloud_api'" },
      { status: 400 },
    )
  }

  const { count, error: countError } = await ctx.supabase
    .from('projects')
    .select('id', { count: 'exact', head: true })

  if (countError) {
    console.error('[projects POST] count error:', countError)
    return NextResponse.json({ error: 'Failed to create project' }, { status: 500 })
  }
  if ((count ?? 0) >= MAX_PROJECTS_PER_ACCOUNT) {
    return NextResponse.json(
      { error: `An account may have at most ${MAX_PROJECTS_PER_ACCOUNT} projects.` },
      { status: 409 },
    )
  }

  // Retry on slug collision. `UNIQUE (account_id, slug)` is the
  // authority; a pre-check SELECT would race with a concurrent create.
  const base = slugify(name)
  let lastError: unknown = null

  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${attempt + 1}`
    const { data, error } = await ctx.supabase
      .from('projects')
      .insert({
        account_id: ctx.accountId,
        name,
        slug,
        channel_type: channelType,
      })
      .select('id, name, slug, channel_type, archived_at')
      .single()

    if (!error) {
      return NextResponse.json({ project: data }, { status: 201 })
    }
    // 23505 = unique_violation. Anything else is a real failure.
    if (error.code !== '23505') {
      lastError = error
      break
    }
    lastError = error
  }

  console.error('[projects POST] insert error:', lastError)
  return NextResponse.json({ error: 'Failed to create project' }, { status: 500 })
}
