-- ============================================================
-- 046_onboarded_customers.sql
--
-- Tracks admin-created customer accounts so the onboarding admin
-- can see who they've created (and revoke access later). The auth
-- user + their own account/Default-project/owner-profile are
-- bootstrapped by the existing `handle_new_user` trigger when the
-- service-role `createUser` call inserts into `auth.users`.
--
-- Policies use a direct `profiles` subquery (mirroring the projects
-- RLS rewrite in the 041-045 tenancy fixes) rather than the
-- `is_account_member` helper, so this table is independent of any
-- helper state.
-- ============================================================

CREATE TABLE IF NOT EXISTS onboarded_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  onboarded_by_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  onboarded_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_onboarded_customers_account
  ON onboarded_customers(onboarded_by_account_id, created_at DESC);

ALTER TABLE onboarded_customers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS onboarded_customers_select ON onboarded_customers;
CREATE POLICY onboarded_customers_select ON onboarded_customers FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.user_id = auth.uid()
        AND p.account_id = onboarded_customers.onboarded_by_account_id
        AND p.account_role IN ('owner','admin')
    )
  );

DROP POLICY IF EXISTS onboarded_customers_insert ON onboarded_customers;
CREATE POLICY onboarded_customers_insert ON onboarded_customers FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.user_id = auth.uid()
        AND p.account_id = onboarded_customers.onboarded_by_account_id
        AND p.account_role IN ('owner','admin')
    )
  );

DROP POLICY IF EXISTS onboarded_customers_delete ON onboarded_customers;
CREATE POLICY onboarded_customers_delete ON onboarded_customers FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.user_id = auth.uid()
        AND p.account_id = onboarded_customers.onboarded_by_account_id
        AND p.account_role = 'owner'
    )
  );

GRANT SELECT, INSERT, DELETE ON onboarded_customers TO authenticated;
GRANT ALL ON onboarded_customers TO service_role;
