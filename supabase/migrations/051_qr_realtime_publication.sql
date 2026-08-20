-- ============================================================
-- 051_qr_realtime_publication.sql — make the QR actually arrive live
--
-- The pairing screen renders its QR code straight out of
-- `whatsapp_sessions`, which the gateway updates every time WhatsApp
-- issues a new code (~every 20s). For that to reach a browser the table
-- has to be in the `supabase_realtime` publication.
--
-- Migration 044 tried to add it, but inside a block that DOWNGRADES a
-- privilege error to a WARNING. That was the right call there — the
-- Editor runs a whole script in one transaction, so aborting would have
-- rolled back five migrations — but it means a run by a role that does
-- not own the publication left the migration green and Realtime off.
--
-- Why that was invisible: a `postgres_changes` subscription to an
-- UNPUBLISHED table still reports SUBSCRIBED. The Realtime server
-- accepts the subscription; the WAL simply never carries a row for that
-- table. So the client believed its live feed was healthy, the fallback
-- poll (gated on `!realtimeOk`) never started, and the QR never
-- appeared — with no error anywhere for anyone to find.
--
-- The client no longer trusts that signal: it polls unconditionally
-- while a pairing is in flight (see src/components/settings/qr-pairing.tsx).
-- This migration removes the underlying cause, so the QR arrives
-- immediately rather than on the next poll tick.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ------------------------------------------------------------
-- REPLICA IDENTITY FULL
--
-- Default replica identity puts only the primary key in the WAL's OLD
-- tuple. The pairing UI subscribes with `filter: project_id=eq.<id>`,
-- which is matched against that tuple for DELETE — so an unpaired
-- project's DELETE event never matched its own filter and the UI kept
-- showing a session that no longer existed.
--
-- The cost is one extra copy of the old row per UPDATE. On this table
-- that is nothing: one row per project, written about once a minute by
-- the gateway heartbeat.
-- ------------------------------------------------------------
ALTER TABLE whatsapp_sessions REPLICA IDENTITY FULL;

-- ------------------------------------------------------------
-- Publication membership
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'whatsapp_sessions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE whatsapp_sessions;
    RAISE NOTICE 'Added whatsapp_sessions to supabase_realtime.';
  ELSE
    RAISE NOTICE 'whatsapp_sessions is already published — nothing to do.';
  END IF;
EXCEPTION WHEN insufficient_privilege OR undefined_object THEN
  -- Still a warning rather than an abort: the pairing screen polls on
  -- its own now, so an unpublished table costs live updates, not the
  -- feature. Loud enough that an operator can act on it.
  RAISE WARNING
    'ACTION REQUIRED: could not add whatsapp_sessions to supabase_realtime (%). '
    'QR pairing still works (the UI polls while pairing) but will not update '
    'live. Fix it in the Supabase dashboard: Database -> Replication -> '
    'supabase_realtime -> enable whatsapp_sessions.', SQLERRM;
END $$;

-- ------------------------------------------------------------
-- Verify, and say plainly which state the database ended up in. Run
-- this on its own any time you want to check:
--
--   SELECT * FROM pg_publication_tables
--   WHERE pubname = 'supabase_realtime' AND tablename = 'whatsapp_sessions';
-- ------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'whatsapp_sessions'
  ) THEN
    RAISE NOTICE 'OK: whatsapp_sessions is published to supabase_realtime.';
  ELSE
    RAISE WARNING
      'whatsapp_sessions is NOT published to supabase_realtime. The pairing '
      'screen will fall back to polling. See the note above.';
  END IF;
END $$;
