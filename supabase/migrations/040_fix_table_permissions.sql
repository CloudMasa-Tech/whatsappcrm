-- ============================================================
-- 040_fix_table_permissions.sql — restore missing table grants
--
-- Context
--
--   The live Supabase project reports 42501 "permission denied for
--   table" for the `authenticated` role on contacts, conversations,
--   member_presence, tags, pipelines, pipeline_stages, api_keys,
--   ai_configs, ai_knowledge_documents, flows and friends. RLS
--   policies gate *which rows* each role may touch, but they are
--   only evaluated once the role holds the base table-level
--   privilege — without the GRANT the first query against each
--   table fails before RLS even runs.
--
--   This migration restores exactly the base privileges the existing
--   application performs, derived from an audit of every
--   `.from('...')` call site:
--
--     - `authenticated` (browser / SSR RLS clients, anon-key with a
--       signed-in session): the same operation set the existing RLS
--       policies in migrations 017 / 024 / 026 / 028 / 029 / 030 /
--       033 / 035 already allow. Adding the GRANT does NOT broaden
--       RLS — row filtering stays intact (is_account_member() /
--       auth.uid() policies), it only unblocks the queries.
--
--     - `service_role` (webhook, flows/automations engines, cron,
--       broadcast engine, public API v1 auth path): the exact
--       read/write surface those server-side pipelines execute.
--       service_role keeps its existing platform-level RLS bypass;
--       these grants give it the base privileges for the tables the
--       server-side code actually touches.
--
--   GRANT is idempotent — safe to re-run on already-granted DBs, so
--   this also re-affirms the tables covered by the earlier ad-hoc
--   037 / 038 / 039 fixes without relying on their remote content.
--
--   No RLS policy is created, dropped or weakened here. No table
--   becomes public: `authenticated` rows remain filtered by the
--   existing account-scoped policies, and `api_keys` / `ai_configs`
--   (sensitive) are only reachable through their existing
--   is_account_member() policies.
--
--   `notifications` gets only SELECT here: its UPDATE path was
--   deliberately column-scoped in 027 (GRANT UPDATE (read_at) /
--   REVOKE UPDATE) and that grant is preserved untouched.
--
--   `automation_pending_executions` and `ai_usage_log` get NO
--   authenticated grants: the former has no client policies
--   (service-role only) and the latter is insert-only from the
--   service role with an admin+ SELECT policy — those tables are
--   handled below under service_role (ai_usage_log) and
--   authenticated (ai_usage_log SELECT is granted because the
--   usage route reads it under the RLS client).
--
-- ============================================================

-- ============================================================
-- AUTHENTICATED — client-side RLS clients
-- (operation set mirrors the existing RLS policy tiers)
-- ============================================================

-- Operational data (viewer: SELECT; agent+: write) — 017
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contacts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contact_notes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contact_tags TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contact_custom_values TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.deals TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.broadcasts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.broadcast_recipients TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.automations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.automation_steps TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.flows TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.flow_nodes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.message_reactions TO authenticated;

-- Settings-class (viewer: SELECT; admin+: write) — 017
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tags TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.custom_fields TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_config TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.message_templates TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pipelines TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pipeline_stages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.account_invitations TO authenticated;

-- Read-only surfaces (017) — SELECT only
GRANT SELECT ON public.automation_logs TO authenticated;
GRANT SELECT ON public.flow_runs TO authenticated;
GRANT SELECT ON public.flow_run_events TO authenticated;
GRANT SELECT, UPDATE ON public.accounts TO authenticated;

-- Profiles — self-owned write, account-readable (017)
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;

-- Member presence (024) — SELECT via the client; writes go through
-- the touch_presence() SECURITY DEFINER RPC.
GRANT SELECT ON public.member_presence TO authenticated;

-- API keys (026) — account-scoped SELECT (viewer) + admin write.
-- NOT public: RLS api_keys_select / api_keys_insert / update /
-- delete keep every row inside the caller's account.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.api_keys TO authenticated;

-- Outbound webhook endpoints (028)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.webhook_endpoints TO authenticated;

-- AI config (029) — account-scoped settings-class
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_configs TO authenticated;

-- AI knowledge base (030) — account-scoped settings-class
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_knowledge_documents TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_knowledge_chunks TO authenticated;

-- AI usage log (033) — admin+ SELECT only (spend visibility)
GRANT SELECT ON public.ai_usage_log TO authenticated;

-- Quick replies (035) — account-scoped, agent+ write
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quick_replies TO authenticated;

-- Notifications (027) — SELECT; UPDATE stays column-scoped (read_at)
GRANT SELECT ON public.notifications TO authenticated;

-- ============================================================
-- SERVICE_ROLE — server-side pipelines (RLS bypassed)
-- ============================================================

-- Inbound webhook + engines + send paths (find-or-create / status
-- updates / message inserts)
GRANT SELECT, INSERT, UPDATE ON public.contacts TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.conversations TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.messages TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.message_reactions TO service_role;
GRANT SELECT, UPDATE ON public.whatsapp_config TO service_role;
GRANT SELECT ON public.message_templates TO service_role;
GRANT SELECT ON public.accounts TO service_role;
GRANT SELECT, UPDATE ON public.api_keys TO service_role;
GRANT SELECT, UPDATE ON public.webhook_endpoints TO service_role;
GRANT SELECT, INSERT, DELETE ON public.contact_tags TO service_role;
GRANT SELECT, INSERT ON public.tags TO service_role;
GRANT SELECT ON public.profiles TO service_role;

-- Flows engine + cron + routes
GRANT SELECT, INSERT, UPDATE, DELETE ON public.flows TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.flow_nodes TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.flow_runs TO service_role;
GRANT SELECT, INSERT ON public.flow_run_events TO service_role;

-- Automations engine + cron + routes
GRANT SELECT, INSERT, UPDATE, DELETE ON public.automations TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.automation_steps TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.automation_logs TO service_role;
GRANT SELECT, INSERT, DELETE ON public.automation_pending_executions TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.deals TO service_role;
GRANT SELECT, INSERT ON public.custom_fields TO service_role;
GRANT SELECT, INSERT ON public.contact_custom_values TO service_role;

-- Broadcast engine
GRANT SELECT, INSERT, UPDATE ON public.broadcasts TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.broadcast_recipients TO service_role;

-- AI auto-reply + usage + knowledge retrieval
GRANT SELECT ON public.ai_configs TO service_role;
GRANT SELECT ON public.ai_knowledge_chunks TO service_role;
GRANT INSERT ON public.ai_usage_log TO service_role;
