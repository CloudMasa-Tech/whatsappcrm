import { randomUUID } from 'node:crypto';
import type { supabaseAdmin } from '@/lib/supabase/admin';
import { EMAIL_REGEX, type ParsedRecipient } from './campaign-helpers';

export type AdminClient = ReturnType<typeof supabaseAdmin>;

export interface ResolvedAudienceRow {
  email: string;
  name: string | null;
  contact_id: string | null;
}

export interface ProjectEmailContact {
  id: string;
  email: string;
  name: string | null;
}

/**
 * Loads deduplicated CRM contacts that have a valid email address,
 * scoped to the tenant account (and optional active project).
 */
export async function loadProjectEmailContacts(
  db: AdminClient,
  accountId: string,
  projectId: string | null,
): Promise<ProjectEmailContact[]> {
  let query = db
    .from('contacts')
    .select('id, name, email')
    .eq('account_id', accountId)
    .not('email', 'is', null)
    .order('name', { ascending: true });

  if (projectId) {
    query = query.eq('project_id', projectId);
  }

  const { data } = await query;
  const seen = new Set<string>();
  const result: ProjectEmailContact[] = [];

  for (const row of data ?? []) {
    if (typeof row.email !== 'string') continue;
    const normalized = row.email.trim().toLowerCase();
    if (!EMAIL_REGEX.test(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push({
      id: row.id,
      email: normalized,
      name: row.name?.trim() || null,
    });
  }

  return result;
}

/**
 * Resolves manually entered emails, selected contact IDs, or full project audience
 * into normalized recipient records enriched with matching CRM contact metadata.
 */
export async function resolveAudienceRecipients(
  db: AdminClient,
  params: {
    accountId: string;
    projectId: string | null;
    parsedRecipients?: ParsedRecipient[];
    contactIds?: string[];
    useAllContacts?: boolean;
  },
): Promise<ResolvedAudienceRow[]> {
  const projectContacts = await loadProjectEmailContacts(
    db,
    params.accountId,
    params.projectId,
  );

  const byEmail = new Map<string, ProjectEmailContact>();
  const byId = new Map<string, ProjectEmailContact>();
  for (const contact of projectContacts) {
    byEmail.set(contact.email, contact);
    byId.set(contact.id, contact);
  }

  const merged = new Map<string, ResolvedAudienceRow>();

  const addCandidate = (row: ResolvedAudienceRow) => {
    const existing = merged.get(row.email);
    if (!existing) {
      merged.set(row.email, row);
      return;
    }
    if (!existing.name && row.name) existing.name = row.name;
    if (!existing.contact_id && row.contact_id) existing.contact_id = row.contact_id;
  };

  for (const parsed of params.parsedRecipients ?? []) {
    const contact = byEmail.get(parsed.email);
    addCandidate({
      email: parsed.email,
      name: contact?.name || parsed.name || null,
      contact_id: contact?.id ?? null,
    });
  }

  for (const cid of params.contactIds ?? []) {
    const contact = byId.get(cid);
    if (contact) {
      addCandidate({
        email: contact.email,
        name: contact.name,
        contact_id: contact.id,
      });
    }
  }

  if (params.useAllContacts) {
    for (const contact of projectContacts) {
      addCandidate({
        email: contact.email,
        name: contact.name,
        contact_id: contact.id,
      });
    }
  }

  return Array.from(merged.values());
}

/**
 * Appends recipients as `pending` rows to a campaign while preventing duplicate
 * queued sends and optionally skipping addresses that already received it.
 */
export async function insertCampaignRecipients(
  db: AdminClient,
  params: {
    campaignId: string;
    candidates: ResolvedAudienceRow[];
    allowResendExisting?: boolean;
  },
): Promise<{
  addedCount: number;
  skippedAlreadySent: number;
  skippedPending: number;
  totalRecipients: number;
  error?: string;
}> {
  const { data: existingRows, error: fetchErr } = await db
    .from('email_campaign_recipients')
    .select('email, status')
    .eq('campaign_id', params.campaignId);

  if (fetchErr) {
    return {
      addedCount: 0,
      skippedAlreadySent: 0,
      skippedPending: 0,
      totalRecipients: 0,
      error: fetchErr.message,
    };
  }

  const pendingEmails = new Set<string>();
  const existingEmails = new Set<string>();

  for (const row of existingRows ?? []) {
    if (typeof row.email !== 'string') continue;
    const normalized = row.email.trim().toLowerCase();
    existingEmails.add(normalized);
    if (row.status === 'pending') {
      pendingEmails.add(normalized);
    }
  }

  const toInsert: ResolvedAudienceRow[] = [];
  let skippedPending = 0;
  let skippedAlreadySent = 0;

  for (const candidate of params.candidates) {
    if (pendingEmails.has(candidate.email)) {
      skippedPending += 1;
      continue;
    }
    if (!params.allowResendExisting && existingEmails.has(candidate.email)) {
      skippedAlreadySent += 1;
      continue;
    }
    pendingEmails.add(candidate.email);
    toInsert.push(candidate);
  }

  if (toInsert.length > 0) {
    const withTokens = toInsert.map((a) => ({
      campaign_id: params.campaignId,
      contact_id: a.contact_id,
      email: a.email,
      name: a.name,
      status: 'pending',
      tracking_token: randomUUID().replace(/-/g, ''),
    }));

    let { error: insertErr } = await db
      .from('email_campaign_recipients')
      .insert(withTokens);

    if (
      insertErr &&
      (insertErr.message?.includes('tracking_token') ||
        insertErr.message?.includes("Could not find the '"))
    ) {
      const retry = await db.from('email_campaign_recipients').insert(
        toInsert.map((a) => ({
          campaign_id: params.campaignId,
          contact_id: a.contact_id,
          email: a.email,
          name: a.name,
          status: 'pending',
        })),
      );
      insertErr = retry.error;
    }

    if (insertErr) {
      return {
        addedCount: 0,
        skippedAlreadySent,
        skippedPending,
        totalRecipients: existingRows?.length ?? 0,
        error: insertErr.message,
      };
    }
  }

  const { count } = await db
    .from('email_campaign_recipients')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', params.campaignId);

  const totalRecipients =
    typeof count === 'number'
      ? count
      : (existingRows?.length ?? 0) + toInsert.length;

  await db
    .from('email_campaigns')
    .update({ total_recipients: totalRecipients, updated_at: new Date().toISOString() })
    .eq('id', params.campaignId);

  return {
    addedCount: toInsert.length,
    skippedAlreadySent,
    skippedPending,
    totalRecipients,
  };
}

