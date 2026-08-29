-- ============================================================
-- wacrm — apply migrations 057 → 058 in one pass.
--
-- For an instance already running 001–056. Adds:
--   057_email_lead_flow.sql   email open/click/reply tracking, the
--                             email_events log, email threading on
--                             messages, and the counter RPCs
--   058_facebook_config.sql   facebook_config credential store
--
-- Paste the whole file into the Supabase SQL Editor and run it, or:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/apply_057_058.sql
--
-- Every statement is idempotent — re-running is safe and is the
-- supported way to recover from a partial apply.
--
-- READ THIS IF A PREVIOUS ATTEMPT "DID NOTHING"
-- ---------------------------------------------
-- The Supabase SQL Editor runs an entire script inside ONE
-- transaction. Any single error rolls the whole thing back, so a
-- failure at the very end looks exactly like nothing having happened.
-- Scroll up in the Editor's output to find the FIRST error, and run
-- supabase/preflight_057_058.sql (read-only) to see what would block.
--
-- PREREQUISITES (preflight checks all of these):
--   * migrations 001–056 applied — 057 alters email_campaign_recipients
--     from 056, and 058 needs is_project_member() from 043.
--   * pgcrypto is NOT required: tokens use core gen_random_uuid().
-- ============================================================


-- ============================================================
-- BEGIN 057_email_lead_flow.sql
-- ============================================================
-- ============================================================
-- 057_email_lead_flow.sql
--
-- Turns email campaigns into a first-class lead channel, mirroring
-- how WhatsApp/Instagram already work:
--
--   1. Per-recipient open/click/reply tracking on
--      email_campaign_recipients (056 only tracked delivery).
--   2. An email_events audit log — one row per open/click/reply,
--      so engagement history survives counter updates.
--   3. Email threading columns on messages, so an email thread is a
--      conversation with channel='email' in the shared inbox.
--   4. Atomic counter RPCs, so concurrent tracking hits from a mail
--      client's image proxy cannot lose increments.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- 1. Per-recipient engagement on email_campaign_recipients
-- ============================================================
ALTER TABLE public.email_campaign_recipients
  -- Unguessable per-recipient token embedded in tracking URLs. Not the
  -- row id, so a leaked pixel URL cannot be used to enumerate rows.
  ADD COLUMN IF NOT EXISTS tracking_token   TEXT,
  ADD COLUMN IF NOT EXISTS open_count       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS first_opened_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_opened_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS click_count      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS first_clicked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS replied_at       TIMESTAMPTZ,
  -- The conversation this recipient's thread landed in, once they reply.
  ADD COLUMN IF NOT EXISTS conversation_id  UUID REFERENCES public.conversations(id) ON DELETE SET NULL;

-- Backfill tokens for any rows created before this migration.
--
-- gen_random_uuid() rather than pgcrypto's gen_random_bytes(): the
-- latter lives only in the `extensions` schema, which is not always on
-- the search_path in the Supabase SQL Editor, so it fails there. This
-- is core Postgres (pg_catalog) and always resolvable. A v4 UUID with
-- the dashes stripped is 32 hex chars of cryptographic randomness —
-- ample for an unguessable tracking token.
UPDATE public.email_campaign_recipients
   SET tracking_token = replace(gen_random_uuid()::text, '-', '')
 WHERE tracking_token IS NULL;

ALTER TABLE public.email_campaign_recipients
  ALTER COLUMN tracking_token SET DEFAULT replace(gen_random_uuid()::text, '-', '');

CREATE UNIQUE INDEX IF NOT EXISTS idx_email_recipients_tracking_token
  ON public.email_campaign_recipients(tracking_token);

-- Reply ingestion looks recipients up by address to find the thread.
CREATE INDEX IF NOT EXISTS idx_email_recipients_email_lower
  ON public.email_campaign_recipients(lower(email));

CREATE INDEX IF NOT EXISTS idx_email_recipients_contact
  ON public.email_campaign_recipients(contact_id);

