-- ============================================================
-- Pre-flight for apply_041_045.sql — READ ONLY.
--
-- Changes nothing. Run it in the Supabase SQL Editor before (or after
-- a failed) migration to find what would block it.
--
-- Why this exists: the SQL Editor runs a whole script in ONE
-- transaction, so a single failure rolls back all five migrations and
-- leaves the database exactly as it was — which looks identical to
-- "nothing happened". This tells you what the failure would be.
-- ============================================================

-- ---- 1. Where are we? --------------------------------------
SELECT
  'schema state' AS check,
  CASE
    WHEN to_regclass('public.projects') IS NOT NULL
      THEN 'projects EXISTS — 041+ already applied'
    WHEN to_regclass('public.accounts') IS NOT NULL
      THEN 'accounts exists, projects does not — apply_041_045.sql is the right script'
    ELSE 'accounts missing — run combined_migrations.sql and 037-040 first'
  END AS result;

-- ---- 2. Rows the backfill cannot place ----------------------
-- 042 moves every row into its account's "Default" project by joining
-- on account_id. A row with a NULL account_id has nothing to join to,
-- so it can never receive a project_id — and since 042 then applies
-- NOT NULL, it raises and the whole script rolls back.
--
-- Any non-zero count below is a blocker. Fix those rows (assign the
-- right account_id, or delete them if they are junk) and re-run.
SELECT 'orphan rows (must all be 0)' AS check, * FROM (
  SELECT 'contacts'                       AS table_name, count(*) FROM contacts                      WHERE account_id IS NULL
  UNION ALL SELECT 'tags',                          count(*) FROM tags                          WHERE account_id IS NULL
  UNION ALL SELECT 'custom_fields',                 count(*) FROM custom_fields                 WHERE account_id IS NULL
  UNION ALL SELECT 'contact_notes',                 count(*) FROM contact_notes                 WHERE account_id IS NULL
  UNION ALL SELECT 'conversations',                 count(*) FROM conversations                 WHERE account_id IS NULL
  UNION ALL SELECT 'whatsapp_config',               count(*) FROM whatsapp_config               WHERE account_id IS NULL
  UNION ALL SELECT 'message_templates',             count(*) FROM message_templates             WHERE account_id IS NULL
  UNION ALL SELECT 'pipelines',                     count(*) FROM pipelines                     WHERE account_id IS NULL
  UNION ALL SELECT 'deals',                         count(*) FROM deals                         WHERE account_id IS NULL
  UNION ALL SELECT 'broadcasts',                    count(*) FROM broadcasts                    WHERE account_id IS NULL
  UNION ALL SELECT 'automations',                   count(*) FROM automations                   WHERE account_id IS NULL
  UNION ALL SELECT 'automation_logs',               count(*) FROM automation_logs               WHERE account_id IS NULL
  UNION ALL SELECT 'automation_pending_executions', count(*) FROM automation_pending_executions WHERE account_id IS NULL
  UNION ALL SELECT 'flows',                         count(*) FROM flows                         WHERE account_id IS NULL
  UNION ALL SELECT 'flow_runs',                     count(*) FROM flow_runs                     WHERE account_id IS NULL
  UNION ALL SELECT 'quick_replies',                 count(*) FROM quick_replies                 WHERE account_id IS NULL
  UNION ALL SELECT 'ai_configs',                    count(*) FROM ai_configs                    WHERE account_id IS NULL
  UNION ALL SELECT 'ai_knowledge_documents',        count(*) FROM ai_knowledge_documents        WHERE account_id IS NULL
  UNION ALL SELECT 'ai_knowledge_chunks',           count(*) FROM ai_knowledge_chunks           WHERE account_id IS NULL
  UNION ALL SELECT 'ai_usage_log',                  count(*) FROM ai_usage_log                  WHERE account_id IS NULL
  UNION ALL SELECT 'webhook_endpoints',             count(*) FROM webhook_endpoints             WHERE account_id IS NULL
  UNION ALL SELECT 'api_keys',                      count(*) FROM api_keys                      WHERE account_id IS NULL
  UNION ALL SELECT 'notifications',                 count(*) FROM notifications                 WHERE account_id IS NULL
) t WHERE count > 0;

-- Messages are scoped through their conversation, not an account, so
-- an orphaned message blocks 042's NOT NULL the same way.
SELECT 'messages with no conversation (must be 0)' AS check, count(*)
FROM messages m
LEFT JOIN conversations c ON c.id = m.conversation_id
WHERE c.id IS NULL;

-- ---- 3. Duplicates the new unique indexes would reject -------
-- 042 re-keys three uniqueness rules from the account onto the
-- project. Creating a UNIQUE index fails if the data already violates
-- it. These are the pairs that must be unique afterwards; because
-- every existing row lands in ONE Default project per account, a
-- duplicate here means the OLD account-level index was already
-- violated (possible if it was created before a dedup migration ran).
SELECT 'duplicate (account, contact) conversations (must be 0)' AS check,
       count(*)
FROM (
  SELECT account_id, contact_id
  FROM conversations
  GROUP BY account_id, contact_id
  HAVING count(*) > 1
) d;

SELECT 'duplicate active flow_runs per contact (must be 0)' AS check,
       count(*)
FROM (
  SELECT account_id, contact_id
  FROM flow_runs
  WHERE status = 'active'
  GROUP BY account_id, contact_id
  HAVING count(*) > 1
) d;

SELECT 'accounts with >1 whatsapp_config (must be 0)' AS check, count(*)
FROM (
  SELECT account_id FROM whatsapp_config
  GROUP BY account_id HAVING count(*) > 1
) d;

SELECT 'accounts with >1 ai_config (must be 0)' AS check, count(*)
FROM (
  SELECT account_id FROM ai_configs
  GROUP BY account_id HAVING count(*) > 1
) d;

-- ---- 4. Privileges the script needs -------------------------
-- 044 touches two objects the SQL Editor's role does not always own:
-- the `supabase_realtime` publication and `storage.objects` policies.
-- If either says false, that statement is what aborts the script.
SELECT 'can alter supabase_realtime publication' AS check,
       pg_catalog.pg_get_userbyid(pubowner) = current_user
         OR pg_has_role(current_user, pg_catalog.pg_get_userbyid(pubowner), 'MEMBER') AS result
FROM pg_publication WHERE pubname = 'supabase_realtime';

SELECT 'can create policies on storage.objects' AS check,
       pg_catalog.pg_get_userbyid(relowner) = current_user
         OR pg_has_role(current_user, pg_catalog.pg_get_userbyid(relowner), 'MEMBER') AS result
FROM pg_class WHERE oid = 'storage.objects'::regclass;

SELECT 'running as' AS check, current_user AS result;
