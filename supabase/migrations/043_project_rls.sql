-- ============================================================
-- 043_project_rls.sql — move every policy onto is_project_member()
--
-- Third and last of the tenancy split. 041 built the helper, 042 put
-- `project_id` on every row; this migration makes the database
-- actually enforce it.
--
-- The role tiers are unchanged from 017 — this is a change of
-- BOUNDARY, not of permissions:
--
--   viewer  → SELECT
--   agent+  → write on operational data (contacts, conversations,
--             deals, broadcasts, automations, flows, quick replies)
--   admin+  → write on settings-class data (tags, custom fields,
--             pipelines, templates, channel config, API keys,
--             webhooks, AI config + knowledge)
--
-- What changes is which rows a member can reach: previously every row
-- in their ACCOUNT, now only rows in a PROJECT they belong to. For an
-- organisation with a single project (every account after 042's
-- backfill) the two are identical, so this migration is behaviour-
-- preserving on existing data.
--
-- `account_id` stays on every row. It is no longer consulted for
-- isolation — the composite FK in 042 keeps it in agreement with
-- project_id, and org-level features (member management, invitations)
-- still read it.
--
-- Service-role callers bypass RLS entirely, exactly as before. The
-- webhook, the flows/automations engines and the AI reply path
-- therefore have to scope by project_id in application code; the
-- database cannot do it for them.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- CLEAN SLATE
--
-- CREATE POLICY has no IF NOT EXISTS, and the policy names below are
-- the same ones 017 created, so a re-run would hit 42710. Drop
-- everything on the affected tables first — this migration owns the
-- full policy set on all of them.
-- ============================================================
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname, tablename
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = ANY (ARRAY[
        -- project-scoped parents
        'contacts', 'contact_notes', 'conversations', 'deals',
        'broadcasts', 'automations', 'flows', 'quick_replies',
        'tags', 'custom_fields', 'whatsapp_config', 'message_templates',
        'pipelines', 'api_keys', 'webhook_endpoints', 'ai_configs',
        'ai_knowledge_documents', 'ai_knowledge_chunks',
        'automation_logs', 'flow_runs', 'ai_usage_log',
        'automation_pending_executions', 'notifications',
        -- children scoped through a parent
        'contact_tags', 'contact_custom_values', 'messages',
        'pipeline_stages', 'broadcast_recipients', 'automation_steps',
        'flow_nodes', 'flow_run_events', 'message_reactions'
      ])
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, pol.tablename);
  END LOOP;
END $$;

-- ============================================================
-- PARENT TABLES
--
-- Generated rather than spelled out 23 times: the shape is identical
-- for every table, and a loop cannot drift the way 92 hand-written
-- policies can. `write_role` is the only variable.
-- ============================================================
DO $$
DECLARE
  t TEXT;
  write_role TEXT;
  spec RECORD;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      -- operational data: agents may write
      ('contacts',               'agent'),
      ('contact_notes',          'agent'),
      ('conversations',          'agent'),
      ('deals',                  'agent'),
      ('broadcasts',             'agent'),
      ('automations',            'agent'),
      ('flows',                  'agent'),
      ('quick_replies',          'agent'),
      -- settings-class data: admins only
      ('tags',                   'admin'),
      ('custom_fields',          'admin'),
      ('whatsapp_config',        'admin'),
      ('message_templates',      'admin'),
      ('pipelines',              'admin'),
      ('api_keys',               'admin'),
      ('webhook_endpoints',      'admin'),
      ('ai_configs',             'admin'),
      ('ai_knowledge_documents', 'admin'),
      ('ai_knowledge_chunks',    'admin')
    ) AS v(tbl, write_tier)
  LOOP
    t := spec.tbl;
    write_role := spec.write_tier;

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT USING (is_project_member(project_id))',
      t || '_select', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (is_project_member(project_id, %L))',
      t || '_insert', t, write_role);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE USING (is_project_member(project_id, %L)) WITH CHECK (is_project_member(project_id, %L))',
      t || '_update', t, write_role, write_role);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE USING (is_project_member(project_id, %L))',
      t || '_delete', t, write_role);
  END LOOP;
