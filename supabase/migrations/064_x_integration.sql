-- ============================================================
-- 064_x_integration.sql
--
-- Adds X (formerly Twitter) integration per project:
--   1. `x_config` storing encrypted OAuth 2.0 Access/Refresh tokens,
--      optional per-project OAuth Client ID & Secret, user handle,
--      profile metadata, and granted scopes.
--   2. X contact fields (`x_user_id`, `x_username`, `x_url`) for
--      mention / reply CRM contact sync.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.x_config (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  project_id          UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  connection_method   TEXT NOT NULL DEFAULT 'oauth'
                        CHECK (connection_method IN ('token', 'oauth')),

  x_user_id           TEXT,
  username            TEXT,
  display_name        TEXT,
  description         TEXT,
  profile_image_url   TEXT,
  followers_count     INTEGER NOT NULL DEFAULT 0,
  following_count     INTEGER NOT NULL DEFAULT 0,
  tweet_count         INTEGER NOT NULL DEFAULT 0,
  verified            BOOLEAN NOT NULL DEFAULT false,

  -- Encrypted at rest with ENCRYPTION_KEY
  access_token        TEXT,
  refresh_token       TEXT,
  token_expires_at    TIMESTAMPTZ,
  client_id           TEXT,
  client_secret       TEXT,
  granted_scopes      TEXT[] NOT NULL DEFAULT '{}',

  status              TEXT NOT NULL DEFAULT 'disconnected'
                        CHECK (status IN ('connected', 'disconnected', 'error')),
  last_error          TEXT,
  connected_at        TIMESTAMPTZ,
  last_synced_at      TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (project_id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'x_config_project_account_fkey'
  ) THEN
    ALTER TABLE public.x_config
      ADD CONSTRAINT x_config_project_account_fkey
      FOREIGN KEY (project_id, account_id)
      REFERENCES public.projects(id, account_id)
      ON DELETE CASCADE;
  END IF;
EXCEPTION
  WHEN others THEN
    RAISE NOTICE 'Skipping composite FK on x_config: %', SQLERRM;
END $$;

CREATE INDEX IF NOT EXISTS idx_x_config_project
  ON public.x_config(project_id);

CREATE INDEX IF NOT EXISTS idx_x_config_account
  ON public.x_config(account_id);

ALTER TABLE public.x_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "x_config_select" ON public.x_config;
CREATE POLICY "x_config_select" ON public.x_config
  FOR SELECT
  USING (is_project_member(project_id, 'viewer'));

DROP POLICY IF EXISTS "x_config_insert" ON public.x_config;
CREATE POLICY "x_config_insert" ON public.x_config
  FOR INSERT
  WITH CHECK (is_project_member(project_id, 'admin'));

DROP POLICY IF EXISTS "x_config_update" ON public.x_config;
CREATE POLICY "x_config_update" ON public.x_config
  FOR UPDATE
  USING (is_project_member(project_id, 'admin'))
  WITH CHECK (is_project_member(project_id, 'admin'));

DROP POLICY IF EXISTS "x_config_delete" ON public.x_config;
CREATE POLICY "x_config_delete" ON public.x_config
  FOR DELETE
  USING (is_project_member(project_id, 'admin'));

GRANT ALL ON TABLE public.x_config TO service_role, postgres;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.x_config TO authenticated;

-- Extend contacts for X mention & CRM contact sync
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS x_user_id TEXT,
  ADD COLUMN IF NOT EXISTS x_username TEXT,
  ADD COLUMN IF NOT EXISTS x_url TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_project_x_user_id
  ON public.contacts (project_id, x_user_id)
  WHERE x_user_id IS NOT NULL;

