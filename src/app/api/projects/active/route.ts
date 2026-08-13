import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { ACTIVE_PROJECT_COOKIE, resolveProject } from '@/lib/auth/project'

// POST /api/projects/active — switch the caller's active project.
//
// The cookie this sets is a convenience, not a credential: every
// server-side read re-validates it through `resolveProject` before
// using it (see src/lib/auth/project.ts). Validating here as well
// means the switcher gives immediate feedback on a bad id instead of
// silently falling back later.

export async function POST(request: Request) {
  let account
  try {
    account = await getCurrentAccount()
  } catch (err) {
    return toErrorResponse(err)
  }

  const body = await request.json().catch(() => null)
  const projectId = typeof body?.project_id === 'string' ? body.project_id : ''
  if (!projectId) {
    return NextResponse.json({ error: 'project_id is required' }, { status: 400 })
  }

  let project
  try {
    project = await resolveProject(account.supabase, projectId)
  } catch (err) {
    return toErrorResponse(err)
  }

  const cookieStore = await cookies()
  cookieStore.set(ACTIVE_PROJECT_COOKIE, project.id, {
    path: '/',
    // httpOnly: the client never needs to read this — the server
    // resolves the active project on every request and hands the UI
    // the result. Keeping it out of document.cookie removes it as an
    // XSS target.
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 365,
  })

  return NextResponse.json({ project })
}
