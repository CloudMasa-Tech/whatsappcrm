/**
 * LinkedIn OAuth & REST API client.
 *
 * Supports:
 *   - OpenID / Profile token verification (`userinfo`, `/v2/me`)
 *   - Organization / Company Page ACL discovery (`/v2/organizationAcls`, `/rest/organizationAcls`)
 *   - Publishing Posts (text, article links, uploaded images) via `/rest/posts` with `/v2/ugcPosts` fallback
 *   - Reading & replying to Comments (`/rest/socialActions`)
 *   - Organization Analytics (Followers & Share Statistics)
 *   - Lead Sync API (`/rest/leadFormResponses`)
 *   - Webhook Challenge & HMAC-SHA256 signature verification
 */

import crypto from 'node:crypto';
import { sanitizeAccessToken } from '@/lib/instagram/meta-client';
import type {
  LinkedInAnalyticsSummary,
  LinkedInCommentItem,
  LinkedInLeadSubmission,
  LinkedInOrganizationSummary,
  LinkedInPostItem,
  LinkedInProfileMeta,
} from './types';

const LINKEDIN_API_V2 = 'https://api.linkedin.com/v2';
const LINKEDIN_API_REST = 'https://api.linkedin.com/rest';
const LINKEDIN_OAUTH_BASE = 'https://www.linkedin.com/oauth/v2';
const DEFAULT_LINKEDIN_VERSION = process.env.LINKEDIN_API_VERSION || '202502';

export class LinkedInApiError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'LinkedInApiError';
    this.status = status;
  }
}

export function sanitizeLinkedInToken(raw: string): string {
  return sanitizeAccessToken(raw);
}

export function validateLinkedInTokenShape(rawToken: string): string {
  const clean = sanitizeLinkedInToken(rawToken);
  if (!clean) {
    throw new LinkedInApiError('LinkedIn Access Token is required.', 400);
  }
  if (/^EA[A-Z0-9]/i.test(clean) || /^IG[A-Z0-9]/i.test(clean)) {
    throw new LinkedInApiError(
      'You pasted a Meta/Instagram token (EAA.../IGAA...). Paste a LinkedIn OAuth Access Token instead.',
      400,
    );
  }
  if (/^\d+\|[A-Za-z0-9._-]+$/.test(clean) || /^[a-f0-9]{32}$/i.test(clean)) {
    throw new LinkedInApiError(
      'Invalid LinkedIn Access Token format. Paste your generated LinkedIn OAuth Access Token.',
      400,
    );
  }
  if (clean.length < 20) {
    throw new LinkedInApiError(
      'LinkedIn Access Token looks incomplete (must be at least 20 characters).',
      400,
    );
  }
  return clean;
}

export function normalizeOrganizationId(raw?: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(?:urn:li:organization:)?(\d+)$/i);
  if (match?.[1]) return match[1];
  return trimmed.replace(/^urn:li:organization:/i, '').trim() || null;
}

function buildRestHeaders(accessToken: string, extra?: Record<string, string>): HeadersInit {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Linkedin-Version': DEFAULT_LINKEDIN_VERSION,
    'X-Restli-Protocol-Version': '2.0.0',
    ...extra,
  };
}

async function liFetchJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, cache: 'no-store' });
  } catch (err) {
    throw new LinkedInApiError(
      `Could not reach LinkedIn API: ${err instanceof Error ? err.message : String(err)}`,
      502,
    );
  }

  if (res.status === 204) {
    return {} as T;
  }

  const text = await res.text();
  let json: Record<string, unknown> = {};
  if (text) {
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      json = { message: text.slice(0, 300) };
    }
  }

  if (!res.ok) {
    const msg =
      (typeof json.message === 'string' && json.message) ||
      (typeof json.error_description === 'string' && json.error_description) ||
      (typeof json.error === 'string' && json.error) ||
      `LinkedIn API error (${res.status})`;
    throw new LinkedInApiError(msg, res.status);
  }

  return json as T;
}

