import { NextResponse } from 'next/server';
import { getCurrentProject, requireProjectRole } from '@/lib/auth/project';
import { toErrorResponse } from '@/lib/auth/account';
import { encrypt } from '@/lib/whatsapp/encryption';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  fetchLinkedInOrganizations,
  LinkedInApiError,
  normalizeOrganizationId,
  sanitizeLinkedInToken,
  verifyLinkedInToken,
} from '@/lib/linkedin/client';
import {
  loadActiveLinkedInConfig,
  saveLinkedInConfig,
  toSafeLinkedInConfig,
} from '@/lib/linkedin/config-store';

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
    const webhookUrl = `${origin}/api/linkedin/webhook`;
    const oauthRedirectUri = `${origin}/api/linkedin/oauth`;
    const defaultVerifyToken = `masacrm_li_${ctx.projectId.slice(0, 8)}`;

    const { data: row, error } = await supabaseAdmin()
      .from('linkedin_config')
      .select('*')
      .eq('project_id', ctx.projectId)
      .maybeSingle();

    if (error) {
      if (isMissingTableError(error)) {
        return NextResponse.json({
          config: toSafeLinkedInConfig(null),
          organizations: [],
          table_missing: true,
          webhook_url: webhookUrl,
          oauth_redirect_uri: oauthRedirectUri,
          default_verify_token: defaultVerifyToken,
          env_oauth_configured: Boolean(
            process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET,
          ),
        });
      }
      console.error('[GET /api/linkedin/config] error:', error);
    }

    const safeConfig = toSafeLinkedInConfig((row as Record<string, unknown> | null) ?? null);
    let organizations: Awaited<ReturnType<typeof fetchLinkedInOrganizations>> = [];
    if (safeConfig.status === 'connected') {
      const active = await loadActiveLinkedInConfig(ctx.projectId).catch(() => null);
      if (active?.accessToken) {
        organizations = await fetchLinkedInOrganizations(active.accessToken).catch(() => []);
      }
    }

    return NextResponse.json({
      config: safeConfig,
      organizations,
      table_missing: false,
      webhook_url: webhookUrl,
      oauth_redirect_uri: oauthRedirectUri,
      default_verify_token: defaultVerifyToken,
      env_oauth_configured: Boolean(
        process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET,
      ),
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
      organization_id?: unknown;
      client_id?: unknown;
      client_secret?: unknown;
      verify_token?: unknown;
    } | null;

    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const rawToken =
      typeof body.access_token === 'string' ? sanitizeLinkedInToken(body.access_token) : '';
    if (!rawToken) {
      return NextResponse.json(
        { error: 'LinkedIn Access Token is required' },
        { status: 400 },
      );
    }

    const profile = await verifyLinkedInToken(rawToken, {
      organizationId:
        typeof body.organization_id === 'string' ? body.organization_id : undefined,
    });

    const { data: saved, error: upsertErr } = await saveLinkedInConfig({
      ctx,
      connectionMethod: 'token',
      profile,
      accessToken: rawToken,
      clientId: typeof body.client_id === 'string' ? body.client_id : null,
      clientSecret: typeof body.client_secret === 'string' ? body.client_secret : null,
      verifyToken: typeof body.verify_token === 'string' ? body.verify_token : null,
    });

    if (upsertErr) {
      if (isMissingTableError(upsertErr)) {
        return NextResponse.json(
          {
            error:
              "Database table 'linkedin_config' not found. Run supabase/migrations/063_linkedin_integration.sql in Supabase SQL Editor.",
            table_missing: true,
          },
          { status: 400 },
        );
      }
      console.error('[POST /api/linkedin/config] upsert error:', upsertErr);
      return NextResponse.json(
        { error: 'Failed to save LinkedIn configuration' },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      config: toSafeLinkedInConfig(saved as Record<string, unknown>),
      profile,
    });
  } catch (err) {
    if (err instanceof LinkedInApiError) {
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
      verify_token?: unknown;
      account_type?: unknown;
      organization_id?: unknown;
      organization_name?: unknown;
    } | null;

    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const db = supabaseAdmin();

    // Action 1: Refresh live LinkedIn profile & org ACLs
    if (body.action === 'sync') {
      const active = await loadActiveLinkedInConfig(ctx.projectId);
      if (!active) {
        return NextResponse.json(
          { error: 'LinkedIn is not connected for this project.' },
          { status: 400 },
        );
      }

      const profile = await verifyLinkedInToken(active.accessToken, {
        organizationId:
          active.accountType === 'organization' ? active.organizationId : undefined,
        grantedScopes: active.grantedScopes,
      });

      const { data: saved, error } = await saveLinkedInConfig({
        ctx,
        connectionMethod: active.connectionMethod,
        profile,
        accessToken: active.accessToken,
      });

      if (error) {
        return NextResponse.json(
          { error: 'Failed to update synced LinkedIn profile' },
          { status: 500 },
        );
      }

      return NextResponse.json({
        success: true,
        config: toSafeLinkedInConfig(saved as Record<string, unknown>),
        organizations: profile.organizations,
      });
    }

    // Action 2: Save OAuth app credentials (before authorizing) or switch active author
    const nowIso = new Date().toISOString();
    const { data: existing } = await db
      .from('linkedin_config')
      .select('id, status')
      .eq('project_id', ctx.projectId)
      .maybeSingle();

    const patch: Record<string, unknown> = { updated_at: nowIso };
    if (typeof body.client_id === 'string') {
      patch.client_id = body.client_id.trim() || null;
    }
    if (typeof body.client_secret === 'string' && body.client_secret.trim()) {
      patch.client_secret = encrypt(body.client_secret.trim());
    }
    if (typeof body.verify_token === 'string' && body.verify_token.trim()) {
      patch.verify_token = encrypt(body.verify_token.trim());
    }
    if (body.account_type === 'person' || body.account_type === 'organization') {
      patch.account_type = body.account_type;
      if (body.account_type === 'organization' && typeof body.organization_id === 'string') {
        const orgId = normalizeOrganizationId(body.organization_id);
        if (orgId) {
          patch.organization_id = orgId;
          patch.organization_urn = `urn:li:organization:${orgId}`;
          if (typeof body.organization_name === 'string' && body.organization_name.trim()) {
            patch.display_name = body.organization_name.trim();
          }
        }
      }
    }

    if (existing?.id) {
      const { data: updated, error } = await db
        .from('linkedin_config')
        .update(patch)
        .eq('id', existing.id)
        .select('*')
        .single();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      return NextResponse.json({
        success: true,
        config: toSafeLinkedInConfig(updated as Record<string, unknown>),
      });
    }

    // Create disconnected config stub holding OAuth credentials
    const { data: created, error: insertErr } = await db
      .from('linkedin_config')
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
              "Database table 'linkedin_config' not found. Run supabase/migrations/063_linkedin_integration.sql.",
            table_missing: true,
          },
          { status: 400 },
        );
      }
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      config: toSafeLinkedInConfig(created as Record<string, unknown>),
    });
  } catch (err) {
    if (err instanceof LinkedInApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status || 400 });
    }
    return toErrorResponse(err);
  }
}

export async function DELETE() {
  try {
    const ctx = await requireProjectRole('admin');

    const { error } = await supabaseAdmin()
      .from('linkedin_config')
      .update({
        status: 'disconnected',
        access_token: null,
        refresh_token: null,
        token_expires_at: null,
        verify_token: null,
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('project_id', ctx.projectId);

    if (error) {
      if (isMissingTableError(error)) {
        return NextResponse.json({ success: true });
      }
      return NextResponse.json(
        { error: 'Failed to disconnect LinkedIn' },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