-- ============================================================
-- 2. Campaign-level aggregates
-- ============================================================
ALTER TABLE public.email_campaigns
  ADD COLUMN IF NOT EXISTS replied_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS scheduled_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sent_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS track_opens   BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS track_clicks  BOOLEAN NOT NULL DEFAULT TRUE;

-- ============================================================
-- 3. email_events — append-only engagement log
-- ============================================================
CREATE TABLE IF NOT EXISTS public.email_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  project_id   UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  campaign_id  UUID REFERENCES public.email_campaigns(id) ON DELETE CASCADE,
  recipient_id UUID REFERENCES public.email_campaign_recipients(id) ON DELETE CASCADE,
  contact_id   UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  event_type   TEXT NOT NULL CHECK (event_type IN ('sent', 'open', 'click', 'reply', 'bounce', 'complaint')),
  url          TEXT,
  user_agent   TEXT,
  ip_address   TEXT,
  metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_events_account    ON public.email_events(account_id);
CREATE INDEX IF NOT EXISTS idx_email_events_campaign   ON public.email_events(campaign_id);
CREATE INDEX IF NOT EXISTS idx_email_events_recipient  ON public.email_events(recipient_id);
CREATE INDEX IF NOT EXISTS idx_email_events_contact    ON public.email_events(contact_id, created_at DESC);

ALTER TABLE public.email_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'email_events' AND policyname = 'account_members_read_email_events'
  ) THEN
    -- Read-only for members: rows are written by the tracking and
    -- webhook routes via service_role, never by the browser.
    CREATE POLICY account_members_read_email_events ON public.email_events
      FOR SELECT
      TO authenticated
      USING (
        account_id IN (
          SELECT account_id FROM public.profiles WHERE user_id = auth.uid()
        )
      );
  END IF;
END $$;

-- ============================================================
-- 4. Email threading on messages
--
-- content_type stays 'text' (its CHECK constraint is unchanged);
-- channel='email' is what marks these rows, matching how the
-- instagram channel was introduced in 052.
-- ============================================================
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS email_subject     TEXT,
  -- RFC 5322 Message-ID / In-Reply-To, used to stitch threads together.
  ADD COLUMN IF NOT EXISTS email_message_id  TEXT,
  ADD COLUMN IF NOT EXISTS email_in_reply_to TEXT;

CREATE INDEX IF NOT EXISTS idx_messages_email_message_id
  ON public.messages(email_message_id)
  WHERE email_message_id IS NOT NULL;

-- Finding "the email conversation for this contact" must be fast.
CREATE INDEX IF NOT EXISTS idx_conversations_contact_channel
  ON public.conversations(contact_id, channel);

-- ============================================================
-- 5. Atomic counter RPCs
--
-- A single open can be fetched many times (image proxies retry,
-- clients prefetch). Read-modify-write from the app would lose
-- increments under concurrency, so counters move in SQL.
-- ============================================================

