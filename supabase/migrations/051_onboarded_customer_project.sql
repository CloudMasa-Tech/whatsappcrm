-- ============================================================
-- 051_onboarded_customer_project.sql
--
-- Persist the project selected during admin customer onboarding.
-- The live access grant still lives in project_members; this column
-- is an audit/repair handle so the onboarding list can tell which
-- project a customer was intended to use, and future revoke/reassign
-- flows do not have to infer it from project_members history.
--
-- Existing rows are left NULL because old onboarding records did not
-- store the selected project. Repair them by inserting the appropriate
-- project_members row for the customer/user manually, then optionally
-- backfill this column.
-- ============================================================

ALTER TABLE onboarded_customers
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_onboarded_customers_project
  ON onboarded_customers(project_id);
