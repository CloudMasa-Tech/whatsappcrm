import { NextResponse } from 'next/server'

import { toErrorResponse } from '@/lib/auth/account'
import { getCurrentProject, requireProject } from '@/lib/auth/project'
import {
  connectSession,
  disconnectSession,
  GatewayError,
  isGatewayConfigured,
} from '@/lib/channels/gateway'

// ============================================================
// QR pairing controls for the active project.
//
//   POST   — begin pairing. The QR itself arrives in the browser over
//            Supabase Realtime on `whatsapp_sessions`, not in this
//            response: the gateway writes it there the moment WhatsApp
//            issues one, and it rotates every ~20s.
//   GET    — current session row.
//   DELETE — log out and destroy the stored credentials.
//
// A project id may be supplied in the body/query, but it is always
// re-authorised through `requireProject` before it reaches the
// gateway. The gateway trusts this service completely, so a
// client-supplied id that skipped that check would be a direct route
// into another tenant's session.
// ============================================================

const SESSION_COLUMNS =
  'project_id, status, qr_code, qr_expires_at, phone_number, display_name, ' +
  'last_connected_at, last_disconnected_at, last_error, heartbeat_at'

function gatewayErrorResponse(err: unknown) {
  if (err instanceof GatewayError) {
    return NextResponse.json(
      { error: err.message, code: err.code },
      { status: err.status },
    )
  }
  return toErrorResponse(err)
}

export async function GET(request: Request) {
  try {
    const requested = new URL(request.url).searchParams.get('project_id')
    const ctx = requested
      ? await requireProject(requested)
      : await getCurrentProject()

    // RLS (whatsapp_sessions_select) already limits this to projects
    // the caller belongs to; the explicit filter keeps the query honest
    // if this ever moves to the service-role client.
    const { data, error } = await ctx.supabase
      .from('whatsapp_sessions')
      .select(SESSION_COLUMNS)
      .eq('project_id', ctx.projectId)
      .maybeSingle()

    if (error) {
      console.error('[whatsapp/qr GET] fetch error:', error)
      return NextResponse.json({ error: 'Failed to load session' }, { status: 500 })
    }

    return NextResponse.json({
      channel_type: ctx.project.channel_type,
      gateway_configured: isGatewayConfigured(),
      session: data ?? { project_id: ctx.projectId, status: 'disconnected' },
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const requested = typeof body?.project_id === 'string' ? body.project_id : null

    // 'admin' — connecting a WhatsApp number is a settings-class
    // action, matching whatsapp_config's own policy tier.
    const ctx = requested
      ? await requireProject(requested, 'admin')
      : await getCurrentProject().then(async (c) => {
          if (c.role !== 'owner' && c.role !== 'admin') {
            throw Object.assign(new Error('This action requires the admin role or higher'), {
              status: 403,
            })
          }
          return c
        })

    // Both QR and Cloud API are always available as connection methods.

    const status = await connectSession(ctx.projectId)
    return NextResponse.json({
      status: status.status,
      // The QR follows over Realtime — tell the UI to wait for it
      // rather than expecting it here.
      awaiting_qr: status.status === 'connecting' || status.status === 'qr_pending',
    })
  } catch (err) {
    return gatewayErrorResponse(err)
  }
}

export async function DELETE(request: Request) {
  try {
    const requested = new URL(request.url).searchParams.get('project_id')
    const ctx = requested
      ? await requireProject(requested, 'admin')
      : await getCurrentProject()

    if (ctx.role !== 'owner' && ctx.role !== 'admin') {
      return NextResponse.json(
        { error: 'This action requires the admin role or higher' },
        { status: 403 },
      )
    }

    await disconnectSession(ctx.projectId)
    return NextResponse.json({ success: true })
  } catch (err) {
    return gatewayErrorResponse(err)
  }
}
