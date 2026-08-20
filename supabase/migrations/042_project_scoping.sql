-- ============================================================
-- 042_project_scoping.sql — put `project_id` on every domain table
--
-- Second of three. 041 created `projects` / `project_members` and the
-- `is_project_member()` helper; this migration adds the column, moves
-- existing data into a per-account "Default" project, makes the column
-- NOT NULL, and re-keys every uniqueness constraint that assumed one
-- account = one workspace. 043 then swaps the RLS policies over.
--
-- Ordering matters and is deliberate:
--
--   1. add `project_id` (nullable) to every account-scoped table
--   2. create one Default project per existing account
--   3. backfill project_id from account_id through that project
--   4. add + backfill messages.project_id (denormalised, see below)
--   5. NOT NULL, composite FKs, indexes
--   6. re-key the uniqueness constraints
--   7. teach handle_new_user to create a project for new signups
--
-- Why messages carries a denormalised project_id
-- ----------------------------------------------
-- `messages` is scoped through `conversations` for RLS and that stays
-- true. But Supabase Realtime's `postgres_changes` filter can only
-- test columns on the changed row itself — there is no way to say
-- "only messages whose conversation belongs to project X". Without a
-- real column, every member of an organisation would receive change
-- events for every project in it. The composite FK below keeps the
-- denormalised value honest.
--
-- Behaviour after this migration is unchanged for existing users:
-- everyone has exactly one project holding everything they had.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- 1. ADD project_id TO EVERY ACCOUNT-SCOPED TABLE
--
-- These are exactly the tables carrying `account_id` today (017's
-- fifteen, plus the ones added by 026–035), minus the three that are
-- organisation-level by nature and stay that way:
--
--   accounts, profiles, account_invitations — membership/billing
--   member_presence                         — org roster presence,
--                                             exposes no project data
--
-- Nullable for now; NOT NULL lands in step 5 once the backfill has
-- run.
-- ============================================================
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
    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS project_id UUID', t
    );
  END LOOP;
END $$;

-- ============================================================
-- 2. ONE DEFAULT PROJECT PER EXISTING ACCOUNT
--
-- channel_type is 'cloud_api' because every account that exists at
-- migration time was necessarily on the Meta Cloud API — QR is new.
-- The `projects` default for NEW projects is 'qr'.
-- ============================================================
INSERT INTO projects (account_id, name, slug, channel_type)
SELECT a.id, 'Default', 'default', 'cloud_api'
FROM accounts a
ON CONFLICT (account_id, slug) DO NOTHING;

