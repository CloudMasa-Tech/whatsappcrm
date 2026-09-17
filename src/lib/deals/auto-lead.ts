import { SupabaseClient } from '@supabase/supabase-js';

interface EnsureDealOptions {
  contactId: string;
  projectId?: string | null;
  accountId?: string | null;
  userId?: string | null;
  name?: string | null;
  phone?: string | null;
  conversationId?: string | null;
  assignedTo?: string | null;
  title?: string | null;
  value?: number;
}

/**
 * Ensures that a contact has an open Lead/Deal row in the project's default pipeline.
 * If the contact already has a deal in the pipeline, it returns the existing deal ID.
 * Otherwise, it creates a new deal in the first stage (e.g. "Lead").
 */
export async function ensureContactDeal(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  options: EnsureDealOptions,
): Promise<string | null> {
  const {
    contactId,
    projectId,
    accountId,
    userId,
    name,
    phone,
    conversationId,
    assignedTo,
    title,
    value = 0,
  } = options;

  if (!contactId) return null;

  try {
    // 1. Check if a deal already exists for this contact in this project
    let existingQuery = supabase
      .from('deals')
      .select('id, assigned_to')
      .eq('contact_id', contactId);
    if (projectId) {
      existingQuery = existingQuery.eq('project_id', projectId);
    }
    const { data: existingDeal } = await existingQuery.maybeSingle();
    if (existingDeal?.id) {
      // If deal exists but has no assignee and assignedTo is provided, update it
      if (assignedTo && !existingDeal.assigned_to) {
        await supabase
          .from('deals')
          .update({ assigned_to: assignedTo })
          .eq('id', existingDeal.id);
      }
      return existingDeal.id;
    }

    // Resolve assignee if not explicitly passed
    let resolvedAssignee = assignedTo || null;
    if (!resolvedAssignee) {
      let convQuery = supabase
        .from('conversations')
        .select('assigned_agent_id')
        .eq('contact_id', contactId);
      if (projectId) {
        convQuery = convQuery.eq('project_id', projectId);
      }
      const { data: convData } = await convQuery.maybeSingle();
      if (convData?.assigned_agent_id) {
        resolvedAssignee = convData.assigned_agent_id;
      }
    }

    // 2. Fetch the active/default pipeline and its stages
    let pipelineQuery = supabase
      .from('pipelines')
      .select('id, account_id, user_id, stages:pipeline_stages(id, name, position)')
      .order('created_at', { ascending: true });

    if (projectId) {
      pipelineQuery = pipelineQuery.eq('project_id', projectId);
    } else if (accountId) {
      pipelineQuery = pipelineQuery.eq('account_id', accountId);
    }

    const { data: pipelines } = await pipelineQuery;
    let pipeline = pipelines?.[0];

    // If no pipeline exists for this project, try to find any account pipeline or seed one
    if (!pipeline && accountId) {
      const { data: accPipelines } = await supabase
        .from('pipelines')
        .select('id, account_id, user_id, stages:pipeline_stages(id, name, position)')
        .eq('account_id', accountId)
        .order('created_at', { ascending: true });
      pipeline = accPipelines?.[0];
    }

    if (!pipeline) {
      return null;
    }

    // 3. Find the first stage (lowest position, usually "Lead")
    type StageObj = { id: string; name: string; position: number };
    const stages = (pipeline.stages as StageObj[]) ?? [];
    if (stages.length === 0) return null;

    const sortedStages = [...stages].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    const firstStage = sortedStages[0];

    const dealTitle =
      title ||
      name ||
      phone ||
      'New Lead';

    const effectiveUserId = userId || pipeline.user_id;
    const effectiveAccountId = accountId || pipeline.account_id;

    // 4. Insert the new deal
    const { data: newDeal, error: dealError } = await supabase
      .from('deals')
      .insert({
        user_id: effectiveUserId,
        account_id: effectiveAccountId,
        project_id: projectId || null,
        pipeline_id: pipeline.id,
        stage_id: firstStage.id,
        contact_id: contactId,
        conversation_id: conversationId || null,
        assigned_to: resolvedAssignee,
        title: dealTitle,
        value: value,
        currency: 'INR',
        status: 'open',
      })
      .select('id')
      .maybeSingle();

    if (dealError) {
      console.warn('[ensureContactDeal] Failed to create deal:', dealError.message);
      return null;
    }

    return newDeal?.id ?? null;
  } catch (err) {
    console.warn('[ensureContactDeal] Error:', err);
    return null;
  }
}