-- Records an open: bumps recipient + campaign counters, and reports
-- whether this was the FIRST open, so the caller only fires the
-- lead-flow automation once per recipient.
DROP FUNCTION IF EXISTS public.record_email_open(TEXT);
CREATE FUNCTION public.record_email_open(p_token TEXT)
RETURNS TABLE (
  recipient_id UUID,
  campaign_id  UUID,
  contact_id   UUID,
  account_id   UUID,
  project_id   UUID,
  owner_user_id UUID,
  email        TEXT,
  is_first_open BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_first BOOLEAN;
BEGIN
  UPDATE email_campaign_recipients r
     SET open_count      = r.open_count + 1,
         first_opened_at = COALESCE(r.first_opened_at, now()),
         last_opened_at  = now(),
         -- Never regress a further-along status (e.g. 'replied').
         status = CASE WHEN r.status IN ('pending', 'sent', 'delivered')
                       THEN 'opened' ELSE r.status END
   WHERE r.tracking_token = p_token
  RETURNING (r.open_count = 1), r.id, r.campaign_id, r.contact_id, r.email
    INTO v_first, recipient_id, campaign_id, contact_id, email;

  IF recipient_id IS NULL THEN
    RETURN;
  END IF;

  IF v_first THEN
    UPDATE email_campaigns c
       SET opened_count = c.opened_count + 1
     WHERE c.id = campaign_id;
  END IF;

  SELECT c.account_id, c.project_id, c.user_id
    INTO account_id, project_id, owner_user_id
    FROM email_campaigns c WHERE c.id = campaign_id;

  is_first_open := v_first;
  RETURN NEXT;
END;
$$;

ALTER FUNCTION public.record_email_open(TEXT) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.record_email_open(TEXT) TO service_role;

-- Records a click. Same first-event semantics as opens.
DROP FUNCTION IF EXISTS public.record_email_click(TEXT, TEXT);
CREATE FUNCTION public.record_email_click(p_token TEXT, p_url TEXT)
RETURNS TABLE (
  recipient_id UUID,
  campaign_id  UUID,
  contact_id   UUID,
  account_id   UUID,
  project_id   UUID,
  owner_user_id UUID,
  email        TEXT,
  is_first_click BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_first BOOLEAN;
BEGIN
  UPDATE email_campaign_recipients r
     SET click_count      = r.click_count + 1,
         first_clicked_at = COALESCE(r.first_clicked_at, now()),
         -- A click implies an open even when the pixel was blocked.
         open_count       = GREATEST(r.open_count, 1),
         first_opened_at  = COALESCE(r.first_opened_at, now()),
         status = CASE WHEN r.status IN ('pending', 'sent', 'delivered', 'opened')
                       THEN 'clicked' ELSE r.status END
   WHERE r.tracking_token = p_token
  RETURNING (r.click_count = 1), r.id, r.campaign_id, r.contact_id, r.email
    INTO v_first, recipient_id, campaign_id, contact_id, email;

  IF recipient_id IS NULL THEN
    RETURN;
  END IF;

  IF v_first THEN
    UPDATE email_campaigns c
       SET clicked_count = c.clicked_count + 1
     WHERE c.id = campaign_id;
  END IF;

  SELECT c.account_id, c.project_id, c.user_id
    INTO account_id, project_id, owner_user_id
    FROM email_campaigns c WHERE c.id = campaign_id;

  is_first_click := v_first;
  RETURN NEXT;
END;
$$;

ALTER FUNCTION public.record_email_click(TEXT, TEXT) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.record_email_click(TEXT, TEXT) TO service_role;

-- Marks a reply against a recipient row (called by the inbound webhook).
CREATE OR REPLACE FUNCTION public.record_email_reply(
  p_recipient_id UUID,
  p_conversation_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_was_first BOOLEAN := FALSE;
BEGIN
  UPDATE email_campaign_recipients r
     SET replied_at      = COALESCE(r.replied_at, now()),
         conversation_id = COALESCE(r.conversation_id, p_conversation_id),
         status          = 'replied'
   WHERE r.id = p_recipient_id
  RETURNING (r.replied_at IS NULL OR r.replied_at = now()) INTO v_was_first;

  IF v_was_first THEN
    UPDATE email_campaigns c
       SET replied_count = c.replied_count + 1
     WHERE c.id = (SELECT campaign_id FROM email_campaign_recipients WHERE id = p_recipient_id);
  END IF;

  RETURN COALESCE(v_was_first, FALSE);
END;
$$;

ALTER FUNCTION public.record_email_reply(UUID, UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.record_email_reply(UUID, UUID) TO service_role;

-- ============================================================
-- 6. Grants
-- ============================================================
GRANT SELECT ON TABLE public.email_events TO authenticated;
GRANT ALL    ON TABLE public.email_events TO service_role, postgres;

-- ============================================================
-- BEGIN 058_facebook_config.sql
-- ============================================================
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
