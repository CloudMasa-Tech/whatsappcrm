-- ============================================================
-- wacrm — apply migrations 041 → 045 in one pass.
--
-- For an instance already running 001–040 (it has `accounts` but no
-- `projects`). Paste the whole file into the Supabase SQL Editor and
-- run it, or:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/apply_041_045.sql
--
-- READ THIS IF A PREVIOUS ATTEMPT "DID NOTHING"
-- ---------------------------------------------
-- The Supabase SQL Editor runs an entire script inside ONE
-- transaction. Any single error rolls the whole thing back, so a
-- failure at the very end looks exactly like nothing having happened.
-- Scroll up in the Editor's output to find the first error, and run
-- supabase/preflight_041_045.sql (read-only) to see what would block.
--
-- Contents, in dependency order — 042 needs 041, 043 needs 042:
--   041_projects.sql            projects, project_members, helpers
--   042_project_scoping.sql     project_id everywhere + backfill
--   043_project_rls.sql         RLS moves onto the project boundary
--   044_qr_sessions.sql         QR session + credential tables
--   045_project_id_backstop.sql transitional INSERT guard
--
-- Idempotent: safe to re-run, and safe to re-run after a partial
-- failure. Existing data is preserved — 042 creates one "Default"
-- project per account and moves every existing row into it, so
-- behaviour is unchanged until you create a second project.
-- ============================================================



-- ############################################################
-- 041_projects.sql
-- ############################################################

