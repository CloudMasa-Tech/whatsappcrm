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
