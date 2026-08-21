import { NextResponse } from 'next/server'
import { toErrorResponse } from '@/lib/auth/account'
import { getCurrentProject, requireProjectRole } from '@/lib/auth/project'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadEmbeddingsKey } from '@/lib/ai/config'
import { ingestDocument } from '@/lib/ai/knowledge'
import { AiError } from '@/lib/ai/types'

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/ai/knowledge/[id] — full document (any member).
 */
export async function GET(_request: Request, { params }: Params) {
  try {
    const { supabase, projectId } = await getCurrentProject()
    const { id } = await params
    const { data, error } = await supabase
      .from('ai_knowledge_documents')
      .select('id, title, content, updated_at')
      .eq('project_id', projectId)
      .eq('id', id)
      .maybeSingle()
    if (error) {
      console.error('[ai/knowledge/[id] GET] error:', error)
      return NextResponse.json({ error: 'Failed to load document' }, { status: 500 })
    }
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(data)
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * PATCH /api/ai/knowledge/[id]  (admin+) — update title/content and
 * re-index when the content changed.
 */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { supabase, accountId, projectId, userId } = await requireProjectRole('admin')
    const limit = checkRateLimit(`ai-kb:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const { id } = await params
    const body = await request.json().catch(() => null)
    const title = typeof body?.title === 'string' ? body.title.trim() : undefined
    const content = typeof body?.content === 'string' ? body.content.trim() : undefined
    if (title === undefined && content === undefined) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    }
    if (title !== undefined && !title) {
      return NextResponse.json({ error: 'title cannot be empty' }, { status: 400 })
    }
    if (content !== undefined && !content) {
      return NextResponse.json({ error: 'content cannot be empty' }, { status: 400 })
    }

    const update: Record<string, string> = {}
    if (title !== undefined) update.title = title
    if (content !== undefined) update.content = content

    const { data: updated, error } = await supabase
      .from('ai_knowledge_documents')
      .update(update)
      .eq('project_id', projectId)
      .eq('id', id)
      .select('id')
      .maybeSingle()
    if (error) {
      console.error('[ai/knowledge/[id] PATCH] error:', error)
      return NextResponse.json({ error: 'Failed to update document' }, { status: 500 })
    }
    if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    if (content !== undefined) {
      const { key: embeddingsApiKey, corrupt } = await loadEmbeddingsKey(
        supabase,
        accountId,
        projectId,
      )
      try {
        await ingestDocument(supabase, accountId, projectId, { embeddingsApiKey }, id, content)
      } catch (err) {
        const message = err instanceof AiError ? err.message : 'indexing failed'
        console.error('[ai/knowledge/[id] PATCH] ingest error:', err)
        return NextResponse.json(
          {
            success: true,
            warning: `Updated, but semantic indexing failed (${message}). Lexical search still works; use Reindex to retry.`,
          },
          { status: 200 },
        )
      }
      if (corrupt) {
        return NextResponse.json({
          success: true,
          warning:
            'Updated with keyword search only — your embeddings key could not be decrypted (check ENCRYPTION_KEY, then re-enter the key).',
        })
      }
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * DELETE /api/ai/knowledge/[id]  (admin+) — chunks cascade.
 */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { supabase, projectId } = await requireProjectRole('admin')
    const { id } = await params
    const { error } = await supabase
      .from('ai_knowledge_documents')
      .delete()
      .eq('project_id', projectId)
      .eq('id', id)
    if (error) {
      console.error('[ai/knowledge/[id] DELETE] error:', error)
      return NextResponse.json({ error: 'Failed to delete document' }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
