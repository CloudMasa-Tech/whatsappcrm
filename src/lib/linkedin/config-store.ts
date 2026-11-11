import { decrypt, encrypt } from '@/lib/whatsapp/encryption';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { runAutomationsForTrigger } from '@/lib/automations/engine';
import type { ProjectContext } from '@/lib/auth/project';
import type {
  LinkedInConfigSafeRow,
  LinkedInConnectionMethod,
  LinkedInLeadSubmission,
  LinkedInProfileMeta,
} from './types';

export interface DecryptedLinkedInConfig {
  id: string;
  accountId: string;
  projectId: string;
  userId: string;
  connectionMethod: LinkedInConnectionMethod;
  accountType: 'person' | 'organization';
  memberUrn: string | null;
  organizationId: string | null;
  organizationUrn: string | null;
  displayName: string | null;
  profilePictureUrl: string | null;
  grantedScopes: string[];
  accessToken: string;
  authorUrn: string;
  clientId: string | null;
  clientSecret: string | null;
}

export function toSafeLinkedInConfig(row: Record<string, unknown> | null): LinkedInConfigSafeRow {
  if (!row) {
    return {
      connection_method: 'token',
      account_type: 'person',
      member_urn: null,
      organization_id: null,
      organization_urn: null,
      display_name: null,
      headline: null,
      vanity_name: null,
      profile_picture_url: null,
      granted_scopes: [],
      client_id: null,
      has_access_token: false,
      has_refresh_token: false,
      has_client_secret: false,
      token_expires_at: null,
      status: 'disconnected',
      last_error: null,
      connected_at: null,
      last_synced_at: null,
    };
  }

  return {
    id: String(row.id),
    connection_method: row.connection_method === 'oauth' ? 'oauth' : 'token',
    account_type: row.account_type === 'organization' ? 'organization' : 'person',
    member_urn: (row.member_urn as string | null) ?? null,
    organization_id: (row.organization_id as string | null) ?? null,
    organization_urn: (row.organization_urn as string | null) ?? null,
    display_name: (row.display_name as string | null) ?? null,
    headline: (row.headline as string | null) ?? null,
    vanity_name: (row.vanity_name as string | null) ?? null,
    profile_picture_url: (row.profile_picture_url as string | null) ?? null,
    granted_scopes: Array.isArray(row.granted_scopes)
      ? (row.granted_scopes as string[])
      : [],
    client_id: (row.client_id as string | null) ?? null,
    has_access_token: Boolean(row.access_token),
    has_refresh_token: Boolean(row.refresh_token),
    has_client_secret: Boolean(row.client_secret),
    token_expires_at: (row.token_expires_at as string | null) ?? null,
    status:
      row.status === 'connected' || row.status === 'error' ? row.status : 'disconnected',
    last_error: (row.last_error as string | null) ?? null,
    connected_at: (row.connected_at as string | null) ?? null,
    last_synced_at: (row.last_synced_at as string | null) ?? null,
  };
}

export async function loadActiveLinkedInConfig(
  projectId: string,
): Promise<DecryptedLinkedInConfig | null> {
  const { data: row } = await supabaseAdmin()
    .from('linkedin_config')
    .select('*')
    .eq('project_id', projectId)
    .eq('status', 'connected')
    .maybeSingle();

  if (!row || !row.access_token) return null;

  let accessToken: string;
  try {
    accessToken = decrypt(row.access_token);
  } catch {
    return null;
  }

  let clientSecret: string | null = null;
  if (row.client_secret) {
    try {
      clientSecret = decrypt(row.client_secret);
    } catch {
      clientSecret = null;
    }
  }

  const accountType =
    row.account_type === 'organization' && row.organization_urn
      ? 'organization'
      : 'person';
  const authorUrn =
    (accountType === 'organization' ? row.organization_urn : row.member_urn) ||
    row.organization_urn ||
    row.member_urn ||
    '';

  if (!authorUrn) return null;

  return {
    id: row.id,
    accountId: row.account_id,
    projectId: row.project_id,
    userId: row.user_id,
    connectionMethod: row.connection_method === 'oauth' ? 'oauth' : 'token',
    accountType,
    memberUrn: row.member_urn ?? null,
    organizationId: row.organization_id ?? null,
    organizationUrn: row.organization_urn ?? null,
    displayName: row.display_name ?? null,
    profilePictureUrl: row.profile_picture_url ?? null,
    grantedScopes: Array.isArray(row.granted_scopes) ? row.granted_scopes : [],
    accessToken,
    authorUrn,
    clientId: row.client_id ?? null,
    clientSecret,
  };
}