export function buildLinkedInAuthUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  scopes?: string[];
}): string {
  const scopeList =
    params.scopes && params.scopes.length > 0
      ? params.scopes
      : ['openid', 'profile', 'email', 'w_member_social'];
  const url = new URL(`${LINKEDIN_OAUTH_BASE}/authorization`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', params.clientId.trim());
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('state', params.state);
  url.searchParams.set('scope', scopeList.join(' '));
  return url.toString();
}

export async function exchangeLinkedInCode(params: {
  code: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
}): Promise<{
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number | null;
  grantedScopes: string[];
}> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: params.clientId.trim(),
    client_secret: params.clientSecret.trim(),
  });

  const res = await fetch(`${LINKEDIN_OAUTH_BASE}/accessToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    cache: 'no-store',
  });

  const payload = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error_description?: string;
    error?: string;
  };

  if (!res.ok || !payload.access_token) {
    throw new LinkedInApiError(
      payload.error_description || payload.error || 'Failed to exchange LinkedIn OAuth code.',
      res.status || 400,
    );
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? null,
    expiresIn: typeof payload.expires_in === 'number' ? payload.expires_in : null,
    grantedScopes: payload.scope ? payload.scope.split(/[\s,]+/).filter(Boolean) : [],
  };
}

/**
 * Discovers LinkedIn Organization / Company Pages where this token is an admin.
 * Best-effort: returns [] when the token only holds personal `w_member_social` scopes.
 */
export async function fetchLinkedInOrganizations(
  accessToken: string,
): Promise<LinkedInOrganizationSummary[]> {
  try {
    const acls = await liFetchJson<{
      elements?: Array<{ organization?: string; organizationalTarget?: string; role?: string }>;
    }>(
      `${LINKEDIN_API_V2}/organizationAcls?q=roleAssignee&state=APPROVED&role=ADMINISTRATOR`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    const orgUrns = Array.from(
      new Set(
        (acls.elements ?? [])
          .map((e) => e.organization || e.organizationalTarget)
          .filter((u): u is string => Boolean(u && u.includes('organization:'))),
      ),
    );

    const summaries: LinkedInOrganizationSummary[] = [];
    for (const urn of orgUrns.slice(0, 10)) {
      const id = normalizeOrganizationId(urn);
      if (!id) continue;
      try {
        const org = await liFetchJson<{
          id?: number | string;
          localizedName?: string;
          vanityName?: string;
        }>(`${LINKEDIN_API_V2}/organizations/${encodeURIComponent(id)}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        summaries.push({
          id,
          urn: `urn:li:organization:${id}`,
          name: org.localizedName || `LinkedIn Page (${id})`,
          vanityName: org.vanityName ?? null,
          logoUrl: null,
          role: 'ADMINISTRATOR',
        });
      } catch {
        summaries.push({
          id,
          urn: `urn:li:organization:${id}`,
          name: `LinkedIn Page (${id})`,
          role: 'ADMINISTRATOR',
        });
      }
    }

    return summaries;
  } catch {
    return [];
  }
}

/**
 * Verifies a LinkedIn Access Token via OpenID `/v2/userinfo` (or `/v2/me` fallback)
 * and discovers managed Company Pages if Community Management scopes are granted.
 */
