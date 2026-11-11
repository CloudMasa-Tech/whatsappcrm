/**
 * /api/facebook/config
 *
 * Connect, inspect and disconnect a Facebook Page.
 *
 * GET    — current connection state (never returns secrets)
 * POST   — verify a Page access token with Meta, then store it encrypted
 * DELETE — disconnect and clear the stored credentials
 *
 * Mirrors /api/instagram/config: same Messenger Platform, same
 * credential shape, so the two stay recognisably one pattern.
 */

import { NextResponse } from 'next/server';

import { getCurrentProject, requireProjectRole } from '@/lib/auth/project';
import { toErrorResponse } from '@/lib/auth/account';
import { sanitizeAccessToken } from '@/lib/instagram/meta-client';
import { saveFacebookPageConfig } from '@/lib/facebook/config-store';
import { verifyFacebookPageToken } from '@/lib/facebook/meta-client';

/** Columns safe to return to the browser — no token columns. */
const PUBLIC_COLUMNS =
  'id, page_id, page_name, profile_picture_url, status, last_error, connected_at, created_at, updated_at';

export async function GET(request: Request) {
  try {
    const ctx = await getCurrentProject();
    const origin = new URL(request.url).origin;
    const webhookUrl = `${origin}/api/facebook/webhook`;
    const defaultVerifyToken = `masacrm_fb_${ctx.projectId.slice(0, 8)}`;

    const { data: config, error } = await ctx.supabase
      .from('facebook_config')
      .select(PUBLIC_COLUMNS)
      .eq('project_id', ctx.projectId)
      .maybeSingle();

    if (error) {
      // Migration 058 not applied yet — say so plainly rather than
      // failing with a generic 500.
      if (
        error.code === 'PGRST205' ||
        error.message?.includes('Could not find the table')
      ) {
        return NextResponse.json({
          config: { status: 'disconnected' },
          table_missing: true,
          webhook_url: webhookUrl,
          default_verify_token: defaultVerifyToken,
        });
      }

      console.error('[GET /api/facebook/config] error:', error);
      return NextResponse.json({
        config: { status: 'disconnected' },
        webhook_url: webhookUrl,
        default_verify_token: defaultVerifyToken,
      });
    }

    return NextResponse.json({
      config: config ?? { status: 'disconnected' },
      webhook_url: webhookUrl,
      default_verify_token: defaultVerifyToken,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireProjectRole('agent');
    const body = (await request.json().catch(() => null)) as {
      access_token?: unknown;
      page_id?: unknown;
      verify_token?: unknown;
      app_secret?: unknown;
    } | null;

    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const accessToken =
      typeof body.access_token === 'string'
        ? sanitizeAccessToken(body.access_token)
        : '';
    if (!accessToken) {
      return NextResponse.json(
        { error: 'A Facebook Page access token is required' },
        { status: 400 },
      );
    }

    const pageId = typeof body.page_id === 'string' ? body.page_id.trim() : '';

    // Verify BEFORE storing. A saved-but-invalid credential shows as
    // connected while silently failing every send.
    let profile;
    try {
      profile = await verifyFacebookPageToken(accessToken, pageId || undefined);
    } catch (err) {
      return NextResponse.json(
        {
          error:
            err instanceof Error
              ? err.message
              : 'Failed to verify the Facebook Page credentials.',
        },
        { status: 400 },
      );
    }

    const { data: savedConfig, error: upsertErr } = await saveFacebookPageConfig({
      ctx,
      profile,
      fallbackAccessToken: accessToken,
      verifyToken: typeof body.verify_token === 'string' ? body.verify_token : null,
      appSecret: typeof body.app_secret === 'string' ? body.app_secret : null,
    });

    if (upsertErr) {
      if (
        upsertErr.code === 'PGRST205' ||
        upsertErr.message?.includes('Could not find the table')
      ) {
        return NextResponse.json(
          {
            error:
              "Database table 'facebook_config' not found. Apply migration 058_facebook_config.sql.",
            table_missing: true,
          },
          { status: 400 },
        );
      }

      console.error('[POST /api/facebook/config] upsert error:', upsertErr);
      return NextResponse.json(
        { error: 'Failed to save the Facebook configuration' },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      profile,
      config: savedConfig ?? {
        page_id: profile.id,
        page_name: profile.name,
        profile_picture_url: profile.profilePictureUrl,
        status: 'connected',
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE() {
  try {
    const ctx = await requireProjectRole('agent');

    // Clear the secrets rather than deleting the row, so the disconnect
    // and its timestamps remain visible in the UI.
    const { error } = await ctx.supabase
      .from('facebook_config')
      .update({
        access_token: null,
        verify_token: null,
        app_secret: null,
        status: 'disconnected',
        last_error: null,
        connected_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('project_id', ctx.projectId);

    if (error) {
      console.error('[DELETE /api/facebook/config] error:', error);
      return NextResponse.json(
        { error: 'Failed to disconnect Facebook' },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
