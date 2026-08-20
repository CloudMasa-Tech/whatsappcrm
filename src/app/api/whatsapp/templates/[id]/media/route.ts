import { NextResponse } from 'next/server';
import { getCurrentProject } from '@/lib/auth/project'
import { createClient } from '@/lib/supabase/server';

/**
 * POST /api/whatsapp/templates/[id]/media
 *
 * Store (or replace) the public media URL used at SEND TIME for a
 * template with an IMAGE / VIDEO / DOCUMENT header.
 *
 * Why this exists: Meta's message-template list API never returns the
 * original header media URL — it only returns the creation-time
 * `header_handle`, which is NOT reusable as a send-time media id. So
 * templates pulled in via "Sync from Meta" land with a NULL
 * `header_media_url`, and the first send throws "image header requires
 * a media link or id at send time".
 *
 * This endpoint is the back half of the "Attach media" action in the
 * template manager: the UI uploads the file to Storage and posts the
 * public URL here. The write is purely local metadata — the template is
 * already approved on Meta, so there is NO Meta call and no re-review.
 * Every subsequent send picks the URL up automatically (the send-builder
 * falls back to `template.header_media_url` when no per-send override is
 * given).
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MEDIA_HEADER_TYPES = new Set(['image', 'video', 'document']);

// Meta fetches the URL at send time, so it must be publicly reachable
// over http(s) — anything else is garbage the send-builder would choke on.
const URL_RE = /^https?:\/\/.+/i;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json(
        { error: 'Invalid template id.' },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Project-scoping mirrors the sibling /templates/[id] and /submit
    // routes so teammates can attach media to the project's templates —
    // and only that project's.
    const { accountId, projectId } = await getCurrentProject();
    void accountId;

    let headerMediaUrl: string;
    try {
      const body = (await request.json()) as { header_media_url?: string };
      headerMediaUrl = String(body?.header_media_url ?? '').trim();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body.' },
        { status: 400 }
      );
    }

    if (!URL_RE.test(headerMediaUrl)) {
      return NextResponse.json(
        { error: 'header_media_url must be a public http(s) URL.' },
        { status: 400 }
      );
    }

    const { data: existing, error: lookupErr } = await supabase
      .from('message_templates')
      .select('id, header_type, header_media_url')
      .eq('id', id)
      .eq('project_id', projectId)
      .maybeSingle();
    if (lookupErr || !existing) {
      return NextResponse.json(
        { error: 'Template not found.' },
        { status: 404 }
      );
    }

    if (
      !existing.header_type ||
      !MEDIA_HEADER_TYPES.has(existing.header_type)
    ) {
      return NextResponse.json(
        {
          error:
            'This template does not use a media header (image/video/document) — there is nothing to attach.',
        },
        { status: 400 }
      );
    }

    const { data: row, error: updErr } = await supabase
      .from('message_templates')
      .update({
        header_media_url: headerMediaUrl,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (updErr) {
      return NextResponse.json(
        { error: `Failed to save header media: ${updErr.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, template: row });
  } catch (error) {
    console.error('Error attaching template header media:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to save header media.',
      },
      { status: 500 }
    );
  }
}
