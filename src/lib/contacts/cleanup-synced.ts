import type { SupabaseClient } from '@supabase/supabase-js';

export interface CleanupResult {
  deletedCount: number;
  keptCount: number;
  totalBefore: number;
}

/**
 * Automatically cleans up un-used, passively synced WhatsApp contacts for a project
 * while strictly preserving:
 * 1. All imported contacts (CSV/Excel) or contacts with email / company.
 * 2. All contacts that have had active messaging in the CRM (messages where sender_type = 'agent').
 * 3. All contacts assigned to an agent (conversations.assigned_agent_id IS NOT NULL).
 * 4. All contacts with tags, deals, notes, or broadcast campaigns.
 * 5. All non-WhatsApp contacts (Instagram, Facebook, Email).
 */
export async function cleanupSyncedWhatsAppContacts(
  db: SupabaseClient,
  projectId: string,
): Promise<CleanupResult> {
  if (!projectId) {
    return { deletedCount: 0, keptCount: 0, totalBefore: 0 };
  }

  // 1. Fetch all contacts belonging to this project (paginated to handle large datasets)
  let allContacts: Array<{
    id: string;
    name: string | null;
    phone: string;
    email: string | null;
    company: string | null;
    channel: string | null;
    instagram_id?: string | null;
  }> = [];

  const PAGE_SIZE = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await db
      .from('contacts')
      .select('id, name, phone, email, company, channel, instagram_id')
      .eq('project_id', projectId)
      .range(from, from + PAGE_SIZE - 1);

    if (error || !data || data.length === 0) break;
    allContacts = allContacts.concat(data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  const totalBefore = allContacts.length;
  if (totalBefore === 0) {
    return { deletedCount: 0, keptCount: 0, totalBefore: 0 };
  }

  // 2. Resolve all conversations for this project to map conversation_id -> contact_id
  let allConvs: Array<{ id: string; contact_id: string; assigned_agent_id: string | null }> = [];
  from = 0;
  while (true) {
    const { data, error } = await db
      .from('conversations')
      .select('id, contact_id, assigned_agent_id')
      .eq('project_id', projectId)
      .range(from, from + PAGE_SIZE - 1);

    if (error || !data || data.length === 0) break;
    allConvs = allConvs.concat(data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  const convToContact = new Map<string, string>();
  const keepContactIds = new Set<string>();

  for (const c of allConvs) {
    convToContact.set(c.id, c.contact_id);
    // Keep any contact whose conversation is assigned to an agent
    if (c.assigned_agent_id) {
      keepContactIds.add(c.contact_id);
    }
  }

  // 3. Find conversations with messages sent from CRM by agents/admins (paginated)
  let agentFrom = 0;
  while (true) {
    const { data: agentMsgs, error } = await db
      .from('messages')
      .select('conversation_id')
      .eq('project_id', projectId)
      .eq('sender_type', 'agent')
      .range(agentFrom, agentFrom + PAGE_SIZE - 1);

    if (error || !agentMsgs || agentMsgs.length === 0) break;
    for (const m of agentMsgs) {
      const cid = convToContact.get(m.conversation_id);
      if (cid) keepContactIds.add(cid);
    }
    if (agentMsgs.length < PAGE_SIZE) break;
    agentFrom += PAGE_SIZE;
  }

  // 3b. Preserve conversations with active reminders
  const { data: reminders } = await db
    .from('conversation_reminders')
    .select('conversation_id')
    .eq('project_id', projectId);
  if (reminders) {
    for (const r of reminders) {
      const cid = convToContact.get(r.conversation_id);
      if (cid) keepContactIds.add(cid);
    }
  }

  // 4. Preserve contacts with tags
  const { data: tags } = await db.from('contact_tags').select('contact_id');
  if (tags) {
    for (const t of tags) {
      keepContactIds.add(t.contact_id);
    }
  }

  // 5. Preserve contacts with meaningful deals (deals with notes, value > 0, or won/lost status)
  const { data: deals } = await db
    .from('deals')
    .select('contact_id, value, status, notes')
    .eq('project_id', projectId);
  if (deals) {
    for (const d of deals) {
      if (d.contact_id && (d.value > 0 || d.status === 'won' || d.status === 'lost' || d.notes)) {
        keepContactIds.add(d.contact_id);
      }
    }
  }

  // 6. Preserve contacts targeted in broadcasts
  const { data: bRecipients } = await db
    .from('broadcast_recipients')
    .select('contact_id');
  if (bRecipients) {
    for (const b of bRecipients) {
      if (b.contact_id) keepContactIds.add(b.contact_id);
    }
  }

  // 7. Segregate into toKeep and toDelete
  const toDeleteIds: string[] = [];
  let keptCount = 0;

  for (const contact of allContacts) {
    const digits = contact.phone ? contact.phone.replace(/\D/g, '') : '';
    const isMaskedLid = digits.length > 13 && !contact.name;
    // Preserve imported / manual contacts (have email or company)
    const isImportedOrManual = Boolean(contact.email || contact.company);
    // Preserve non-WhatsApp contacts (e.g. Instagram, Facebook, Email)
    const isNonWhatsApp = Boolean(contact.channel && contact.channel !== 'whatsapp');
    const isInstagram = Boolean(contact.instagram_id);
    // Preserve contacts interacted with in CRM
    const hasInteraction = keepContactIds.has(contact.id);

    if (!isMaskedLid && (isImportedOrManual || isNonWhatsApp || isInstagram || hasInteraction)) {
      keptCount++;
    } else {
      toDeleteIds.push(contact.id);
    }
  }

  // 8. Batch delete un-used contacts in chunks of 100
  const DELETE_CHUNK_SIZE = 100;
  let deletedCount = 0;

  for (let i = 0; i < toDeleteIds.length; i += DELETE_CHUNK_SIZE) {
    const chunk = toDeleteIds.slice(i, i + DELETE_CHUNK_SIZE);
    
    // Clean up dependent tables first
    await db.from('deals').delete().in('contact_id', chunk);
    await db.from('conversations').delete().in('contact_id', chunk);

    const { error: delErr } = await db
      .from('contacts')
      .delete()
      .in('id', chunk);

    if (delErr) {
      console.error('[cleanupSyncedWhatsAppContacts] delete chunk error:', delErr);
    } else {
      deletedCount += chunk.length;
    }
  }

  console.log(
    `[cleanupSyncedWhatsAppContacts] Project ${projectId}: Deleted ${deletedCount} un-used contacts, preserved ${keptCount} active/imported contacts.`,
  );

  return {
    deletedCount,
    keptCount,
    totalBefore,
  };
}