-- ============================================================
-- 3. BACKFILL project_id FROM account_id
--
-- Every row travels to its account's Default project. `project_id IS
-- NULL` guards make this re-runnable without disturbing rows that a
-- later application write already placed in a real project.
-- ============================================================
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
    EXECUTE format($f$
      UPDATE public.%I AS d
         SET project_id = pr.id
        FROM public.projects pr
       WHERE pr.account_id = d.account_id
         AND pr.slug = 'default'
         AND d.project_id IS NULL
    $f$, t);
  END LOOP;
END $$;

-- ============================================================
-- 4. messages.project_id
--
-- Backfilled through the conversation. On a large instance this is
-- the one statement in this migration that touches a big table — if
-- `messages` runs to millions of rows, run it in batches ahead of
-- time (same UPDATE with `AND m.id IN (SELECT … LIMIT n)`) so the
-- migration itself finds nothing left to do.
-- ============================================================
ALTER TABLE messages ADD COLUMN IF NOT EXISTS project_id UUID;

UPDATE messages m
   SET project_id = c.project_id
  FROM conversations c
 WHERE c.id = m.conversation_id
   AND m.project_id IS NULL;

-- ============================================================
-- 5. NOT NULL + COMPOSITE FKs + INDEXES
--
-- The composite FK is the point of this step. `project_id` alone
-- would let a row name a project belonging to a DIFFERENT account
-- while keeping its own account_id — a row that one tenancy check
-- sees and the other doesn't. Referencing the (id, account_id) pair
-- created in 041 makes that state unrepresentable.
-- ============================================================
DO $$
DECLARE
  t TEXT;
  orphans BIGINT;
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
    -- Fail loudly rather than half-applying: a leftover NULL means the
    -- backfill missed something (a row whose account has no Default
    -- project, which should be impossible after step 2).
    EXECUTE format('SELECT count(*) FROM public.%I WHERE project_id IS NULL', t)
      INTO orphans;
    IF orphans > 0 THEN
      RAISE EXCEPTION
        'Cannot scope %: % row(s) still have a NULL project_id. Backfill them, then re-run.',
        t, orphans;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN project_id SET NOT NULL', t);

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = t || '_project_account_fk'
        AND conrelid = format('public.%I', t)::regclass
    ) THEN
      EXECUTE format($f$
        ALTER TABLE public.%I
          ADD CONSTRAINT %I
          FOREIGN KEY (project_id, account_id)
          REFERENCES public.projects (id, account_id)
          ON DELETE CASCADE
      $f$, t, t || '_project_account_fk');
    END IF;

    -- Every "list mine" query is now "list this project's".
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON public.%I (project_id)',
      'idx_' || t || '_project', t
    );
  END LOOP;
END $$;

-- messages: same guarantee, expressed through the conversation rather
-- than the account (messages has no account_id column). The unique
-- index on conversations is the FK target.
CREATE UNIQUE INDEX IF NOT EXISTS conversations_id_project_id_key
  ON conversations (id, project_id);

DO $$
DECLARE
  orphans BIGINT;
BEGIN
  SELECT count(*) INTO orphans FROM messages WHERE project_id IS NULL;
  IF orphans > 0 THEN
    RAISE EXCEPTION
      'Cannot scope messages: % row(s) still have a NULL project_id.', orphans;
  END IF;

  ALTER TABLE messages ALTER COLUMN project_id SET NOT NULL;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'messages_conversation_project_fk'
      AND conrelid = 'public.messages'::regclass
  ) THEN
    ALTER TABLE messages
      ADD CONSTRAINT messages_conversation_project_fk
      FOREIGN KEY (conversation_id, project_id)
      REFERENCES conversations (id, project_id)
      ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_messages_project ON messages (project_id);

-- ============================================================
-- 6. RE-KEY THE UNIQUENESS CONSTRAINTS
--
-- Each of these encoded "one account = one workspace". Under
-- projects, the same phone number legitimately appears in two
-- projects of one organisation as two independent contacts with two
-- independent conversations — that is what data isolation means. Left
-- unchanged, these constraints would make the second project
-- unusable.
-- ============================================================

-- One WhatsApp connection per PROJECT (was: per account).
ALTER TABLE whatsapp_config DROP CONSTRAINT IF EXISTS whatsapp_config_account_id_key;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'whatsapp_config_project_id_key'
      AND conrelid = 'public.whatsapp_config'::regclass
  ) THEN
    ALTER TABLE whatsapp_config
      ADD CONSTRAINT whatsapp_config_project_id_key UNIQUE (project_id);
  END IF;
END $$;

-- One AI config per PROJECT (was: per account).
ALTER TABLE ai_configs DROP CONSTRAINT IF EXISTS ai_configs_account_id_key;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ai_configs_project_id_key'
      AND conrelid = 'public.ai_configs'::regclass
  ) THEN
    ALTER TABLE ai_configs
      ADD CONSTRAINT ai_configs_project_id_key UNIQUE (project_id);
  END IF;
END $$;

-- Contact phone dedup (022) — now per project.
DROP INDEX IF EXISTS idx_contacts_account_phone_normalized;
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_project_phone_normalized
  ON contacts (project_id, phone_normalized)
  WHERE phone_normalized <> '';

-- One conversation per (project, contact) (036). A contact already
-- cannot span projects, so this is mostly belt-and-braces — but the
-- inbound webhook's unique-violation recovery keys off it, so it has
-- to name the right columns.
DROP INDEX IF EXISTS idx_conversations_account_contact;
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_project_contact
  ON conversations (project_id, contact_id);

-- At most one ACTIVE flow run per (project, contact) (010 → 017).
-- The flows engine relies on the 23505 from this index for its
-- concurrency safety, so it must survive the re-key.
DROP INDEX IF EXISTS idx_one_active_run_per_contact;
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_run_per_contact
  ON flow_runs (project_id, contact_id)
  WHERE status = 'active';

-- ============================================================
-- 7. NEW SIGNUPS GET A PROJECT
--
-- Replaces 017's handle_new_user. A brand-new user now lands with
-- account → Default project → owner profile, atomically. Without
-- this, the first login after 042 would resolve no project and the
-- dashboard would have nothing to scope to.
--
-- New projects default to channel_type 'qr' — that is the direction
-- of travel — but the row is created explicitly here so the intent is
-- visible rather than inherited from a column default.
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_full_name TEXT;
  v_account_id UUID;
BEGIN
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');

  INSERT INTO public.accounts (name, owner_user_id)
  VALUES (COALESCE(NULLIF(v_full_name, ''), NEW.email, 'My account'), NEW.id)
  RETURNING id INTO v_account_id;

  INSERT INTO public.projects (account_id, name, slug, channel_type)
  VALUES (v_account_id, 'Default', 'default', 'qr')
  ON CONFLICT (account_id, slug) DO NOTHING;

  INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role)
  VALUES (NEW.id, v_full_name, NEW.email, v_account_id, 'owner');

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to bootstrap account/project/profile for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