-- ============================================================
-- 041_projects.sql — Projects: a second tenancy level beneath the
-- account (= organisation).
--
-- Why
-- ---
-- Until now `accounts` was the only tenant boundary: one account,
-- one WhatsApp number, one shared pool of contacts / conversations /
-- flows. Customers need to run several *independent* WhatsApp
-- workspaces under one organisation — a "project" — where project A
-- cannot see project B's data even though both belong to the same
-- account, and no account can ever see another account's anything.
--
-- The hierarchy after this migration:
--
--   accounts  (= organisation, the billing / membership boundary)
--     └── projects  (the DATA boundary — one WhatsApp session each)
--           └── contacts, conversations, flows, broadcasts, …
--
-- This migration only introduces the new tables and the membership
-- helper. 042 adds `project_id` to the domain tables and backfills;
-- 043 swaps every RLS policy over to the new helper. Split three
-- ways so each step can be reviewed (and rolled back) on its own.
--
-- Isolation model
-- ---------------
-- `is_project_member(project_id, min_role)` is the single gate. It
-- joins projects → profiles on `account_id`, so a project in another
-- ACCOUNT can never match regardless of how project_members is
-- populated: cross-organisation isolation is structural, not
-- configuration. Within an organisation:
--
--   owner / admin  → every project (they administer the org)
--   agent / viewer → only projects they are explicitly assigned to
--                    via `project_members`
--
-- Archived projects stay readable but reject writes — see the
-- archived_at clause in the helper.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- PROJECTS
-- ============================================================
CREATE TABLE IF NOT EXISTS projects (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  -- URL-safe handle, unique per account. Not globally unique: two
  -- organisations may both have a "support" project.
  slug         TEXT NOT NULL,
  -- Which transport this project's WhatsApp number speaks.
  --   'cloud_api' — Meta Graph API (whatsapp_config row)
  --   'qr'        — WhatsApp Web pairing via the gateway
  --                 (whatsapp_sessions row, see 044)
  channel_type TEXT NOT NULL DEFAULT 'qr'
               CHECK (channel_type IN ('qr', 'cloud_api')),
  -- Soft delete. Archived projects remain readable (history, export)
  -- but reject every write — enforced in is_project_member below.
  archived_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_projects_account ON projects(account_id);

-- Composite unique on (id, account_id). `id` is already the PK so this
-- adds no uniqueness — it exists purely as an FK *target*, so that
-- every domain row in 042 can declare
--
--   FOREIGN KEY (project_id, account_id) REFERENCES projects (id, account_id)
--
-- and have Postgres guarantee the two tenancy columns agree. Without
-- it, a bug could write project_id from project P2 alongside
-- account_id from account A1, producing a row that one check sees and
-- the other doesn't — exactly the kind of hole this whole migration
-- exists to close.
CREATE UNIQUE INDEX IF NOT EXISTS projects_id_account_id_key
  ON projects (id, account_id);

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON projects;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- PROJECT_MEMBERS
--
-- Explicit roster for agent/viewer-level members. Owners and admins
-- are NOT listed here — they reach every project in their own
-- organisation by role (see the helper). Deleting a row revokes
-- access immediately; there is no cached grant anywhere.
-- ============================================================
CREATE TABLE IF NOT EXISTS project_members (
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  PRIMARY KEY (project_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id);

ALTER TABLE project_members ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- ROLE RANK
--
-- 017 inlined the same CASE ladder twice inside is_account_member.
-- Extracted here so 041/043 and any future policy share one
-- definition of "admin outranks agent".
-- ============================================================
CREATE OR REPLACE FUNCTION role_rank(r account_role_enum)
RETURNS INT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE r
           WHEN 'owner'  THEN 4
           WHEN 'admin'  THEN 3
           WHEN 'agent'  THEN 2
           WHEN 'viewer' THEN 1
         END;
$$;

ALTER FUNCTION role_rank(account_role_enum) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION role_rank(account_role_enum) TO authenticated, service_role;

-- ============================================================
-- PROJECT MEMBERSHIP HELPER
--
-- SECURITY DEFINER for the same reason as is_account_member: the
-- body reads `profiles` and `projects`, and evaluating their own RLS
-- from inside a policy would recurse.
--
-- Returns true iff auth.uid() may act on `target_project_id` at
-- `min_role` or above.
--
-- The archived_at clause: an archived project satisfies viewer-level
-- checks only. SELECT policies call this with the default 'viewer'
-- and keep working; every INSERT/UPDATE/DELETE policy asks for
-- 'agent' or 'admin' and therefore fails. That gives read-only
-- archives without a second helper or a per-table flag.
-- ============================================================
CREATE OR REPLACE FUNCTION is_project_member(
  target_project_id UUID,
  min_role account_role_enum DEFAULT 'viewer'
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM projects pr
    JOIN profiles p ON p.account_id = pr.account_id
    WHERE pr.id     = target_project_id
      AND p.user_id = auth.uid()
      -- Cross-organisation isolation lives in the JOIN above: the
      -- caller's profile must sit in the SAME account as the project.
      AND role_rank(p.account_role) >= role_rank(min_role)
      AND (
        -- Admin+ administer the whole organisation, so every project
        -- in it is theirs.
        role_rank(p.account_role) >= role_rank('admin')
        -- Everyone else needs an explicit assignment.
        OR EXISTS (
          SELECT 1 FROM project_members pm
          WHERE pm.project_id = pr.id
            AND pm.user_id = p.user_id
        )
      )
      -- Archived → viewer-level (read) only.
      AND (pr.archived_at IS NULL OR role_rank(min_role) <= role_rank('viewer'))
  );
$$;

ALTER FUNCTION is_project_member(UUID, account_role_enum) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION is_project_member(UUID, account_role_enum)
  TO authenticated, service_role;

-- ============================================================
-- LOOKUP HELPERS
--
-- Both exist to keep policy bodies from issuing RLS-filtered
-- subqueries against `projects` / `profiles`. Two reasons that
-- matters:
--
--   1. Recursion. A policy ON project_members that sub-selects
--      project_members re-enters its own policy and Postgres aborts
--      with "infinite recursion detected in policy".
--   2. Fail-closed correctness. A security check that reads through
--      another table's RLS silently weakens (or breaks) if that
--      table's policy changes. These run as the owner, so they see
--      the true row every time.
-- ============================================================
CREATE OR REPLACE FUNCTION project_account_id(target_project_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT account_id FROM projects WHERE id = target_project_id;
$$;

ALTER FUNCTION project_account_id(UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION project_account_id(UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION user_in_account(target_user_id UUID, target_account_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.user_id = target_user_id
      AND p.account_id = target_account_id
  );
$$;

ALTER FUNCTION user_in_account(UUID, UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION user_in_account(UUID, UUID) TO authenticated, service_role;

-- ============================================================
-- POLICIES — projects / project_members
--
-- Reading the project LIST is deliberately account-wide-for-admins
-- and roster-limited for everyone else, mirroring the helper. A
-- viewer must not even learn that a sibling project exists.
-- ============================================================
DROP POLICY IF EXISTS projects_select ON projects;
DROP POLICY IF EXISTS projects_insert ON projects;
DROP POLICY IF EXISTS projects_update ON projects;
DROP POLICY IF EXISTS projects_delete ON projects;

-- is_project_member() is SECURITY DEFINER and runs as the table
-- owner, so its internal read of `projects` does NOT re-enter this
-- policy — no recursion. (Archived projects still satisfy the viewer
-- tier, so an admin can find and un-archive them.)
CREATE POLICY projects_select ON projects FOR SELECT
  USING (is_project_member(id));

-- Creating / renaming / archiving a project is an org-admin action,
-- so it gates on account membership rather than project membership.
CREATE POLICY projects_insert ON projects FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY projects_update ON projects FOR UPDATE
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));
-- Hard delete is owner-only: it cascades to every contact,
-- conversation and message in the project.
CREATE POLICY projects_delete ON projects FOR DELETE
  USING (is_account_member(account_id, 'owner'));

DROP POLICY IF EXISTS project_members_select ON project_members;
DROP POLICY IF EXISTS project_members_modify ON project_members;

-- You can see the roster of any project you can see. Goes through the
-- helper rather than a project_members sub-select — the latter
-- re-enters this policy and Postgres aborts the query with "infinite
-- recursion detected in policy".
CREATE POLICY project_members_select ON project_members FOR SELECT
  USING (is_project_member(project_id));

-- Only org admins change who can reach a project. WITH CHECK also
-- verifies the assignee belongs to the SAME organisation — without it
-- an admin could grant one of their projects to a user from another
-- account, which is exactly the boundary this feature exists to hold.
CREATE POLICY project_members_modify ON project_members FOR ALL
  USING (
    is_account_member(project_account_id(project_id), 'admin')
  )
  WITH CHECK (
    is_account_member(project_account_id(project_id), 'admin')
    AND user_in_account(user_id, project_account_id(project_id))
  );

-- ============================================================
-- GRANTS
--
-- Mirrors 038–040: PostgREST talks as `authenticated` / `anon`, and
-- table-level privileges are checked BEFORE RLS. Without these the
-- policies above never even get evaluated.
-- ============================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON projects TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON project_members TO authenticated;
GRANT ALL ON projects TO service_role;
GRANT ALL ON project_members TO service_role;


-- ############################################################
-- 042_project_scoping.sql
-- ############################################################

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


-- ############################################################
-- 043_project_rls.sql
-- ############################################################

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


-- ############################################################
-- 044_qr_sessions.sql
-- ############################################################

-- ============================================================
-- 044_qr_sessions.sql — QR (WhatsApp Web) sessions per project
--
-- Adds the second channel. A project is either:
--
--   channel_type = 'cloud_api' → whatsapp_config  (Meta Graph API)
--   channel_type = 'qr'        → whatsapp_sessions (paired by QR
--                                 scan, socket held by the gateway)
--
-- Two tables, with deliberately different exposure:
--
--   whatsapp_sessions      — status surface. Project members READ it
--                            (the pairing UI renders the QR and the
--                            connection state straight from here over
--                            Realtime). Nobody but the gateway writes.
--
--   whatsapp_session_keys  — the Baileys credential material. NO role
--                            except service_role can touch it at all.
--                            Whoever holds these bytes can send
--                            messages as the customer's number, so
--                            they get the same treatment as the Meta
--                            access tokens in whatsapp_config:
--                            AES-256-GCM at rest (the app's existing
--                            ENCRYPTION_KEY), plus deny-all RLS.
--
-- Also rescopes the two media buckets from account folders to
-- account/project folders, so an agent in one project cannot write
-- into (or delete from) a sibling project's media prefix.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- WHATSAPP_SESSIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS whatsapp_sessions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- UNIQUE: one WhatsApp pairing per project, mirroring
  -- whatsapp_config's one-Cloud-API-number-per-project rule.
  project_id UUID NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

  -- Lifecycle:
  --   disconnected — no socket, no credentials (fresh / after logout)
  --   qr_pending   — gateway is showing a QR; waiting for the scan
  --   connecting   — credentials exist, socket is opening
  --   connected    — live
  --   logged_out   — the phone unlinked us; credentials are dead and
  --                  a re-scan is required (distinct from a transient
  --                  disconnect, which resolves itself)
  --   banned       — WhatsApp rejected the number
  --   error        — see last_error
  status     TEXT NOT NULL DEFAULT 'disconnected'
             CHECK (status IN ('disconnected', 'qr_pending', 'connecting',
                               'connected', 'logged_out', 'banned', 'error')),

  -- The raw QR payload the UI renders. Transient: written when the
  -- socket emits one, cleared the moment we pair. Readable by project
  -- members — a QR is only useful to whoever can also scan it with the
  -- customer's phone, and it expires in seconds.
  qr_code       TEXT,
  qr_expires_at TIMESTAMPTZ,

  -- Identity of the linked device, filled in on connect.
  phone_number  TEXT,
  wa_jid        TEXT,
  display_name  TEXT,

  last_connected_at    TIMESTAMPTZ,
  last_disconnected_at TIMESTAMPTZ,
  last_error           TEXT,

  -- Which gateway process currently owns this socket. Single-instance
  -- deployments can ignore it; once the gateway is sharded, the CRM
  -- routes send requests by this value and it becomes the guard
  -- against two instances opening the same session (WhatsApp treats
  -- that as conflicting devices and drops both).
  gateway_instance TEXT,
  -- Liveness. A connected session whose heartbeat goes stale is
  -- actually down — alert on it rather than trusting `status`.
  heartbeat_at     TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Same trick as 042: project and account cannot disagree.
  FOREIGN KEY (project_id, account_id)
    REFERENCES projects (id, account_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_account
  ON whatsapp_sessions (account_id);
-- The gateway's boot query: "which sessions should I reopen?"
CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_live
  ON whatsapp_sessions (status)
  WHERE status IN ('connected', 'connecting', 'qr_pending');

ALTER TABLE whatsapp_sessions ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON whatsapp_sessions;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON whatsapp_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Read-only for humans. Every state transition happens in the
-- gateway (service role) or through an API route that calls it —
-- a client that could UPDATE this table could claim a session was
-- connected when no socket exists.
DROP POLICY IF EXISTS whatsapp_sessions_select ON whatsapp_sessions;
CREATE POLICY whatsapp_sessions_select ON whatsapp_sessions
  FOR SELECT USING (is_project_member(project_id));

GRANT SELECT ON whatsapp_sessions TO authenticated;
GRANT ALL ON whatsapp_sessions TO service_role;

-- Realtime: this is how the pairing UI gets its QR and its
-- "connected!" transition without polling.
--
-- Wrapped so a privilege error DOWNGRADES to a warning. The
-- `supabase_realtime` publication is not always owned by the role
-- running the SQL Editor, and the Editor runs a whole script in one
-- transaction — an abort here would roll back all five migrations and
-- leave the database looking untouched. Losing Realtime costs the UI
-- its live QR refresh (recoverable: add the table from the dashboard,
-- Database → Replication); losing the whole migration costs far more.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'whatsapp_sessions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE whatsapp_sessions;
  END IF;
EXCEPTION WHEN insufficient_privilege OR undefined_object THEN
  RAISE WARNING
    'Could not add whatsapp_sessions to the supabase_realtime publication (%). '
    'Everything else applied. Add it via Database → Replication, or the QR '
    'pairing screen will not update live.', SQLERRM;
END $$;

-- ============================================================
-- WHATSAPP_SESSION_KEYS — Baileys auth state
--
-- Baileys normally persists auth state as a directory of JSON files
-- (`useMultiFileAuthState`). That is unusable here: sessions must
-- survive container replacement, and per-tenant credentials must not
-- sit on a shared filesystem. The gateway implements the same
-- AuthenticationState interface against this table instead.
--
-- Shape mirrors Baileys' own key model: one 'creds' row per session
-- plus many typed key rows ('pre-key', 'session', 'sender-key',
-- 'app-state-sync-key', …). `payload` is the AES-256-GCM ciphertext
-- of the JSON value, never plaintext.
-- ============================================================
CREATE TABLE IF NOT EXISTS whatsapp_session_keys (
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key_type   TEXT NOT NULL,
  key_id     TEXT NOT NULL,
  payload    TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (project_id, key_type, key_id)
);

ALTER TABLE whatsapp_session_keys ENABLE ROW LEVEL SECURITY;

-- No policies, by design. RLS enabled + zero policies = every request
-- from `anon` and `authenticated` returns nothing and writes nothing,
-- with no way to grant an exception by accident. service_role bypasses
-- RLS, so the gateway (and only the gateway) can use this table.
-- The REVOKE is belt-and-braces: table privileges are checked before
-- RLS, so this fails the request one step earlier.
REVOKE ALL ON whatsapp_session_keys FROM anon, authenticated;
GRANT ALL ON whatsapp_session_keys TO service_role;

-- ============================================================
-- PROJECT-SCOPED MEDIA PATHS
--
-- Before: <bucket>/account-<account_id>/<file>
-- After:  <bucket>/account-<account_id>/project-<project_id>/<file>
--
-- Existing objects keep the old two-segment path and keep working —
-- the legacy branch below preserves account-level write access to
-- them, exactly as 020 preserved the pre-020 user-scoped paths. New
-- uploads must use the project form (see buildMediaPath()).
-- ============================================================

-- Parses `project-<uuid>` out of the second path segment. Returns
-- NULL for legacy paths, which the policies treat as "not a
-- project-scoped object".
CREATE OR REPLACE FUNCTION storage_path_project_id(object_name TEXT)
RETURNS UUID
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  seg TEXT;
BEGIN
  seg := (storage.foldername(object_name))[2];
  IF seg IS NULL OR seg !~ '^project-[0-9a-fA-F-]{36}$' THEN
    RETURN NULL;
  END IF;
  RETURN substring(seg FROM 9)::uuid;
EXCEPTION WHEN OTHERS THEN
  -- A malformed path must never take down the policy evaluation.
  RETURN NULL;
END;
$$;

ALTER FUNCTION storage_path_project_id(TEXT) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION storage_path_project_id(TEXT) TO authenticated, service_role;

-- Same defensive wrapper as the publication above, for the same
-- reason: `storage.objects` is owned by `supabase_storage_admin`, and
-- CREATE POLICY on it can fail depending on which role runs the
-- script. If it does, media writes keep working under the pre-044
-- account-scoped policies — a project cannot then be prevented from
-- writing into a sibling's media prefix, so re-run this block as an
-- owner when you can. Aborting the whole migration would be worse.
DO $$
DECLARE
  b TEXT;
  clause TEXT;
BEGIN
  FOREACH b IN ARRAY ARRAY['flow-media', 'chat-media']
  LOOP
    -- Drop the account-era policies from 020 / 023 for this bucket.
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects',
                   'Members can upload ' || replace(b, '-media', '') || ' media');
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects',
                   'Members can update ' || replace(b, '-media', '') || ' media');
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects',
                   'Members can delete ' || replace(b, '-media', '') || ' media');
    -- …and the ones this migration itself creates, so a re-run
    -- replaces them instead of hitting 42710.
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects',
                   'Project members upload ' || b);
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects',
                   'Project members update ' || b);
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects',
                   'Project members delete ' || b);

    -- One predicate reused for INSERT (WITH CHECK) and
    -- UPDATE/DELETE (USING).
    clause := format($c$
      bucket_id = %L
      AND (
        -- Project-scoped path: agent+ membership of THAT project.
        -- Both segments must agree with the project's real owner, so a
        -- path cannot borrow one project's folder and another's
        -- account prefix. project_account_id() is SECURITY DEFINER, so
        -- this reads the true row rather than an RLS-filtered view of
        -- `projects`.
        (
          storage_path_project_id(name) IS NOT NULL
          AND is_project_member(storage_path_project_id(name), 'agent')
          AND ('account-' || project_account_id(storage_path_project_id(name))::text)
              = (storage.foldername(name))[1]
        )
        -- Legacy pre-044 object (account-<id>/<file>): account members
        -- keep write access so old media stays manageable.
        OR (
          storage_path_project_id(name) IS NULL
          AND EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.user_id = auth.uid()
              AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
          )
        )
      )
    $c$, b);

    EXECUTE format(
      'CREATE POLICY %I ON storage.objects FOR INSERT WITH CHECK (%s)',
      'Project members upload ' || b, clause);
    EXECUTE format(
      'CREATE POLICY %I ON storage.objects FOR UPDATE USING (%s)',
      'Project members update ' || b, clause);
    EXECUTE format(
      'CREATE POLICY %I ON storage.objects FOR DELETE USING (%s)',
      'Project members delete ' || b, clause);
  END LOOP;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE WARNING
    'Could not rewrite storage.objects policies for project-scoped media (%). '
    'Everything else applied. Re-run migration 044 as a role that owns '
    'storage.objects to complete the media isolation.', SQLERRM;
END $$;


-- ############################################################
-- 045_project_id_backstop.sql
-- ############################################################

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