END $$;

-- ============================================================
-- READ-ONLY TABLES (written exclusively by the service role)
-- ============================================================

-- Automation run history.
CREATE POLICY automation_logs_select ON automation_logs
  FOR SELECT USING (is_project_member(project_id));

-- Flow run state. The engine drives these with the service role.
CREATE POLICY flow_runs_select ON flow_runs
  FOR SELECT USING (is_project_member(project_id));

-- AI spend. Admin-only, as in 033 — it is billing-adjacent.
CREATE POLICY ai_usage_log_select ON ai_usage_log
  FOR SELECT USING (is_project_member(project_id, 'admin'));

-- automation_pending_executions deliberately gets NO client policy,
-- matching 017: the cron worker owns this table end to end. RLS stays
-- enabled so a leaked anon key reads nothing.

-- ============================================================
-- NOTIFICATIONS
--
-- Already narrower than tenancy (a notification belongs to one user),
-- but the project check is added anyway: a member removed from a
-- project should stop seeing its notifications immediately, including
-- ones delivered while they still had access.
-- ============================================================
CREATE POLICY notifications_select ON notifications FOR SELECT
  USING (auth.uid() = user_id AND is_project_member(project_id));

CREATE POLICY notifications_update ON notifications FOR UPDATE
  USING (auth.uid() = user_id AND is_project_member(project_id))
  WITH CHECK (auth.uid() = user_id AND is_project_member(project_id));

-- ============================================================
-- CHILD TABLES — scoped through their parent
--
-- These carry no project_id of their own (except `messages`, see
-- below); the parent row is the authority. Same EXISTS shape as 017,
-- retargeted at the parent's project_id.
-- ============================================================

