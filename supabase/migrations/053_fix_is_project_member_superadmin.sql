-- ============================================================
-- 053_fix_is_project_member_superadmin.sql
--
-- Update is_project_member() so that:
-- 1. Super Admins (platform_role = 'super_admin') have full access to
--    all projects across the platform without RLS violations.
-- 2. Project Admins (account_role IN ('admin', 'owner') OR role = 'admin')
--    can create and manage pipelines, stages, and settings.
-- ============================================================

CREATE OR REPLACE FUNCTION is_project_member(
  target_project_id UUID,
  min_role account_role_enum DEFAULT 'viewer'
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM profiles p
    LEFT JOIN projects pr ON pr.id = target_project_id
    WHERE p.user_id = auth.uid()
      AND (
        -- Super admin has platform-wide access to any project
        p.platform_role = 'super_admin'
        -- Or user belongs to the project's account and has sufficient privileges
        OR (
          pr.id IS NOT NULL
          AND p.account_id = pr.account_id
          AND (
            role_rank(p.account_role) >= role_rank(min_role)
            OR (min_role = 'admin' AND p.role = 'admin')
          )
          AND (
            role_rank(p.account_role) >= role_rank('admin')
            OR p.role = 'admin'
            OR EXISTS (
              SELECT 1 FROM project_members pm
              WHERE pm.project_id = pr.id
                AND pm.user_id = p.user_id
            )
          )
          -- Archived → viewer-level (read) only.
          AND (pr.archived_at IS NULL OR role_rank(min_role) <= role_rank('viewer'))
        )
      )
  );
$$;

ALTER FUNCTION is_project_member(UUID, account_role_enum) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION is_project_member(UUID, account_role_enum)
  TO authenticated, service_role;
