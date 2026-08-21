import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

import { verifySignatureHeader } from '@/lib/webhooks/sign'
import { ingestInboundMessage } from '@/lib/inbound/ingest'
import type { InboundMessage, MessageKind } from '@/lib/channels/types'

// ============================================================
// Inbound from the QR gateway.
//
// This is the mirror image of /api/whatsapp/webhook: same job, other
// transport. The gateway holds the WhatsApp socket, normalises what it
// receives, and POSTs it here signed with the shared secret.
//
// Security posture — this endpoint is public (the gateway may be on a
// different host), so it must be treated as hostile input:
//
//   1. HMAC over the raw bytes, with a timestamp inside the signed
//      message, so neither forgery nor replay works.
//   2. Fail CLOSED when the secret is unset. An unconfigured deploy
//      rejects everything rather than accepting anything — the same
//      rule verifyMetaWebhookSignature applies to META_APP_SECRET.
//   3. `accountId` is never read from the body. Ingest derives it from
//      the project, so a compromised gateway cannot write into an
//      account it was not given a project for.
// ============================================================

export const maxDuration = 60

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _adminClient
}

const MESSAGE_KINDS = [
  'text',
  'image',
  'video',
  'document',
  'audio',
  'location',
  'sticker',
  'reaction',
  'unknown',
] as const

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  )
}

/**
 * Parse the wire payload into an InboundMessage, or return null.
 *
 * Deliberately strict: anything unrecognised is dropped rather than
 * coerced. A malformed field here would end up written to a customer's
 * conversation.
 */
export function parseInbound(raw: unknown): InboundMessage | null {
  if (!raw || typeof raw !== 'object') return null
  const p = raw as Record<string, unknown>

  if (!isUuid(p.projectId)) return null
  if (typeof p.from !== 'string' || !p.from.trim()) return null

  const kind =
    typeof p.kind === 'string' && (MESSAGE_KINDS as readonly string[]).includes(p.kind)
      ? (p.kind as MessageKind)
      : 'unknown'

  let media: InboundMessage['media'] = null
  if (p.media && typeof p.media === 'object') {
    const m = p.media as Record<string, unknown>
    // Only accept media we can actually render — an arbitrary URL from
    // the wire becomes an <img src> in the inbox.
    if (typeof m.url === 'string' && /^https?:\/\//i.test(m.url)) {
      media = {
        url: m.url,
        mimeType: typeof m.mimeType === 'string' ? m.mimeType : 'application/octet-stream',
        filename: typeof m.filename === 'string' ? m.filename : null,
        caption: typeof m.caption === 'string' ? m.caption : null,
      }
    }
  }

  const timestamp =
    typeof p.timestamp === 'string' && !Number.isNaN(Date.parse(p.timestamp))
      ? p.timestamp
      : new Date().toISOString()

  return {
    projectId: p.projectId,
    from: p.from.trim(),
    externalId: typeof p.externalId === 'string' ? p.externalId : '',
    kind,
    text: typeof p.text === 'string' ? p.text : null,
    senderName: typeof p.senderName === 'string' ? p.senderName : null,
    timestamp,
    fromMe: Boolean(p.fromMe),
    isHistory: Boolean(p.isHistory),
    media,
    replyToExternalId:
      typeof p.replyToExternalId === 'string' ? p.replyToExternalId : null,
  }
}

/** Delivery receipt: advance the stored status of a message we sent. */
async function applyReceipt(raw: unknown): Promise<void> {
  if (!raw || typeof raw !== 'object') return
  const p = raw as Record<string, unknown>
  if (!isUuid(p.projectId) || typeof p.externalId !== 'string') return

  const status = p.status
  if (!['sent', 'delivered', 'read', 'failed'].includes(String(status))) return

  // project_id scopes the update: the service role bypasses RLS, and a
  // transport message id carries no tenancy of its own — without this
  // filter a crafted receipt could flip the status of another
  // project's message.
  const { error } = await supabaseAdmin()
    .from('messages')
    .update({ status })
    .eq('project_id', p.projectId)
    .eq('message_id', p.externalId)

  if (error) {
    console.error('[qr/events] receipt update failed:', error)
  }
}

/** Customer reaction from a QR session: persist as a message_reactions row. */
async function applyReaction(raw: unknown): Promise<void> {
  if (!raw || typeof raw !== 'object') return
  const p = raw as Record<string, unknown>
  if (!isUuid(p.projectId) || typeof p.externalId !== 'string') return
  if (typeof p.emoji !== 'string' || !p.emoji) return

  // Find the message by its transport id, scoped to the project.
  const { data: msg } = await supabaseAdmin()
    .from('messages')
    .select('id, conversation_id')
    .eq('project_id', p.projectId)
    .eq('message_id', p.externalId)
    .maybeSingle()

  if (!msg) {
    console.warn('[qr/events] reaction target message not found:', p.externalId)
    return
  }

  // Upsert — if the same customer reacts twice, the second replaces the first.
  const { error } = await supabaseAdmin()
    .from('message_reactions')
    .upsert(
      {
        message_id: msg.id,
        conversation_id: msg.conversation_id,
        actor_type: 'customer',
        actor_id: null,
        emoji: p.emoji,
      },
      { onConflict: 'message_id,actor_type,actor_id' },
    )

  if (error) {
    console.error('[qr/events] reaction upsert failed:', error)
  }
}

export async function POST(request: Request) {
  const secret = process.env.WHATSAPP_GATEWAY_WEBHOOK_SECRET
  if (!secret) {
    console.error(
      '[qr/events] WHATSAPP_GATEWAY_WEBHOOK_SECRET is not set — rejecting. ' +
        'Set it to the same value as the gateway\'s GATEWAY_WEBHOOK_SECRET.',
    )
    return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  }

  // Raw text, not request.json(): the signature covers these exact
  // bytes and re-serialising would change them.
  const rawBody = await request.text()
  const signature = request.headers.get('x-wacrm-signature')

  if (
    !signature ||
    !verifySignatureHeader(
      signature,
      rawBody,
      secret,
      Math.floor(Date.now() / 1000),
    )
  ) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let event: { type?: string; payload?: unknown }
  try {
    event = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (event.type === 'receipt') {
    await applyReceipt(event.payload)
    return NextResponse.json({ ok: true })
  }

  if (event.type === 'reaction') {
    await applyReaction(event.payload)
    return NextResponse.json({ ok: true })
  }

  if (event.type !== 'message') {
    // Unknown event types are acknowledged, not retried: a newer
    // gateway talking to an older CRM should not wedge its queue.
    return NextResponse.json({ ok: true, ignored: true })
  }

  const message = parseInbound(event.payload)
  if (!message) {
    return NextResponse.json({ error: 'Malformed message payload' }, { status: 400 })
  }

  try {
    const result = await ingestInboundMessage(supabaseAdmin(), message)
    if (!result) {
      // Ingest refused it (unknown or archived project, unusable
      // phone). A 200 stops the gateway retrying something that will
      // never succeed; the reason is already logged.
      return NextResponse.json({ ok: true, ingested: false })
    }
    return NextResponse.json({
      ok: true,
      ingested: result.ingested,
      conversation_id: result.conversationId,
    })
  } catch (err) {
    console.error('[qr/events] ingest threw:', err)
    // 500 so the gateway retries — this one might succeed next time.
    return NextResponse.json({ error: 'Ingest failed' }, { status: 500 })
  }
}
