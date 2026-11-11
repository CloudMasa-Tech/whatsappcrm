-- ============================================================
-- 063_linkedin_integration.sql
--
-- Adds LinkedIn integration per project:
--   1. `linkedin_config` storing encrypted Access/Refresh tokens,
--      optional per-project OAuth Client ID & Secret, member/org URNs,
--      granted scopes, and webhook verification secret.
--   2. LinkedIn contact fields (`linkedin_urn`, `linkedin_url`) for
--      Lead Gen Form sync & webhook lead capture.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.linkedin_config (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  project_id          UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  connection_method   TEXT NOT NULL DEFAULT 'token'
                        CHECK (connection_method IN ('token', 'oauth')),
  account_type        TEXT NOT NULL DEFAULT 'person'
                        CHECK (account_type IN ('person', 'organization')),

  member_urn          TEXT,
  organization_id     TEXT,
  organization_urn    TEXT,
  display_name        TEXT,
  headline            TEXT,
  vanity_name         TEXT,
  profile_picture_url TEXT,

  -- Encrypted at rest with ENCRYPTION_KEY
  access_token        TEXT,
  refresh_token       TEXT,
  token_expires_at    TIMESTAMPTZ,
  client_id           TEXT,
  client_secret       TEXT,
  verify_token        TEXT,
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
    WHERE conname = 'linkedin_config_project_account_fkey'
  ) THEN
    ALTER TABLE public.linkedin_config
      ADD CONSTRAINT linkedin_config_project_account_fkey
      FOREIGN KEY (project_id, account_id)
      REFERENCES public.projects(id, account_id)
      ON DELETE CASCADE;
  END IF;
EXCEPTION
  WHEN others THEN
    RAISE NOTICE 'Skipping composite FK on linkedin_config: %', SQLERRM;
END $$;

CREATE INDEX IF NOT EXISTS idx_linkedin_config_project
  ON public.linkedin_config(project_id);

CREATE INDEX IF NOT EXISTS idx_linkedin_config_account
  ON public.linkedin_config(account_id);

CREATE INDEX IF NOT EXISTS idx_linkedin_config_org
  ON public.linkedin_config(organization_id)
  WHERE organization_id IS NOT NULL;

ALTER TABLE public.linkedin_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "linkedin_config_select" ON public.linkedin_config;
CREATE POLICY "linkedin_config_select" ON public.linkedin_config
  FOR SELECT
  USING (is_project_member(project_id, 'viewer'));

DROP POLICY IF EXISTS "linkedin_config_insert" ON public.linkedin_config;
CREATE POLICY "linkedin_config_insert" ON public.linkedin_config
  FOR INSERT
  WITH CHECK (is_project_member(project_id, 'admin'));

DROP POLICY IF EXISTS "linkedin_config_update" ON public.linkedin_config;
CREATE POLICY "linkedin_config_update" ON public.linkedin_config
  FOR UPDATE
  USING (is_project_member(project_id, 'admin'))
  WITH CHECK (is_project_member(project_id, 'admin'));

DROP POLICY IF EXISTS "linkedin_config_delete" ON public.linkedin_config;
CREATE POLICY "linkedin_config_delete" ON public.linkedin_config
  FOR DELETE
  USING (is_project_member(project_id, 'admin'));

GRANT ALL ON TABLE public.linkedin_config TO service_role, postgres;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.linkedin_config TO authenticated;

-- Extend contacts for LinkedIn Lead Gen & CRM sync
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS linkedin_urn TEXT,
  ADD COLUMN IF NOT EXISTS linkedin_url TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_project_linkedin_urn
  ON public.contacts (project_id, linkedin_urn)
  WHERE linkedin_urn IS NOT NULL;

