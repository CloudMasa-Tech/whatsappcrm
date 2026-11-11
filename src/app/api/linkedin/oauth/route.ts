import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { requireProjectRole } from '@/lib/auth/project';
import { decrypt } from '@/lib/whatsapp/encryption';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  buildLinkedInAuthUrl,
  exchangeLinkedInCode,
  verifyLinkedInToken,
} from '@/lib/linkedin/client';
import { saveLinkedInConfig } from '@/lib/linkedin/config-store';

export const dynamic = 'force-dynamic';

const STATE_COOKIE = 'li_oauth_state';
const STATE_MAX_AGE_MS = 15 * 60 * 1000;

function getStateHmacKey(): string {
  const key = process.env.ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error('Server encryption key is missing.');
  }
  return key;
}

function signStatePayload(payload: Record<string, unknown>): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', getStateHmacKey())
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${sig}`;
}

function verifyStatePayload(token: string): Record<string, unknown> | null {
  const [encoded, sig] = token.split('.');
  if (!encoded || !sig) return null;
  const expected = crypto
    .createHmac('sha256', getStateHmacKey())
    .update(encoded)
    .digest('base64url');

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(sig, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

async function resolveAppCredentials(projectId: string): Promise<{
  clientId: string | null;
  clientSecret: string | null;
}> {
  const { data: row } = await supabaseAdmin()
    .from('linkedin_config')
    .select('client_id, client_secret')
    .eq('project_id', projectId)
    .maybeSingle();

  let secret: string | null = null;
  if (row?.client_secret) {
    try {
      secret = decrypt(row.client_secret);
    } catch {
      secret = null;
    }
  }

  return {
    clientId: row?.client_id || process.env.LINKEDIN_CLIENT_ID || null,
    clientSecret: secret || process.env.LINKEDIN_CLIENT_SECRET || null,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = url.origin;
  const redirectUri = `${origin}/api/linkedin/oauth`;
  const action = url.searchParams.get('action');

  // 1. Start OAuth redirect flow
  if (action === 'authorize') {
    try {
      const ctx = await requireProjectRole('admin');
      const { clientId, clientSecret } = await resolveAppCredentials(ctx.projectId);

      if (!clientId || !clientSecret) {
        return NextResponse.json(
          {
            error:
              'LinkedIn Client ID and Client Secret must be saved before starting OAuth.',
          },
          { status: 400 },
        );
      }

      const rawScopes = url.searchParams.get('scopes') || '';
      const scopes = rawScopes
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean);

      const nonce = crypto.randomBytes(16).toString('hex');
      const signedState = signStatePayload({
        nonce,
        projectId: ctx.projectId,
        ts: Date.now(),
      });

      const authUrl = buildLinkedInAuthUrl({
        clientId,
        redirectUri,
        state: signedState,
        scopes: scopes.length > 0 ? scopes : undefined,
      });

      const res = NextResponse.redirect(authUrl);
      res.cookies.set(STATE_COOKIE, nonce, {
        httpOnly: true,
        sameSite: 'lax',
        secure: url.protocol === 'https:',
        path: '/api/linkedin/oauth',
        maxAge: 15 * 60,
      });
      return res;
    } catch (err) {
      return NextResponse.redirect(
        `${origin}/linkedin?oauth_error=${encodeURIComponent(
          err instanceof Error ? err.message : 'Unable to start LinkedIn OAuth',
        )}`,
      );
    }
  }

  // 2. OAuth Callback from LinkedIn
  const oauthError = url.searchParams.get('error_description') || url.searchParams.get('error');
  if (oauthError) {
    return NextResponse.redirect(
      `${origin}/linkedin?oauth_error=${encodeURIComponent(oauthError)}`,
    );
  }

  const code = url.searchParams.get('code')?.trim();
  const state = url.searchParams.get('state')?.trim();

  if (!code || !state) {
    return NextResponse.redirect(
      `${origin}/linkedin?oauth_error=${encodeURIComponent('Missing OAuth code or state.')}`,
    );
  }

  try {
    const ctx = await requireProjectRole('admin');
    const cookieStore = await cookies();
    const expectedNonce = cookieStore.get(STATE_COOKIE)?.value;
    const parsedState = verifyStatePayload(state);

    if (
      !expectedNonce ||
      !parsedState ||
      parsedState.nonce !== expectedNonce ||
      parsedState.projectId !== ctx.projectId ||
      typeof parsedState.ts !== 'number' ||
      Date.now() - parsedState.ts > STATE_MAX_AGE_MS
    ) {
      return NextResponse.redirect(
        `${origin}/linkedin?oauth_error=${encodeURIComponent('Invalid or expired OAuth state. Please try connecting again.')}`,
      );
    }

    const { clientId, clientSecret } = await resolveAppCredentials(ctx.projectId);
    if (!clientId || !clientSecret) {
      return NextResponse.redirect(
        `${origin}/linkedin?oauth_error=${encodeURIComponent('LinkedIn Client ID/Secret not configured.')}`,
      );
    }

    const tokenRes = await exchangeLinkedInCode({
      code,
      redirectUri,
      clientId,
      clientSecret,
    });

    const profile = await verifyLinkedInToken(tokenRes.accessToken, {
      grantedScopes: tokenRes.grantedScopes,
    });

    const { error: saveErr } = await saveLinkedInConfig({
      ctx,
      connectionMethod: 'oauth',
      profile,
      accessToken: tokenRes.accessToken,
      refreshToken: tokenRes.refreshToken,
      expiresInSeconds: tokenRes.expiresIn,
      clientId,
      clientSecret,
    });

    if (saveErr) {
      return NextResponse.redirect(
        `${origin}/linkedin?oauth_error=${encodeURIComponent('Failed to store LinkedIn OAuth session.')}`,
      );
    }

    const res = NextResponse.redirect(`${origin}/linkedin?oauth=connected`);
    res.cookies.delete(STATE_COOKIE);
    return res;
  } catch (err) {
    return NextResponse.redirect(
      `${origin}/linkedin?oauth_error=${encodeURIComponent(
        err instanceof Error ? err.message : 'LinkedIn OAuth callback failed',
      )}`,
    );
  }
}

