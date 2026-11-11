import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchUserFacebookPages,
  verifyFacebookPageToken,
} from './meta-client';

describe('Facebook Page token verification & discovery', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects IGAA Instagram Login tokens, App Secrets, and App|Secret tokens', async () => {
    await expect(
      verifyFacebookPageToken('IGAA12345678901234567890abcdef'),
    ).rejects.toThrow(/Instagram Login/i);
    await expect(
      verifyFacebookPageToken('0123456789abcdef0123456789abcdef'),
    ).rejects.toThrow(/App Secret/i);
    await expect(
      verifyFacebookPageToken('123456789012345|abcdef1234567890abcdef'),
    ).rejects.toThrow(/App\/Client Token/i);
  });

  it('resolves a Facebook User token via /me/accounts into Page ID and Page Access Token', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/me/accounts')) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: '104829384729102',
                name: 'CloudMaSa Official',
                category: 'Software Company',
                access_token: 'EAAPageAccessToken999999999999999999',
                picture: { data: { url: 'https://fbcdn.net/page-avatar.jpg' } },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ error: { message: 'Unexpected call' } }), {
        status: 400,
      });
    });

    const profile = await verifyFacebookPageToken(
      '  "Bearer EAAUserToken12345678901234567890"  ',
    );
    expect(profile).toEqual({
      id: '104829384729102',
      name: 'CloudMaSa Official',
      category: 'Software Company',
      profilePictureUrl: 'https://fbcdn.net/page-avatar.jpg',
      pageAccessToken: 'EAAPageAccessToken999999999999999999',
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('rejects a User token that returns 0 Pages instead of saving the User node', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(
      verifyFacebookPageToken('EAAUserTokenNoPages123456789012345678'),
    ).rejects.toThrow(/0 Pages/i);
  });

  it('verifies a direct Page Access Token when /me/accounts returns #100 on Page node', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/me/accounts')) {
        return new Response(
          JSON.stringify({
            error: {
              message: '(#100) Tried accessing nonexisting field (accounts) on node type (Page)',
              code: 100,
            },
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/me?fields=id,name,category,picture')) {
        return new Response(
          JSON.stringify({
            id: '20987654321',
            name: 'RegiBIZ India',
            category: 'Business Service',
            picture: { data: { url: 'https://fbcdn.net/regibiz.jpg' } },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 400 });
    });

    const profile = await verifyFacebookPageToken('EAAGPageTokenDirect12345678901234567890');
    expect(profile.id).toBe('20987654321');
    expect(profile.name).toBe('RegiBIZ India');
    expect(profile.pageAccessToken).toBe('EAAGPageTokenDirect12345678901234567890');
  });

  it('falls back cleanly when a Page Access Token is pasted into Page Discovery', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/me/accounts')) {
        return new Response(
          JSON.stringify({
            error: {
              message: '(#100) Tried accessing nonexisting field (accounts) on node type (Page)',
              code: 100,
            },
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          id: '333444555',
          name: 'Direct Page',
          category: 'Company',
          picture: { data: { url: null } },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const pages = await fetchUserFacebookPages('EAAGPageTokenDirect12345678901234567890');
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({
      id: '333444555',
      name: 'Direct Page',
      accessToken: 'EAAGPageTokenDirect12345678901234567890',
    });
  });

  it('persists canonical 058_facebook_config columns in both /api/facebook/config and /api/facebook/oauth', () => {
    const storeSrc = readFileSync(
      join(process.cwd(), 'src', 'lib', 'facebook', 'config-store.ts'),
      'utf8',
    );
    const oauthSrc = readFileSync(
      join(process.cwd(), 'src', 'app', 'api', 'facebook', 'oauth', 'route.ts'),
      'utf8',
    );
    const configSrc = readFileSync(
      join(process.cwd(), 'src', 'app', 'api', 'facebook', 'config', 'route.ts'),
      'utf8',
    );

    expect(storeSrc).toContain('account_id: ctx.accountId');
    expect(storeSrc).toContain('user_id: ctx.userId');
    expect(storeSrc).toContain('access_token: encrypt(effectiveToken)');
    expect(storeSrc).toContain('verify_token: encrypt(verifyToken)');
    expect(storeSrc).not.toContain('encrypted_access_token');
    expect(storeSrc).not.toContain('encrypted_app_secret');

    expect(oauthSrc).toContain('saveFacebookPageConfig');
    expect(oauthSrc).not.toContain('encrypted_access_token');
    expect(configSrc).toContain('saveFacebookPageConfig');
  });
});