export async function saveLinkedInConfig(params: {
  ctx: ProjectContext;
  connectionMethod: LinkedInConnectionMethod;
  profile: LinkedInProfileMeta;
  accessToken: string;
  refreshToken?: string | null;
  expiresInSeconds?: number | null;
  clientId?: string | null;
  clientSecret?: string | null;
  verifyToken?: string | null;
}) {
  const now = new Date();
  const payload: Record<string, unknown> = {
    account_id: params.ctx.accountId,
    project_id: params.ctx.projectId,
    user_id: params.ctx.userId,
    connection_method: params.connectionMethod,
    account_type: params.profile.accountType,
    member_urn: params.profile.memberUrn,
    organization_id: params.profile.organizationId,
    organization_urn: params.profile.organizationUrn,
    display_name: params.profile.displayName,
    headline: params.profile.headline ?? null,
    vanity_name: params.profile.vanityName ?? null,
    profile_picture_url: params.profile.profilePictureUrl,
    access_token: encrypt(params.accessToken),
    granted_scopes: params.profile.grantedScopes ?? [],
    status: 'connected',
    last_error: null,
    connected_at: now.toISOString(),
    last_synced_at: now.toISOString(),
    updated_at: now.toISOString(),
  };

  if (params.refreshToken?.trim()) {
    payload.refresh_token = encrypt(params.refreshToken.trim());
  }
  if (typeof params.expiresInSeconds === 'number' && params.expiresInSeconds > 0) {
    payload.token_expires_at = new Date(
      now.getTime() + params.expiresInSeconds * 1000,
    ).toISOString();
  }
  if (params.clientId?.trim()) {
    payload.client_id = params.clientId.trim();
  }
  if (params.clientSecret?.trim()) {
    payload.client_secret = encrypt(params.clientSecret.trim());
  }
  if (params.verifyToken?.trim()) {
    payload.verify_token = encrypt(params.verifyToken.trim());
  } else {
    payload.verify_token = encrypt(`masacrm_li_${params.ctx.projectId.slice(0, 8)}`);
  }

  return supabaseAdmin()
    .from('linkedin_config')
    .upsert(payload, { onConflict: 'project_id' })
    .select('*')
    .single();
}

/**
 * Deduplicates and saves an inbound LinkedIn Lead Gen submission into CRM `contacts`,
 * firing `new_contact_created` automations when a new lead is inserted.
 */
export async function ingestLinkedInLeadToCrm(params: {
  accountId: string;
  projectId: string;
  ownerUserId: string;
  lead: LinkedInLeadSubmission;
}): Promise<{ contactId: string; created: boolean } | null> {
  const db = supabaseAdmin();
  const { lead } = params;
  const email = lead.email?.trim().toLowerCase() || null;
  const syntheticPhone = `li:${lead.externalId}`;

  if (lead.linkedinUrn) {
    const { data: byUrn } = await db
      .from('contacts')
      .select('id')
      .eq('project_id', params.projectId)
      .eq('linkedin_urn', lead.linkedinUrn)
      .maybeSingle();
    if (byUrn?.id) return { contactId: byUrn.id, created: false };
  }

  if (email) {
    const { data: byEmail } = await db
      .from('contacts')
      .select('id')
      .eq('project_id', params.projectId)
      .ilike('email', email)
      .limit(1)
      .maybeSingle();
    if (byEmail?.id) return { contactId: byEmail.id, created: false };
  }

  const { data: created, error } = await db
    .from('contacts')
    .insert({
      account_id: params.accountId,
      project_id: params.projectId,
      user_id: params.ownerUserId,
      name: lead.name || 'LinkedIn Lead',
      email,
      company: lead.company || null,
      phone: lead.phone?.trim() || syntheticPhone,
      channel: 'linkedin',
      linkedin_urn: lead.linkedinUrn,
    })
    .select('id')
    .single();

  if (error || !created) {
    console.error('[linkedin] failed to create lead contact:', error);
    return null;
  }

  void runAutomationsForTrigger({
    accountId: params.accountId,
    projectId: params.projectId,
    triggerType: 'new_contact_created',
    contactId: created.id,
    context: {
      vars: {
        source: 'linkedin_lead_gen',
        form_name: lead.formName || undefined,
      },
    },
  });

  return { contactId: created.id, created: true };
}