-- ---- contact_tags ----------------------------------------------
CREATE POLICY contact_tags_select ON contact_tags FOR SELECT USING (
  EXISTS (SELECT 1 FROM contacts c
           WHERE c.id = contact_tags.contact_id AND is_project_member(c.project_id))
);
CREATE POLICY contact_tags_modify ON contact_tags FOR ALL USING (
  EXISTS (SELECT 1 FROM contacts c
           WHERE c.id = contact_tags.contact_id AND is_project_member(c.project_id, 'agent'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM contacts c
           WHERE c.id = contact_tags.contact_id AND is_project_member(c.project_id, 'agent'))
);

-- ---- contact_custom_values -------------------------------------
CREATE POLICY contact_custom_values_select ON contact_custom_values FOR SELECT USING (
  EXISTS (SELECT 1 FROM contacts c
           WHERE c.id = contact_custom_values.contact_id AND is_project_member(c.project_id))
);
CREATE POLICY contact_custom_values_modify ON contact_custom_values FOR ALL USING (
  EXISTS (SELECT 1 FROM contacts c
           WHERE c.id = contact_custom_values.contact_id AND is_project_member(c.project_id, 'agent'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM contacts c
           WHERE c.id = contact_custom_values.contact_id AND is_project_member(c.project_id, 'agent'))
);

-- ---- messages ---------------------------------------------------
-- Checks the message's OWN project_id (cheap, and it is the column
-- Realtime filters on) and requires the parent conversation to agree.
-- 042's composite FK already guarantees agreement, so the second
-- clause is defence in depth against a future schema change that
-- drops it.
CREATE POLICY messages_select ON messages FOR SELECT USING (
  is_project_member(project_id)
  AND EXISTS (SELECT 1 FROM conversations c
               WHERE c.id = messages.conversation_id AND c.project_id = messages.project_id)
);
CREATE POLICY messages_modify ON messages FOR ALL USING (
  is_project_member(project_id, 'agent')
) WITH CHECK (
  is_project_member(project_id, 'agent')
  AND EXISTS (SELECT 1 FROM conversations c
               WHERE c.id = messages.conversation_id AND c.project_id = messages.project_id)
);

-- ---- pipeline_stages -------------------------------------------
CREATE POLICY pipeline_stages_select ON pipeline_stages FOR SELECT USING (
  EXISTS (SELECT 1 FROM pipelines p
           WHERE p.id = pipeline_stages.pipeline_id AND is_project_member(p.project_id))
);
CREATE POLICY pipeline_stages_modify ON pipeline_stages FOR ALL USING (
  EXISTS (SELECT 1 FROM pipelines p
           WHERE p.id = pipeline_stages.pipeline_id AND is_project_member(p.project_id, 'admin'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM pipelines p
           WHERE p.id = pipeline_stages.pipeline_id AND is_project_member(p.project_id, 'admin'))
);

-- ---- broadcast_recipients --------------------------------------
CREATE POLICY broadcast_recipients_select ON broadcast_recipients FOR SELECT USING (
  EXISTS (SELECT 1 FROM broadcasts b
           WHERE b.id = broadcast_recipients.broadcast_id AND is_project_member(b.project_id))
);
CREATE POLICY broadcast_recipients_modify ON broadcast_recipients FOR ALL USING (
  EXISTS (SELECT 1 FROM broadcasts b
           WHERE b.id = broadcast_recipients.broadcast_id AND is_project_member(b.project_id, 'agent'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM broadcasts b
           WHERE b.id = broadcast_recipients.broadcast_id AND is_project_member(b.project_id, 'agent'))
);

-- ---- automation_steps ------------------------------------------
CREATE POLICY automation_steps_select ON automation_steps FOR SELECT USING (
  EXISTS (SELECT 1 FROM automations a
           WHERE a.id = automation_steps.automation_id AND is_project_member(a.project_id))
);
CREATE POLICY automation_steps_modify ON automation_steps FOR ALL USING (
  EXISTS (SELECT 1 FROM automations a
           WHERE a.id = automation_steps.automation_id AND is_project_member(a.project_id, 'agent'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM automations a
           WHERE a.id = automation_steps.automation_id AND is_project_member(a.project_id, 'agent'))
);

-- ---- flow_nodes -------------------------------------------------
CREATE POLICY flow_nodes_select ON flow_nodes FOR SELECT USING (
  EXISTS (SELECT 1 FROM flows f
           WHERE f.id = flow_nodes.flow_id AND is_project_member(f.project_id))
);
CREATE POLICY flow_nodes_modify ON flow_nodes FOR ALL USING (
  EXISTS (SELECT 1 FROM flows f
           WHERE f.id = flow_nodes.flow_id AND is_project_member(f.project_id, 'agent'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM flows f
           WHERE f.id = flow_nodes.flow_id AND is_project_member(f.project_id, 'agent'))
);

-- ---- flow_run_events -------------------------------------------
-- Read-only for clients; the engine writes with the service role.
CREATE POLICY flow_run_events_select ON flow_run_events FOR SELECT USING (
  EXISTS (SELECT 1 FROM flow_runs r
           WHERE r.id = flow_run_events.flow_run_id AND is_project_member(r.project_id))
);

-- ---- message_reactions -----------------------------------------
CREATE POLICY message_reactions_select ON message_reactions FOR SELECT USING (
  EXISTS (SELECT 1 FROM conversations c
           WHERE c.id = message_reactions.conversation_id
             AND is_project_member(c.project_id))
);
CREATE POLICY message_reactions_modify ON message_reactions FOR ALL USING (
  EXISTS (SELECT 1 FROM conversations c
           WHERE c.id = message_reactions.conversation_id
             AND is_project_member(c.project_id, 'agent'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM conversations c
           WHERE c.id = message_reactions.conversation_id
             AND is_project_member(c.project_id, 'agent'))
);
