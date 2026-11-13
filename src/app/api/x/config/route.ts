import { NextResponse } from 'next/server';
import { toErrorResponse } from '@/lib/auth/account';
import { getCurrentProject, requireProjectRole } from '@/lib/auth/project';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { encrypt } from '@/lib/whatsapp/encryption';
import { sanitizeXToken, verifyXToken, XApiError } from '@/lib/x/client';
import { loadActiveXConfig, saveXConfig, toSafeXConfig } from '@/lib/x/config-store';

export const dynamic = 'force-dynamic';

function isMissingTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === 'PGRST205' ||
    error.code === '42P01' ||
    Boolean(error.message?.includes('Could not find the table')) ||
    Boolean(error.message?.includes('does not exist'))
  );
}

export async function GET(request: Request) {
  try {
    const ctx = await getCurrentProject();
    const origin = new URL(request.url).origin;
    const oauthRedirectUri = `${origin}/api/x/oauth`;

    const { data: row, error } = await supabaseAdmin()
      .from('x_config')
      .select('*')
      .eq('project_id', ctx.projectId)
      .maybeSingle();

    if (error) {
      if (isMissingTableError(error)) {
        return NextResponse.json({
          config: toSafeXConfig(null),
          table_missing: true,
          oauth_redirect_uri: oauthRedirectUri,
          env_oauth_configured: Boolean(process.env.X_CLIENT_ID),
        });
      }
      console.error('[GET /api/x/config] error:', error);
    }

    return NextResponse.json({
      config: toSafeXConfig((row as Record<string, unknown> | null) ?? null),
      table_missing: false,
      oauth_redirect_uri: oauthRedirectUri,
      env_oauth_configured: Boolean(process.env.X_CLIENT_ID),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireProjectRole('admin');
    const body = (await request.json().catch(() => null)) as {
      access_token?: unknown;
      client_id?: unknown;
      client_secret?: unknown;
    } | null;

    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const rawToken =
      typeof body.access_token === 'string' ? sanitizeXToken(body.access_token) : '';
    if (!rawToken) {
      return NextResponse.json(
        { error: 'X User Access Token is required' },
        { status: 400 },
      );
    }

    const profile = await verifyXToken(rawToken);
    const { data: saved, error: upsertErr } = await saveXConfig({
      ctx,
      connectionMethod: 'token',
      profile,
      accessToken: rawToken,
      clientId: typeof body.client_id === 'string' ? body.client_id : undefined,
      clientSecret: typeof body.client_secret === 'string' ? body.client_secret : undefined,
    });

    if (upsertErr) {
      if (isMissingTableError(upsertErr)) {
        return NextResponse.json(
          {
            error:
              "Database table 'x_config' not found. Run supabase/migrations/064_x_integration.sql in Supabase SQL Editor.",
            table_missing: true,
          },
          { status: 400 },
        );
      }
      console.error('[POST /api/x/config] upsert error:', upsertErr);
      return NextResponse.json(
        { error: 'Failed to save X configuration' },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      config: toSafeXConfig(saved as Record<string, unknown>),
      profile,
    });
  } catch (err) {
    if (err instanceof XApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status || 400 });
    }
    return toErrorResponse(err);
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await requireProjectRole('admin');
    const body = (await request.json().catch(() => null)) as {
      action?: unknown;
      client_id?: unknown;
      client_secret?: unknown;
    } | null;

    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const db = supabaseAdmin();

    if (body.action === 'sync') {
      const active = await loadActiveXConfig(ctx.projectId);
      if (!active) {
        return NextResponse.json(
          { error: 'X is not connected for this project.' },
          { status: 400 },
        );
      }

      const profile = await verifyXToken(active.accessToken, active.grantedScopes);
      const { data: saved, error } = await saveXConfig({
        ctx,
        connectionMethod: active.connectionMethod,
        profile,
        accessToken: active.accessToken,
      });

      if (error) {
        return NextResponse.json(
          { error: 'Failed to update synced X profile' },
          { status: 500 },
        );
      }

      return NextResponse.json({
        success: true,
        config: toSafeXConfig(saved as Record<string, unknown>),
      });
    }

    const nowIso = new Date().toISOString();
    const { data: existing } = await db
      .from('x_config')
      .select('id')
      .eq('project_id', ctx.projectId)
      .maybeSingle();

    const patch: Record<string, unknown> = { updated_at: nowIso };
    if (typeof body.client_id === 'string') {
      patch.client_id = body.client_id.trim() || null;
    }
    if (typeof body.client_secret === 'string' && body.client_secret.trim()) {
      patch.client_secret = encrypt(body.client_secret.trim());
    }

    if (existing?.id) {
      const { data: updated, error } = await db
        .from('x_config')
        .update(patch)
        .eq('id', existing.id)
        .select('*')
        .single();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      return NextResponse.json({
        success: true,
        config: toSafeXConfig(updated as Record<string, unknown>),
      });
    }

    const { data: created, error: insertErr } = await db
      .from('x_config')
      .insert({
        account_id: ctx.accountId,
        project_id: ctx.projectId,
        user_id: ctx.userId,
        connection_method: 'oauth',
        status: 'disconnected',
        ...patch,
      })
      .select('*')
      .single();

    if (insertErr) {
      if (isMissingTableError(insertErr)) {
        return NextResponse.json(
          {
            error:
              "Database table 'x_config' not found. Run supabase/migrations/064_x_integration.sql.",
            table_missing: true,
          },
          { status: 400 },
        );
      }
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      config: toSafeXConfig(created as Record<string, unknown>),
    });
  } catch (err) {
    if (err instanceof XApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status || 400 });
    }
    return toErrorResponse(err);
  }
}

export async function DELETE() {
  try {
    const ctx = await requireProjectRole('admin');

    const { error } = await supabaseAdmin()
      .from('x_config')
      .update({
        status: 'disconnected',
        access_token: null,
        refresh_token: null,
        token_expires_at: null,
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('project_id', ctx.projectId);

    if (error) {
      if (isMissingTableError(error)) {
        return NextResponse.json({ success: true });
      }
      return NextResponse.json(
        { error: 'Failed to disconnect X' },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

