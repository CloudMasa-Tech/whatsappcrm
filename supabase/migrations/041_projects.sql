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