export async function verifyLinkedInToken(
  rawToken: string,
  options?: { organizationId?: string | null; grantedScopes?: string[] },
): Promise<LinkedInProfileMeta> {
  const cleanToken = validateLinkedInTokenShape(rawToken);
  const explicitOrgId = normalizeOrganizationId(options?.organizationId);

  let memberId = '';
  let displayName = '';
  let email: string | null = null;
  let profilePictureUrl: string | null = null;
  let userinfoErr: unknown = null;

  // 1. Try OpenID Connect userinfo (standard for openid + profile + email)
  try {
    const info = await liFetchJson<{
      sub?: string;
      name?: string;
      given_name?: string;
      family_name?: string;
      email?: string;
      picture?: string;
    }>(`${LINKEDIN_API_V2}/userinfo`, {
      headers: { Authorization: `Bearer ${cleanToken}` },
    });

    if (info.sub) {
      memberId = info.sub;
      displayName =
        info.name ||
        [info.given_name, info.family_name].filter(Boolean).join(' ') ||
        'LinkedIn Member';
      email = info.email ?? null;
      profilePictureUrl = info.picture ?? null;
    }
  } catch (err) {
    userinfoErr = err;
  }

  // 2. Fallback to legacy /v2/me (r_liteprofile / r_basicprofile)
  if (!memberId) {
    try {
      const me = await liFetchJson<{
        id?: string;
        localizedFirstName?: string;
        localizedLastName?: string;
        localizedHeadline?: string;
      }>(`${LINKEDIN_API_V2}/me`, {
        headers: { Authorization: `Bearer ${cleanToken}` },
      });
      if (me.id) {
        memberId = me.id;
        displayName =
          [me.localizedFirstName, me.localizedLastName].filter(Boolean).join(' ') ||
          'LinkedIn Member';
      }
    } catch (meErr) {
      if (!explicitOrgId) {
        throw meErr instanceof LinkedInApiError
          ? meErr
          : userinfoErr instanceof LinkedInApiError
            ? userinfoErr
            : new LinkedInApiError('Could not verify LinkedIn Access Token.', 401);
      }
    }
  }

  const memberUrn = memberId ? `urn:li:person:${memberId}` : null;
  const organizations = await fetchLinkedInOrganizations(cleanToken);

  if (explicitOrgId) {
    const matchedOrg = organizations.find((o) => o.id === explicitOrgId);
    let orgName = matchedOrg?.name || '';
    let orgVanity = matchedOrg?.vanityName ?? null;
    if (!orgName) {
      try {
        const org = await liFetchJson<{ localizedName?: string; vanityName?: string }>(
          `${LINKEDIN_API_V2}/organizations/${encodeURIComponent(explicitOrgId)}`,
          { headers: { Authorization: `Bearer ${cleanToken}` } },
        );
        orgName = org.localizedName || `LinkedIn Page (${explicitOrgId})`;
        orgVanity = org.vanityName ?? null;
      } catch (orgErr) {
        if (!memberUrn) {
          throw orgErr;
        }
        orgName = `LinkedIn Page (${explicitOrgId})`;
      }
    }

    return {
      accountType: 'organization',
      memberUrn,
      organizationId: explicitOrgId,
      organizationUrn: `urn:li:organization:${explicitOrgId}`,
      displayName: orgName,
      email,
      vanityName: orgVanity,
      profilePictureUrl,
      organizations: matchedOrg
        ? organizations
        : [
            {
              id: explicitOrgId,
              urn: `urn:li:organization:${explicitOrgId}`,
              name: orgName,
              vanityName: orgVanity,
            },
            ...organizations,
          ],
      grantedScopes: options?.grantedScopes ?? [],
    };
  }

  if (!memberUrn && organizations.length === 0) {
    throw new LinkedInApiError(
      'Unable to resolve a LinkedIn Profile or Company Page from this token. Ensure openid/profile or organization scopes are enabled.',
      400,
    );
  }

  return {
    accountType: memberUrn ? 'person' : 'organization',
    memberUrn,
    organizationId: organizations[0]?.id ?? null,
    organizationUrn: organizations[0]?.urn ?? null,
    displayName: displayName || organizations[0]?.name || 'LinkedIn Account',
    email,
    vanityName: organizations[0]?.vanityName ?? null,
    profilePictureUrl,
    organizations,
    grantedScopes: options?.grantedScopes ?? [],
  };
}

/**
 * Registers & uploads an image URL to LinkedIn Images API (`/rest/images`).
 */
async function uploadLinkedInImageFromUrl(
  accessToken: string,
  ownerUrn: string,
  imageUrl: string,
): Promise<string> {
  const imgRes = await fetch(imageUrl, { cache: 'no-store' });
  if (!imgRes.ok) {
    throw new LinkedInApiError(`Failed to fetch image from ${imageUrl}`, 400);
  }
  const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
  const bytes = Buffer.from(await imgRes.arrayBuffer());

  const init = await liFetchJson<{
    value?: { uploadUrl?: string; image?: string };
  }>(`${LINKEDIN_API_REST}/images?action=initializeUpload`, {
    method: 'POST',
    headers: buildRestHeaders(accessToken, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ initializeUploadRequest: { owner: ownerUrn } }),
  });

  const uploadUrl = init.value?.uploadUrl;
  const imageUrn = init.value?.image;
  if (!uploadUrl || !imageUrn) {
    throw new LinkedInApiError('LinkedIn image upload initialization failed.', 502);
  }

  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': contentType,
    },
    body: bytes,
  });

  if (!putRes.ok) {
    throw new LinkedInApiError(`LinkedIn binary image upload failed (${putRes.status}).`, 502);
  }

  return imageUrn;
}

