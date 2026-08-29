-- ============================================================
-- wacrm — preflight for migrations 057 → 058. READ-ONLY.
--
-- Run this BEFORE supabase/apply_057_058.sql to see whether the target
-- database is ready, and again afterwards to confirm what landed.
-- It writes nothing, so it is safe against production.
--
--   psql "$DATABASE_URL" -f supabase/preflight_057_058.sql
--
-- Read the `status` column: every row should say OK before you apply.
-- ============================================================

\echo ''
\echo '=== PREREQUISITES (all must be OK before applying) ==='

SELECT
  'migrations 001-056 applied' AS check,
  CASE WHEN to_regclass('public.email_campaign_recipients') IS NOT NULL
        AND to_regclass('public.projects') IS NOT NULL
       THEN 'OK'
       ELSE 'BLOCKED — apply 001-056 first (057 alters a 056 table)'
  END AS status

UNION ALL SELECT
  'is_project_member() exists (needed by 058 RLS)',
  CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'is_project_member')
       THEN 'OK' ELSE 'BLOCKED — migration 043 missing' END

UNION ALL SELECT
  'gen_random_uuid() resolvable (token default)',
  CASE WHEN EXISTS (
         SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE p.proname = 'gen_random_uuid' AND n.nspname IN ('pg_catalog', 'extensions'))
       THEN 'OK' ELSE 'BLOCKED — unexpected on Postgres 13+' END

UNION ALL SELECT
  'accounts / projects / contacts present (FK targets)',
  CASE WHEN to_regclass('public.accounts') IS NOT NULL
        AND to_regclass('public.projects') IS NOT NULL
        AND to_regclass('public.contacts') IS NOT NULL
       THEN 'OK' ELSE 'BLOCKED — core schema incomplete' END;

\echo ''
\echo '=== POST-APPLY VERIFICATION (all OK once applied) ==='

SELECT
  '057: email_events table' AS check,
  CASE WHEN to_regclass('public.email_events') IS NOT NULL THEN 'OK' ELSE 'MISSING' END AS status

UNION ALL SELECT
  '057: recipient engagement columns',
  CASE WHEN (SELECT count(*) FROM information_schema.columns
              WHERE table_schema = 'public'
                AND table_name = 'email_campaign_recipients'
                AND column_name IN ('tracking_token','open_count','click_count',
                                    'first_opened_at','first_clicked_at','replied_at',
                                    'conversation_id')) = 7
       THEN 'OK' ELSE 'MISSING' END

UNION ALL SELECT
  '057: campaign aggregate columns',
  CASE WHEN (SELECT count(*) FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'email_campaigns'
                AND column_name IN ('replied_count','sent_at','scheduled_at',
                                    'track_opens','track_clicks')) = 5
       THEN 'OK' ELSE 'MISSING' END

UNION ALL SELECT
  '057: email threading columns on messages',
  CASE WHEN (SELECT count(*) FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'messages'
                AND column_name IN ('email_subject','email_message_id','email_in_reply_to')) = 3
       THEN 'OK' ELSE 'MISSING' END

UNION ALL SELECT
  '057: tracking RPCs',
  CASE WHEN (SELECT count(DISTINCT proname) FROM pg_proc
              WHERE proname IN ('record_email_open','record_email_click','record_email_reply')) = 3
       THEN 'OK' ELSE 'MISSING' END

UNION ALL SELECT
  '057: tracking_token unique index',
  CASE WHEN EXISTS (SELECT 1 FROM pg_indexes
                     WHERE tablename = 'email_campaign_recipients'
                       AND indexname = 'idx_email_recipients_tracking_token')
       THEN 'OK' ELSE 'MISSING' END

UNION ALL SELECT
  '058: facebook_config table',
  CASE WHEN to_regclass('public.facebook_config') IS NOT NULL THEN 'OK' ELSE 'MISSING' END

UNION ALL SELECT
  '058: facebook_config RLS enabled',
  CASE WHEN COALESCE((SELECT relrowsecurity FROM pg_class
                       WHERE oid = to_regclass('public.facebook_config')), false)
       THEN 'OK' ELSE 'MISSING — table would be world-readable' END

UNION ALL SELECT
  '058: facebook_config policy',
  CASE WHEN EXISTS (SELECT 1 FROM pg_policies
                     WHERE tablename = 'facebook_config'
                       AND policyname = 'project_members_manage_facebook_config')
       THEN 'OK' ELSE 'MISSING' END;

\echo ''
\echo '=== DATA SANITY (informational, not blocking) ==='

SELECT
  'campaign recipients missing a tracking token' AS check,
  COALESCE((SELECT count(*)::text FROM public.email_campaign_recipients
             WHERE tracking_token IS NULL), 'n/a') AS value

UNION ALL SELECT
  'email conversations in the shared inbox',
  COALESCE((SELECT count(*)::text FROM public.conversations WHERE channel = 'email'), 'n/a')

UNION ALL SELECT
  'facebook conversations in the shared inbox',
  COALESCE((SELECT count(*)::text FROM public.conversations WHERE channel = 'facebook'), 'n/a');
