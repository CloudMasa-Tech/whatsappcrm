-- ============================================================
-- 045_project_id_backstop.sql — transitional scaffold
--
-- The problem this solves
-- -----------------------
-- 042 made `project_id` NOT NULL on ~23 tables. There are ~70 INSERT
-- sites in the app that predate projects and set only `account_id`.
-- Migrating them is mechanical but large, and shipping it half-done is
-- the dangerous option: a call site that guesses the wrong project
-- files a customer's contact into a sibling project's inbox, which is
-- precisely the failure this whole feature exists to prevent.
--
-- So instead of choosing between "break the app" and "migrate 70 sites
-- in one commit", this trigger makes the un-migrated path behave
-- correctly where it can, and fail LOUDLY where it cannot:
--
--   account has exactly one project  → fill project_id from it.
--     This is every installation that existed before 042, so their
--     behaviour is unchanged and correct.
--
--   account has several projects     → RAISE. There is no safe guess,
--     and an exception naming the table is infinitely better than a
--     row landing in the wrong tenant's data.
--
-- It is a scaffold, not a design. Every INSERT should name its
-- project_id explicitly; this only stops the gap being catastrophic
-- while they are migrated one at a time. Once no call site relies on
-- it, drop the triggers (the DO block at the bottom of this file is
-- the inverse) and the NOT NULL constraints alone do the job.
--
-- Note it never OVERWRITES a supplied project_id — a migrated call
-- site is untouched by this, and the composite FK from 042 still
-- verifies whatever it supplied.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE OR REPLACE FUNCTION fill_project_id_from_account()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_project_id UUID;
  v_count INT;
BEGIN
  -- Already scoped: nothing to do. This is the path every migrated
  -- call site takes.
  IF NEW.project_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.account_id IS NULL THEN
    RAISE EXCEPTION
      'Cannot resolve project_id for %: the row has neither project_id nor account_id.',
      TG_TABLE_NAME;
  END IF;

  -- Counted and fetched separately: there is no min(uuid) aggregate,
  -- and the id is only meaningful once we know the count is exactly 1.
  SELECT count(*) INTO v_count
  FROM projects
  WHERE account_id = NEW.account_id
    AND archived_at IS NULL;

  IF v_count = 0 THEN
    RAISE EXCEPTION
      'Cannot resolve project_id for %: account % has no active project.',
      TG_TABLE_NAME, NEW.account_id;
  END IF;

  IF v_count > 1 THEN
    RAISE EXCEPTION
      'Ambiguous project_id for % — account % has % active projects and this INSERT did not say which one. Fix the call site to set project_id explicitly.',
      TG_TABLE_NAME, NEW.account_id, v_count;
  END IF;

  SELECT id INTO v_project_id
  FROM projects
  WHERE account_id = NEW.account_id
    AND archived_at IS NULL;

  NEW.project_id := v_project_id;
  RETURN NEW;
END;
$$;

ALTER FUNCTION fill_project_id_from_account() OWNER TO postgres;

-- Attach to every table 042 scoped, except `messages` — that one has
-- no account_id to resolve from, and its own INSERT sites go through
-- the send/ingest paths, which already set project_id.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'contacts', 'tags', 'custom_fields', 'contact_notes',
    'conversations', 'whatsapp_config', 'message_templates',
    'pipelines', 'deals', 'broadcasts', 'automations',
    'automation_logs', 'automation_pending_executions',
    'flows', 'flow_runs', 'quick_replies',
    'ai_configs', 'ai_knowledge_documents', 'ai_knowledge_chunks',
    'ai_usage_log', 'webhook_endpoints', 'api_keys', 'notifications'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS fill_project_id ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER fill_project_id BEFORE INSERT ON public.%I
         FOR EACH ROW EXECUTE FUNCTION fill_project_id_from_account()', t
    );
  END LOOP;
END $$;

-- ============================================================
-- Removing this scaffold
--
-- Once every INSERT site sets project_id (grep for `.insert(` against
-- the tables above), run:
--
--   DO $$
--   DECLARE t TEXT;
--   BEGIN
--     FOREACH t IN ARRAY ARRAY[ …same list… ] LOOP
--       EXECUTE format('DROP TRIGGER IF EXISTS fill_project_id ON public.%I', t);
--     END LOOP;
--   END $$;
--   DROP FUNCTION IF EXISTS fill_project_id_from_account();
--
-- Until then, an account with two or more projects will surface an
-- exception naming the exact table whose call site still needs work.
-- ============================================================
