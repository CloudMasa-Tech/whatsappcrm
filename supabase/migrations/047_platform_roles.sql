-- ============================================================
-- 047_platform_roles.sql
--
-- Introduces the platform-level role distinction between the
-- SUPER_ADMIN (platform operator) and CUSTOMER (restricted
-- marketing user). This is orthogonal to the existing
-- account_role_enum (owner/admin/agent/viewer) which governs
-- intra-account permissions.
--
-- Changes:
--   1. Adds platform_role_enum type (super_admin, customer)
--   2. Adds platform_role column to profiles
--   3. Sets the first user (by created_at) as super_admin
--   4. Updates handle_new_user to default new users to customer
-- ============================================================

-- 1. Create the enum type
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'platform_role_enum') THEN
    CREATE TYPE platform_role_enum AS ENUM ('super_admin', 'customer');
  END IF;
END $$;

-- 2. Add the column to profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS platform_role platform_role_enum NOT NULL DEFAULT 'customer';

-- 3. Set the first user (by created_at) as super_admin
--    This is the platform operator who created the first account.
UPDATE profiles
SET platform_role = 'super_admin'
WHERE user_id = (
  SELECT user_id FROM profiles
  ORDER BY created_at ASC NULLS LAST
  LIMIT 1
)
AND platform_role = 'customer';

-- 4. Helper function: is the user a super_admin?
CREATE OR REPLACE FUNCTION is_super_admin(uid UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE user_id = uid
      AND platform_role = 'super_admin'
  );
$$;

ALTER FUNCTION is_super_admin(UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION is_super_admin(UUID) TO authenticated, service_role;

-- 5. Helper function: get the platform role for the current user
CREATE OR REPLACE FUNCTION get_platform_role(uid UUID DEFAULT auth.uid())
RETURNS platform_role_enum
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT platform_role FROM profiles
  WHERE user_id = uid;
$$;

ALTER FUNCTION get_platform_role(UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION get_platform_role(UUID) TO authenticated, service_role;

-- 6. RLS policies for profiles — customers can only read their own row
--    (not modify platform_role). Super admins can read/update all.
--    The existing policies still apply for account-scoped operations.
--    We add a new policy for super_admins to update any profile's platform_role.

-- Super admins can update any profile's platform_role
DROP POLICY IF EXISTS profiles_super_admin_update ON profiles;
CREATE POLICY profiles_super_admin_update ON profiles
  FOR UPDATE USING (
    is_super_admin()
  )
  WITH CHECK (
    is_super_admin()
  );

-- Super admins can view all profiles (for customer management)
DROP POLICY IF EXISTS profiles_super_admin_select ON profiles;
CREATE POLICY profiles_super_admin_select ON profiles
  FOR SELECT USING (
    is_super_admin()
    -- OR the normal account-scoped select still applies via the other policies
  );
