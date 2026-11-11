import { NextResponse, after } from 'next/server';
import { decrypt } from '@/lib/whatsapp/encryption';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  computeLinkedInChallengeResponse,
  fetchLinkedInLeadSubmissions,
  normalizeOrganizationId,
  verifyLinkedInWebhookSignature,
} from '@/lib/linkedin/client';
import { ingestLinkedInLeadToCrm } from '@/lib/linkedin/config-store';

export const maxDuration = 60;

async function resolveWebhookSecrets(): Promise<
  Array<{ projectId: string; accountId: string; userId: string; secret: string }>
> {
  const results: Array<{
    projectId: string;
    accountId: string;
    userId: string;
    secret: string;
  }> = [];

  const { data: configs } = await supabaseAdmin()
    .from('linkedin_config')
    .select('project_id, account_id, user_id, client_secret, verify_token');

  for (const row of configs ?? []) {
    for (const field of [row.client_secret, row.verify_token]) {
      if (!field || typeof field !== 'string') continue;
      try {
        const plain = decrypt(field);
        if (plain) {
          results.push({
            projectId: row.project_id,
            accountId: row.account_id,
            userId: row.user_id,
            secret: plain,
          });
        }
      } catch {
        // Ignore un-decryptable values
      }
    }
  }

  return results;
}

// GET — LinkedIn Webhook Endpoint Validation (challengeCode -> HMAC-SHA256)
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const challengeCode = searchParams.get('challengeCode');
    const applicationId = searchParams.get('applicationId');

    if (!challengeCode) {
      return NextResponse.json({ error: 'Missing challengeCode' }, { status: 400 });
    }

    const db = supabaseAdmin();
    let secret: string | null = process.env.LINKEDIN_CLIENT_SECRET || null;

    if (applicationId) {
      const { data: byClient } = await db
        .from('linkedin_config')
        .select('client_secret')
        .eq('client_id', applicationId)
        .maybeSingle();
      if (byClient?.client_secret) {
        try {
          secret = decrypt(byClient.client_secret);
        } catch {
          secret = null;
        }
      }
    }

    if (!secret) {
      const all = await resolveWebhookSecrets();
      secret = all[0]?.secret ?? null;
    }

    if (!secret) {
      return NextResponse.json(
        { error: 'LinkedIn Client Secret or Webhook Verify Token is not configured.' },
        { status: 403 },
      );
    }

    return NextResponse.json(
      {
        challengeCode,
        challengeResponse: computeLinkedInChallengeResponse(challengeCode, secret),
      },
      { status: 200 },
    );
  } catch (err) {
    console.error('[LinkedIn webhook] GET validation error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

interface LinkedInWebhookPayload {
  type?: string;
  eventBody?: Record<string, unknown>;
  associatedEntity?: string;
  owner?: string;
  organization?: string;
  leadGenFormResponse?: string;
}

// POST — Receive LinkedIn Organization / Lead Gen webhook events
export async function POST(request: Request) {
  const raw = await request.text();
  const signature = request.headers.get('x-li-signature');

  let payload: LinkedInWebhookPayload;
  try {
    payload = JSON.parse(raw) as LinkedInWebhookPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const orgCandidate = normalizeOrganizationId(
    payload.organization || payload.owner || payload.associatedEntity || '',
  );

  const db = supabaseAdmin();
  let matchedSecretRow: {
    project_id: string;
    account_id: string;
    user_id: string;
    access_token: string | null;
    organization_id: string | null;
    client_secret: string | null;
    verify_token: string | null;
  } | null = null;

  const { data: configs } = orgCandidate
    ? await db
        .from('linkedin_config')
        .select(
          'project_id, account_id, user_id, access_token, organization_id, client_secret, verify_token',
        )
        .eq('organization_id', orgCandidate)
    : await db
        .from('linkedin_config')
        .select(
          'project_id, account_id, user_id, access_token, organization_id, client_secret, verify_token',
        )
        .eq('status', 'connected');

  for (const row of configs ?? []) {
    const candidates = [row.client_secret, row.verify_token]
      .filter((v): v is string => Boolean(v))
      .map((v) => {
        try {
          return decrypt(v);
        } catch {
          return null;
        }
      })
      .filter((v): v is string => Boolean(v));

    if (process.env.LINKEDIN_CLIENT_SECRET) {
      candidates.push(process.env.LINKEDIN_CLIENT_SECRET);
    }

    if (
      signature &&
      candidates.some((secret) => verifyLinkedInWebhookSignature(raw, signature, secret))
    ) {
      matchedSecretRow = row;
      break;
    }
  }

  if (!matchedSecretRow) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const rowSnapshot = matchedSecretRow;
  after(async () => {
    try {
      if (
        (payload.type === 'LEAD_GEN_FORM_RESPONSE' || payload.leadGenFormResponse) &&
        rowSnapshot.access_token &&
        rowSnapshot.organization_id
      ) {
        const token = decrypt(rowSnapshot.access_token);
        const submissions = await fetchLinkedInLeadSubmissions(
          token,
          rowSnapshot.organization_id,
          10,
        );
        for (const lead of submissions) {
          await ingestLinkedInLeadToCrm({
            accountId: rowSnapshot.account_id,
            projectId: rowSnapshot.project_id,
            ownerUserId: rowSnapshot.user_id,
            lead,
          });
        }
      }
    } catch (err) {
      console.error('[LinkedIn webhook] async event error:', err);
    }
  });

  return NextResponse.json({ status: 'received' }, { status: 200 });
}

