-- ============================================================
-- 037_fix_table_permissions.sql — restore missing table grants
--                                  on whatsapp_config & accounts
--
-- The problem
--
--   RLS policies gate *which rows* each role may touch, but they
--   only apply once the role already holds the base table-level
--   privileges. This repo's migrations never GRANTed table access
--   (the only table grant anywhere is the notifications.read_at
--   column grant in 027), so any database built purely from these
--   migrations — e.g. a fresh `supabase db reset` — leaves
--   `authenticated` and `service_role` without privileges and every
--   query fails with `42501 permission denied for table`:
--
--     whatsapp_config:   settings page load, GET/POST/DELETE
--                        /api/whatsapp/config, webhook verify
--     accounts:          AuthProvider account lookup, account rename,
--                        default-currency save, api-key owner lookup
--
-- The fix
--
--   Minimum grants for exactly the operations the existing code
--   issues, scoped to the roles the app already uses. RLS stays
--   ENABLED and continues to filter rows for `authenticated`;
--   `service_role` keeps its existing platform-level RLS bypass and
--   is granted only what the server-side pipeline (webhook, send,
--   templates, public API) actually performs.
--
--   GRANT is idempotent — safe to re-run on already-granted DBs.
--
--   Grant matrix (from auditing every .from('whatsapp_config') /
--   .from('accounts') call site):
--
--     whatsapp_config
--       authenticated  SELECT  (page load, GET route, POST pre-check,
--                               inbox, settings overview)
--                      INSERT  (POST save — first config)
--                      UPDATE  (POST save — existing config)
--                      DELETE  (DELETE route — reset config)
--       service_role   SELECT  (webhook verification, send/broadcast/
--                               flow/automation pipelines, POST
--                               ownership check, public API)
--                      UPDATE  (legacy-token GCM self-heal in
--                               send-message + webhook)
--     accounts
--       authenticated  SELECT  (AuthProvider account lookup,
--                               getCurrentAccount)
--                      UPDATE  (account rename, default currency)
--       service_role   SELECT  (api-key owner lookup, automation
--                               engine currency read, public API)
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_config TO authenticated;
GRANT SELECT, UPDATE ON public.whatsapp_config TO service_role;

GRANT SELECT, UPDATE ON public.accounts TO authenticated;
GRANT SELECT ON public.accounts TO service_role;
