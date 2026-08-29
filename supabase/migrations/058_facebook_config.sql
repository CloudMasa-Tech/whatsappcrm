-- ============================================================
-- 058_facebook_config.sql
--
-- Gives Facebook the same credential store Instagram got in 052, so a
-- Page can be connected properly instead of only being browsed through
-- the in-frame proxy.
--
-- Facebook Messenger and Instagram DM ride the same Meta Messenger
-- Platform, so this table deliberately mirrors `instagram_config`:
-- one row per project, an encrypted Page access token, and a status the
-- inbox readiness strip can report.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.facebook_config (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  project_id   UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Meta Page identity, filled from the Graph API at connect time so the
  -- UI can show which Page is linked without another round-trip.
  page_id             TEXT,
  page_name           TEXT,
  profile_picture_url TEXT,

  -- All three are ENCRYPTED at rest with ENCRYPTION_KEY, exactly as
  -- instagram_config stores them. Never select these into a client
  -- response.
  access_token TEXT,
  verify_token TEXT,
  app_secret   TEXT,

  status       TEXT NOT NULL DEFAULT 'disconnected'
                 CHECK (status IN ('connected', 'disconnected', 'error')),
  last_error   TEXT,
  connected_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One Facebook Page per project, which is what makes the config route's
-- upsert on project_id well-defined.
CREATE UNIQUE INDEX IF NOT EXISTS idx_facebook_config_project
  ON public.facebook_config(project_id);

CREATE INDEX IF NOT EXISTS idx_facebook_config_account
  ON public.facebook_config(account_id);

-- Inbound webhooks arrive addressed to a Page id, so that lookup must
-- be indexed for when the webhook lands.
CREATE INDEX IF NOT EXISTS idx_facebook_config_page
  ON public.facebook_config(page_id);

ALTER TABLE public.facebook_config ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'facebook_config'
       AND policyname = 'project_members_manage_facebook_config'
  ) THEN
    -- Scoped by project membership, matching how project-scoped tables
    -- have been secured since 043.
    CREATE POLICY project_members_manage_facebook_config
      ON public.facebook_config
      FOR ALL
      TO authenticated
      USING (is_project_member(project_id))
      WITH CHECK (is_project_member(project_id));
  END IF;
END $$;

GRANT ALL ON TABLE public.facebook_config TO service_role, postgres;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.facebook_config TO authenticated;
