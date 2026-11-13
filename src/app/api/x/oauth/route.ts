import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { requireProjectRole } from '@/lib/auth/project';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { decrypt } from '@/lib/whatsapp/encryption';
import {
  buildXAuthUrl,
  buildXCodeChallenge,
  exchangeXCode,
  verifyXToken,
} from '@/lib/x/client';
import { saveXConfig } from '@/lib/x/config-store';

export const dynamic = 'force-dynamic';

const STATE_COOKIE = 'x_oauth_state';
const STATE_MAX_AGE_MS = 15 * 60 * 1000;

function getStateHmacKey(): string {
  const key = process.env.ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error('Server encryption key is missing.');
  }
  return key;
}

function signCookiePayload(payload: Record<string, unknown>): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', getStateHmacKey())
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${sig}`;
}

function verifyCookiePayload(token: string): Record<string, unknown> | null {
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
    .from('x_config')
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
    clientId: row?.client_id || process.env.X_CLIENT_ID || null,
    clientSecret: secret || process.env.X_CLIENT_SECRET || null,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = url.origin;
  const redirectUri = `${origin}/api/x/oauth`;
  const action = url.searchParams.get('action');

  if (action === 'authorize') {
    try {
      const ctx = await requireProjectRole('admin');
      const { clientId } = await resolveAppCredentials(ctx.projectId);

      if (!clientId) {
        return NextResponse.json(
          { error: 'X OAuth Client ID must be saved before starting OAuth.' },
          { status: 400 },
        );
      }

      const rawScopes = url.searchParams.get('scopes') || '';
      const scopes = rawScopes
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean);

      const nonce = crypto.randomBytes(16).toString('hex');
      const codeVerifier = crypto.randomBytes(32).toString('base64url');
      const codeChallenge = buildXCodeChallenge(codeVerifier);

      const authUrl = buildXAuthUrl({
        clientId,
        redirectUri,
        state: nonce,
        codeChallenge,
        scopes: scopes.length > 0 ? scopes : undefined,
      });

      const signedCookie = signCookiePayload({
        nonce,
        codeVerifier,
        projectId: ctx.projectId,
        ts: Date.now(),
      });

      const res = NextResponse.redirect(authUrl);
      res.cookies.set(STATE_COOKIE, signedCookie, {
        httpOnly: true,
        sameSite: 'lax',
        secure: url.protocol === 'https:',
        path: '/api/x/oauth',
        maxAge: 15 * 60,
      });
      return res;
    } catch (err) {
      return NextResponse.redirect(
        `${origin}/x?oauth_error=${encodeURIComponent(
          err instanceof Error ? err.message : 'Unable to start X OAuth',
        )}`,
      );
    }
  }

  const oauthError = url.searchParams.get('error_description') || url.searchParams.get('error');
  if (oauthError) {
    return NextResponse.redirect(
      `${origin}/x?oauth_error=${encodeURIComponent(oauthError)}`,
    );
  }

  const code = url.searchParams.get('code')?.trim();
  const state = url.searchParams.get('state')?.trim();
  if (!code || !state) {
    return NextResponse.redirect(
      `${origin}/x?oauth_error=${encodeURIComponent('Missing OAuth code or state.')}`,
    );
  }

  try {
    const ctx = await requireProjectRole('admin');
    const cookieStore = await cookies();
    const rawCookie = cookieStore.get(STATE_COOKIE)?.value;
    const parsed = rawCookie ? verifyCookiePayload(rawCookie) : null;

    if (
      !parsed ||
      parsed.nonce !== state ||
      parsed.projectId !== ctx.projectId ||
      typeof parsed.codeVerifier !== 'string' ||
      typeof parsed.ts !== 'number' ||
      Date.now() - parsed.ts > STATE_MAX_AGE_MS
    ) {
      return NextResponse.redirect(
        `${origin}/x?oauth_error=${encodeURIComponent('Invalid or expired X OAuth state. Please try connecting again.')}`,
      );
    }

    const { clientId, clientSecret } = await resolveAppCredentials(ctx.projectId);
    if (!clientId) {
      return NextResponse.redirect(
        `${origin}/x?oauth_error=${encodeURIComponent('X OAuth Client ID is not configured.')}`,
      );
    }

    const tokenRes = await exchangeXCode({
      code,
      redirectUri,
      clientId,
      clientSecret,
      codeVerifier: parsed.codeVerifier,
    });

    const profile = await verifyXToken(tokenRes.accessToken, tokenRes.scopes);
    const { error: saveErr } = await saveXConfig({
      ctx,
      connectionMethod: 'oauth',
      profile,
      accessToken: tokenRes.accessToken,
      refreshToken: tokenRes.refreshToken,
      expiresIn: tokenRes.expiresIn,
      clientId,
      clientSecret,
    });

    if (saveErr) {
      return NextResponse.redirect(
        `${origin}/x?oauth_error=${encodeURIComponent('Failed to store X OAuth session.')}`,
      );
    }

    const res = NextResponse.redirect(`${origin}/x?oauth=connected`);
    res.cookies.delete(STATE_COOKIE);
    return res;
  } catch (err) {
    return NextResponse.redirect(
      `${origin}/x?oauth_error=${encodeURIComponent(
        err instanceof Error ? err.message : 'X OAuth callback failed',
      )}`,
    );
  }
}

