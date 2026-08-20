-- ============================================================
-- 048_guard_platform_role.sql
--
-- Extends the privilege-column trigger from migration 034 to also
-- guard `platform_role`. Without this, an authenticated user can
-- self-promote to super_admin:
--
--   UPDATE profiles SET platform_role = 'super_admin'
--   WHERE user_id = auth.uid();
--
-- The 034 trigger only checks account_role / account_id, so
-- platform_role slips through. This migration adds a third guard.
-- ============================================================

CREATE OR REPLACE FUNCTION public.enforce_profile_privilege_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF (NEW.account_role IS DISTINCT FROM OLD.account_role
      OR NEW.account_id IS DISTINCT FROM OLD.account_id
      OR NEW.platform_role IS DISTINCT FROM OLD.platform_role)
     AND current_user = 'authenticated'
  THEN
    RAISE EXCEPTION
      'account_role, account_id, and platform_role cannot be changed directly; use the account member/invitation RPCs or the admin panel'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

-- Manual validation (for reference):
--   As authenticated role, these must return 42501 (insufficient_privilege):
--     PATCH /rest/v1/profiles?user_id=eq.<self> { "platform_role": "super_admin" }
--     PATCH /rest/v1/profiles?user_id=eq.<self> { "account_role": "owner" }
--   Self-service edits (full_name, avatar_url) must still succeed.
--   The handle_new_user trigger and 018/019 RPCs run as postgres
--   (SECURITY DEFINER), so they are unaffected.
