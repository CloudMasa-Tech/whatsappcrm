import { NextResponse } from 'next/server'
import { getCurrentProject } from '@/lib/auth/project'
import { createClient } from '@/lib/supabase/server'
import { getMediaUrl, downloadMedia } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'
import { ephemeralMediaCache } from '@/lib/media/ephemeral-cache'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ mediaId: string }> }
) {
  try {
    const { mediaId } = await params

    if (!mediaId) {
      return NextResponse.json(
        { error: 'Media ID is required' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Resolve the caller's account_id — whatsapp_config is one-per-
    // account post-multi-user, so a teammate fetching media for a
    // conversation in the shared inbox needs the account's config,
    // not their personal (non-existent) row.
    // Resolve the caller's account AND active project. Post-042 the
    // project is the tenancy key on every domain row, and this route
    // writes through the service-role client, so RLS will not catch a
    // missing or wrong scope.
    const { accountId, projectId } = await getCurrentProject();
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      )
    }

    // Fetch and decrypt WhatsApp config
    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('*')
      .eq('project_id', projectId)
      .single()

    if (configError || !config) {
      return NextResponse.json(
        { error: 'WhatsApp not configured' },
        { status: 400 }
      )
    }

    const cacheKey = ephemeralMediaCache.keyFor(
      'wa-cloud',
      `${projectId}:${mediaId}`,
    )

    const media = await ephemeralMediaCache.getOrLoad(cacheKey, async () => {
      const accessToken = decrypt(config.access_token)
      const mediaInfo = await getMediaUrl({ mediaId, accessToken })
      const { buffer, contentType } = await downloadMedia({
        downloadUrl: mediaInfo.url,
        accessToken,
      })
      return {
        buffer: Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer),
        contentType:
          contentType || mediaInfo.mimeType || 'application/octet-stream',
      }
    })

    return new Response(new Uint8Array(media.buffer), {
      status: 200,
      headers: {
        'Content-Type': media.contentType,
        'Cache-Control': 'private, max-age=604800, immutable',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    console.error('Error in WhatsApp media GET:', error)
    return NextResponse.json(
      { error: 'Failed to fetch media' },
      { status: 500 }
    )
  }
}
