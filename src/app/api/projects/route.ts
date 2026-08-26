import { NextResponse } from 'next/server'

import { requireRole, requireSuperAdmin, toErrorResponse } from '@/lib/auth/account'
import { getCurrentProject, isChannelType, listProjects } from '@/lib/auth/project'
import { supabaseAdmin } from '@/lib/supabase/admin'

// Projects — the data-isolation boundary inside an organisation.
// GET lists the ones the caller may reach; POST creates a new one (Super Admin only).

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
    const projects = await listProjects(ctx.supabase, ctx.userId, ctx.platformRole)

    let enrichedProjects = projects
    if (ctx.platformRole === 'super_admin') {
      const projectIds = projects.map((p) => p.id)
      if (projectIds.length > 0) {
        const { data: memberRows } = await supabaseAdmin()
          .from('project_members')
          .select('project_id, user_id')
          .in('project_id', projectIds)

        const userIds = Array.from(new Set((memberRows ?? []).map((m) => m.user_id)))
        const { data: profiles } = userIds.length > 0
          ? await supabaseAdmin()
              .from('profiles')
              .select('user_id, full_name, email, role, account_role')
              .in('user_id', userIds)
          : { data: [] }

        const profileMap = new Map((profiles ?? []).map((p) => [p.user_id, p]))
        const projectMembersMap: Record<string, any[]> = {}

        for (const row of memberRows ?? []) {
          const prof = profileMap.get(row.user_id)
          if (prof) {
            if (!projectMembersMap[row.project_id]) projectMembersMap[row.project_id] = []
            projectMembersMap[row.project_id].push({
              user_id: prof.user_id,
              full_name: prof.full_name,
              email: prof.email,
              role: prof.role === 'admin' ? 'admin' : 'agent',
            })
          }
        }

        enrichedProjects = projects.map((p) => ({
          ...p,
          members: projectMembersMap[p.id] ?? [],
        }))
      }
    }

    return NextResponse.json({
      projects: enrichedProjects,
      active_project_id: ctx.projectId,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  let ctx
  try {
    // Creating a project is an exclusive platform Super Admin operation.
    ctx = await requireSuperAdmin()
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

  // allowed_channels: which connection methods are enabled.
  // Defaults to just the primary channel_type for backward compat.
  const VALID_CHANNELS = ['qr', 'cloud_api'] as const
  let allowedChannels: string[] = [channelType]
  if (Array.isArray(body.allowed_channels)) {
    const parsed = body.allowed_channels.filter(
      (c: unknown): c is string =>
        typeof c === 'string' && (VALID_CHANNELS as readonly string[]).includes(c),
    )
    if (parsed.length === 0) {
      return NextResponse.json(
        { error: 'allowed_channels must be a non-empty array containing "qr" and/or "cloud_api"' },
        { status: 400 },
      )
    }
    allowedChannels = Array.from(new Set(parsed)) as string[]
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
        allowed_channels: allowedChannels,
      })
      .select('id, name, slug, channel_type, allowed_channels, archived_at')
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
