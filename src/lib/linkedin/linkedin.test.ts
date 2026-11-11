import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildLinkedInAuthUrl,
  computeLinkedInChallengeResponse,
  publishLinkedInPost,
  verifyLinkedInToken,
  verifyLinkedInWebhookSignature,
} from './client';

describe('LinkedIn integration client & webhook security', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects pasted Meta/Instagram tokens and malformed LinkedIn tokens', async () => {
    await expect(
      verifyLinkedInToken('EAABwzLixnjYBO12345678901234567890'),
    ).rejects.toThrow(/Meta\/Instagram/i);
    await expect(
      verifyLinkedInToken('IGAA12345678901234567890abcdef'),
    ).rejects.toThrow(/Meta\/Instagram/i);
    await expect(verifyLinkedInToken('short')).rejects.toThrow(/incomplete/i);
  });

  it('verifies a LinkedIn OpenID token and discovers administered Company Pages', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/v2/userinfo')) {
        return new Response(
          JSON.stringify({
            sub: 'member_abc123',
            name: 'Keerthana S',
            email: 'keerthana@cloudmasa.com',
            picture: 'https://media.licdn.com/avatar.jpg',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/v2/organizationAcls')) {
        return new Response(
          JSON.stringify({
            elements: [{ organization: 'urn:li:organization:98765432', role: 'ADMINISTRATOR' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/v2/organizations/98765432')) {
        return new Response(
          JSON.stringify({
            id: 98765432,
            localizedName: 'CloudMaSa Technologies',
            vanityName: 'cloudmasa',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 404 });
    });

    const profile = await verifyLinkedInToken('  "Bearer AQV_LinkedInToken_123456789012345"  ');
    expect(profile.memberUrn).toBe('urn:li:person:member_abc123');
    expect(profile.displayName).toBe('Keerthana S');
    expect(profile.organizationId).toBe('98765432');
    expect(profile.organizations).toHaveLength(1);
    expect(profile.organizations[0].name).toBe('CloudMaSa Technologies');
  });

  it('falls back to /v2/ugcPosts when /rest/posts rejects with 403/426', async () => {
    const calls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      calls.push(url);
      if (url.includes('/rest/posts')) {
        return new Response(JSON.stringify({ message: 'Versioned REST API disabled' }), {
          status: 403,
        });
      }
      if (url.includes('/v2/ugcPosts')) {
        return new Response(JSON.stringify({ id: 'urn:li:share:555111' }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('{}', { status: 400 });
    });

    const res = await publishLinkedInPost({
      accessToken: 'AQV_Token_12345678901234567890',
      authorUrn: 'urn:li:person:member_abc123',
      text: 'Launching RegiBIZ!',
      articleUrl: 'https://regibiz.in',
      articleTitle: 'RegiBIZ',
    });

    expect(res.postUrn).toBe('urn:li:share:555111');
    expect(calls.some((u) => u.includes('/rest/posts'))).toBe(true);
    expect(calls.some((u) => u.includes('/v2/ugcPosts'))).toBe(true);
  });

  it('builds OAuth authorization URLs and validates challenge + webhook HMAC signatures', () => {
    const authUrl = buildLinkedInAuthUrl({
      clientId: 'client_123',
      redirectUri: 'https://crm.example.com/api/linkedin/oauth',
      state: 'signed_state',
      scopes: ['openid', 'profile', 'w_member_social'],
    });
    expect(authUrl).toContain('https://www.linkedin.com/oauth/v2/authorization');
    expect(authUrl).toContain('client_id=client_123');
    expect(authUrl).toContain('w_member_social');

    const secret = 'li_app_secret_xyz';
    const challenge = 'challenge_999';
    const expected = crypto.createHmac('sha256', secret).update(challenge).digest('hex');
    expect(computeLinkedInChallengeResponse(challenge, secret)).toBe(expected);

    const payload = '{"type":"LEAD_GEN_FORM_RESPONSE"}';
    const sig = `hmacsha256=${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`;
    expect(verifyLinkedInWebhookSignature(payload, sig, secret)).toBe(true);
    expect(verifyLinkedInWebhookSignature(payload, 'hmacsha256=' + '0'.repeat(64), secret)).toBe(
      false,
    );
  });

  it('enforces project admin roles on LinkedIn config/oauth and fails closed on webhooks', () => {
    const configSrc = readFileSync(
      join(process.cwd(), 'src', 'app', 'api', 'linkedin', 'config', 'route.ts'),
      'utf8',
    );
    const oauthSrc = readFileSync(
      join(process.cwd(), 'src', 'app', 'api', 'linkedin', 'oauth', 'route.ts'),
      'utf8',
    );
    const webhookSrc = readFileSync(
      join(process.cwd(), 'src', 'app', 'api', 'linkedin', 'webhook', 'route.ts'),
      'utf8',
    );

    expect(configSrc).toContain("requireProjectRole('admin')");
    expect(oauthSrc).toContain("requireProjectRole('admin')");
    expect(webhookSrc).toContain('verifyLinkedInWebhookSignature');
    expect(webhookSrc).toContain("status: 401");
  });
});