/**
 * Publishes a text, article-link, or image post via `/rest/posts`, falling back
 * to `/v2/ugcPosts` if a token only supports legacy Sharing API scopes.
 */
export async function publishLinkedInPost(params: {
  accessToken: string;
  authorUrn: string;
  text: string;
  visibility?: 'PUBLIC' | 'CONNECTIONS';
  articleUrl?: string;
  articleTitle?: string;
  articleDescription?: string;
  imageUrl?: string;
}): Promise<{ postUrn: string }> {
  const {
    accessToken,
    authorUrn,
    text,
    visibility = 'PUBLIC',
    articleUrl,
    articleTitle,
    articleDescription,
    imageUrl,
  } = params;

  let uploadedImageUrn: string | undefined;
  if (imageUrl?.trim()) {
    uploadedImageUrn = await uploadLinkedInImageFromUrl(
      accessToken,
      authorUrn,
      imageUrl.trim(),
    );
  }

  const restBody: Record<string, unknown> = {
    author: authorUrn,
    commentary: text,
    visibility,
    distribution: {
      feedDistribution: 'MAIN_FEED',
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: 'PUBLISHED',
    isReshareDisabledByAuthor: false,
  };

  if (uploadedImageUrn) {
    restBody.content = {
      media: {
        id: uploadedImageUrn,
        title: articleTitle?.trim() || 'LinkedIn Post Image',
      },
    };
  } else if (articleUrl?.trim()) {
    restBody.content = {
      article: {
        source: articleUrl.trim(),
        title: articleTitle?.trim() || articleUrl.trim(),
        description: articleDescription?.trim() || undefined,
      },
    };
  }

  const res = await fetch(`${LINKEDIN_API_REST}/posts`, {
    method: 'POST',
    headers: buildRestHeaders(accessToken, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(restBody),
    cache: 'no-store',
  });

  const restId = res.headers.get('x-restli-id');
  if (res.ok) {
    const json = (await res.json().catch(() => ({}))) as { id?: string };
    return { postUrn: restId || json.id || `urn:li:share:${Date.now()}` };
  }

  const errPayload = (await res.json().catch(() => ({}))) as { message?: string };

  // Fallback to /v2/ugcPosts for apps using Share on LinkedIn without versioned /rest/posts access
  if (!uploadedImageUrn && (res.status === 400 || res.status === 403 || res.status === 404 || res.status === 426)) {
    const ugcBody: Record<string, unknown> = {
      author: authorUrn,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': articleUrl?.trim()
          ? {
              shareCommentary: { text },
              shareMediaCategory: 'ARTICLE',
              media: [
                {
                  status: 'READY',
                  originalUrl: articleUrl.trim(),
                  title: { text: articleTitle?.trim() || articleUrl.trim() },
                  description: articleDescription?.trim()
                    ? { text: articleDescription.trim() }
                    : undefined,
                },
              ],
            }
          : {
              shareCommentary: { text },
              shareMediaCategory: 'NONE',
            },
      },
      visibility: {
        'com.linkedin.ugc.MemberNetworkVisibility': visibility,
      },
    };

    const ugcRes = await liFetchJson<{ id?: string }>(`${LINKEDIN_API_V2}/ugcPosts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0',
      },
      body: JSON.stringify(ugcBody),
    });

    if (ugcRes.id) {
      return { postUrn: ugcRes.id };
    }
  }

  throw new LinkedInApiError(
    errPayload.message || `Failed to publish LinkedIn post (${res.status}).`,
    res.status,
  );
}

/**
 * Fetches recent posts authored by a LinkedIn Person or Organization URN.
 */
export async function fetchLinkedInPosts(
  accessToken: string,
  authorUrn: string,
  count = 15,
): Promise<LinkedInPostItem[]> {
  try {
    const data = await liFetchJson<{
      elements?: Array<{
        id?: string;
        author?: string;
        commentary?: string;
        visibility?: string;
        lifecycleState?: string;
        createdAt?: number;
        content?: {
          article?: { source?: string; title?: string };
          media?: { id?: string };
        };
      }>;
    }>(
      `${LINKEDIN_API_REST}/posts?author=${encodeURIComponent(authorUrn)}&q=author&count=${count}`,
      { headers: buildRestHeaders(accessToken) },
    );

    return (data.elements ?? []).map((p) => ({
      urn: p.id || '',
      authorUrn: p.author || authorUrn,
      text: p.commentary || '',
      visibility: p.visibility || 'PUBLIC',
      lifecycleState: p.lifecycleState || 'PUBLISHED',
      createdAt: typeof p.createdAt === 'number' ? new Date(p.createdAt).toISOString() : null,
      articleUrl: p.content?.article?.source ?? null,
      articleTitle: p.content?.article?.title ?? null,
      mediaUrn: p.content?.media?.id ?? null,
    }));
  } catch (err) {
    // Throw so the UI can explain whether Community Management / read permissions are needed
    throw err instanceof LinkedInApiError
      ? err
      : new LinkedInApiError('Could not load LinkedIn posts.');
  }
}

export async function deleteLinkedInPost(
  accessToken: string,
  postUrn: string,
): Promise<void> {
  await liFetchJson(
    `${LINKEDIN_API_REST}/posts/${encodeURIComponent(postUrn)}`,
    {
      method: 'DELETE',
      headers: buildRestHeaders(accessToken),
    },
  );
}

export async function fetchLinkedInComments(
  accessToken: string,
  postUrn: string,
): Promise<LinkedInCommentItem[]> {
  const data = await liFetchJson<{
    elements?: Array<{
      id?: string;
      commentUrn?: string;
      actor?: string;
      message?: { text?: string };
      created?: { time?: number };
    }>;
  }>(
    `${LINKEDIN_API_REST}/socialActions/${encodeURIComponent(postUrn)}/comments?count=25`,
    { headers: buildRestHeaders(accessToken) },
  );

  return (data.elements ?? []).map((c) => ({
    id: c.id || c.commentUrn || '',
    urn: c.commentUrn || c.id || '',
    actorUrn: c.actor || '',
    text: c.message?.text || '',
    createdAt:
      typeof c.created?.time === 'number'
        ? new Date(c.created.time).toISOString()
        : null,
  }));
}

export async function replyToLinkedInComment(params: {
  accessToken: string;
  postUrn: string;
  actorUrn: string;
  text: string;
  parentCommentUrn?: string;
}): Promise<{ commentUrn: string }> {
  const body: Record<string, unknown> = {
    actor: params.actorUrn,
    object: params.postUrn,
    message: { text: params.text },
  };
  if (params.parentCommentUrn) {
    body.parentComment = params.parentCommentUrn;
  }

  const data = await liFetchJson<{ id?: string; commentUrn?: string }>(
    `${LINKEDIN_API_REST}/socialActions/${encodeURIComponent(params.postUrn)}/comments`,
    {
      method: 'POST',
      headers: buildRestHeaders(params.accessToken, { 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    },
  );

  return { commentUrn: data.commentUrn || data.id || `comment:${Date.now()}` };
}

export async function fetchOrganizationAnalytics(
  accessToken: string,
  organizationId: string,
): Promise<LinkedInAnalyticsSummary> {
  const orgUrn = `urn:li:organization:${normalizeOrganizationId(organizationId) || organizationId}`;

  const [networkRes, statsRes] = await Promise.all([
    liFetchJson<{ firstDegreeSize?: number }>(
      `${LINKEDIN_API_V2}/networkSizes/${encodeURIComponent(orgUrn)}?edgeType=CompanyFollowedByMember`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    ).catch(() => ({ firstDegreeSize: null })),
    liFetchJson<{
      elements?: Array<{
        totalShareStatistics?: {
          impressionCount?: number;
          uniqueImpressionsCount?: number;
          clickCount?: number;
          likeCount?: number;
          commentCount?: number;
          shareCount?: number;
          engagement?: number;
        };
      }>;
    }>(
      `${LINKEDIN_API_V2}/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=${encodeURIComponent(orgUrn)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    ),
  ]);

  const s = statsRes.elements?.[0]?.totalShareStatistics;
  return {
    organizationUrn: orgUrn,
    followerCount:
      typeof networkRes.firstDegreeSize === 'number' ? networkRes.firstDegreeSize : null,
    impressionCount: typeof s?.impressionCount === 'number' ? s.impressionCount : null,
    uniqueImpressionsCount:
      typeof s?.uniqueImpressionsCount === 'number' ? s.uniqueImpressionsCount : null,
    clickCount: typeof s?.clickCount === 'number' ? s.clickCount : null,
    likeCount: typeof s?.likeCount === 'number' ? s.likeCount : null,
    commentCount: typeof s?.commentCount === 'number' ? s.commentCount : null,
    shareCount: typeof s?.shareCount === 'number' ? s.shareCount : null,
    engagementRate: typeof s?.engagement === 'number' ? s.engagement : null,
  };
}

/**
 * Pulls Lead Gen Form submissions via LinkedIn Lead Sync API (`/rest/leadFormResponses`)
 * when an organization owner holds `r_marketing_leadgen_automation` / Lead Sync approval.
 */
export async function fetchLinkedInLeadSubmissions(
  accessToken: string,
  organizationId: string,
  count = 25,
): Promise<LinkedInLeadSubmission[]> {
  const cleanId = normalizeOrganizationId(organizationId) || organizationId;
  const ownerParam = `(sponsoredAccount:urn:li:organization:${cleanId})`;

  const res = await liFetchJson<{
    elements?: Array<{
      id?: string;
      submittedAt?: number;
      associatedEntity?: string;
      owner?: { sponsoredAccount?: string };
      formResponse?: {
        answers?: Array<{
          questionId?: number;
          answerDetails?: {
            textQuestionAnswer?: { answer?: string };
          };
          name?: string;
        }>;
      };
    }>;
  }>(
    `${LINKEDIN_API_REST}/leadFormResponses?q=owner&owner=${encodeURIComponent(ownerParam)}&leadType=COMPANY&count=${count}`,
    { headers: buildRestHeaders(accessToken) },
  );

  return (res.elements ?? []).map((item) => {
    const answers = item.formResponse?.answers ?? [];
    const byHint = (pattern: RegExp): string | null => {
      const hit = answers.find((a) => pattern.test(a.name || ''));
      return hit?.answerDetails?.textQuestionAnswer?.answer?.trim() || null;
    };

    const first = byHint(/first/i);
    const last = byHint(/last/i);
    const fullName =
      byHint(/full.?name|^name$/i) ||
      [first, last].filter(Boolean).join(' ') ||
      'LinkedIn Lead';

    return {
      externalId: item.id || `li_lead_${Date.now()}`,
      name: fullName,
      email: byHint(/email/i),
      phone: byHint(/phone|mobile/i),
      company: byHint(/company|organization/i),
      jobTitle: byHint(/title|role/i),
      formName: item.associatedEntity ?? 'LinkedIn Lead Form',
      linkedinUrn: item.id ? `urn:li:leadFormResponse:${item.id}` : null,
      submittedAt:
        typeof item.submittedAt === 'number'
          ? new Date(item.submittedAt).toISOString()
          : null,
    };
  });
}

/**
 * LinkedIn Webhook Challenge validation:
 * HMAC-SHA256 hex digest of `challengeCode` keyed by Client Secret.
 */
export function computeLinkedInChallengeResponse(
  challengeCode: string,
  secret: string,
): string {
  return crypto
    .createHmac('sha256', secret)
    .update(challengeCode, 'utf8')
    .digest('hex');
}

/**
 * Verifies LinkedIn `X-LI-Signature` (`hmacsha256=<hex>`) header using constant-time comparison.
 */
export function verifyLinkedInWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!signatureHeader || !secret) return false;
  const cleaned = signatureHeader.replace(/^hmacsha256=/i, '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(cleaned)) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody, 'utf8')
    .digest('hex');

  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(cleaned, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

