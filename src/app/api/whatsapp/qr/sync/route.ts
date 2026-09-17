import { NextResponse } from 'next/server'

import { toErrorResponse } from '@/lib/auth/account'
import { getCurrentProject, requireProject, requireProjectRole } from '@/lib/auth/project'
import {
  syncContactsViaGateway,
  GatewayError,
} from '@/lib/channels/gateway'

function gatewayErrorResponse(err: unknown) {
  if (err instanceof GatewayError) {
    return NextResponse.json(
      { error: err.message, code: err.code },
      { status: err.status },
    )
  }
  return toErrorResponse(err)
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const requested = typeof body?.project_id === 'string' ? body.project_id : null

    const ctx = requested
      ? await requireProject(requested, 'agent')
      : await requireProjectRole('agent')

    const result = await syncContactsViaGateway(ctx.projectId)
    return NextResponse.json({
      success: true,
      synced: result.synced,
    })
  } catch (err) {
    return gatewayErrorResponse(err)
  }
}
