-- ============================================================
-- 038_fix_table_permissions.sql — restore missing table grants
--
-- Context
--
--   The live Supabase project (twpuqntljgavimlocplg) is missing the
--   base table privileges for `authenticated` / `service_role` on
--   `accounts`, `whatsapp_config` and `messages`, producing
--   42501 "permission denied for table" on:
--     - AuthProvider account lookup (accounts)
--     - WhatsApp settings load + save (whatsapp_config)
--     - WhatsApp config validation / ownership check
--     - Dashboard recent-conversation / message reads (messages)
--
--   RLS policies gate *which rows* each role may touch, but a role
--   still needs the base table grant before RLS is even evaluated.
--   These grants only provide that base access; they do NOT bypass
--   or weaken RLS. `authenticated` rows remain filtered by the
--   existing is_account_member() / conversation-scoped policies.
--   `service_role` keeps its existing platform-level RLS bypass and
--   is granted only what the server-side code actually performs.
--
--   GRANT is idempotent — safe to re-run on already-granted DBs.
--
--   NOTE: a previous local file used the 037 version slot, but the
--   remote already recorded 037 as `webhook_broadcast_reliability`,
--   so the grants were never applied live. This migration takes the
--   next free version to guarantee they actually land.
--
-- Required grants (per audit of every .from('...') call site):
--
--     accounts
--       authenticated  SELECT  (AuthProvider account lookup,
--                               getCurrentAccount)
--                      UPDATE  (account rename, default currency)
--       service_role   SELECT  (api-key owner lookup, automation
--                               engine currency read, public API)
--     whatsapp_config
--       authenticated  SELECT  (page load, GET route, POST pre-check)
--                      INSERT  (POST save — first config)
--                      UPDATE  (POST save — existing config)
--                      DELETE  (DELETE route — reset config)
--       service_role   SELECT  (webhook verification, send/broadcast/
--                               flow/automation pipelines, POST
--                               ownership check, public API)
--                      UPDATE  (legacy-token GCM self-heal in
--                               send-message + webhook)
--     messages
--       authenticated  SELECT  (dashboard / inbox reads)
-- ============================================================

GRANT SELECT, UPDATE ON public.accounts TO authenticated;
GRANT SELECT ON public.accounts TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_config TO authenticated;
GRANT SELECT, UPDATE ON public.whatsapp_config TO service_role;

GRANT SELECT ON public.messages TO authenticated;
