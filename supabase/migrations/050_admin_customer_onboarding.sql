-- ============================================================
-- 050 — Admin-driven customer onboarding
--
-- Fixes the onboarding architecture so that when a super_admin
-- creates a customer, the customer lands in the admin's account
-- (not their own isolated account) and is assigned to a specific
-- project via project_members.
--
-- Changes:
--   1. Promote ALL account owners to super_admin (fixes bootstrap
--      for admins created after migration 047)
--   2. Modify handle_new_user() to skip account/project/profile
--      creation when raw_user_meta_data contains
--      created_by_admin = true. The admin API handles profile
--      and project_members creation directly.
-- ============================================================

-- 1. Bootstrap: promote every account owner to super_admin.
--    Migration 047 only promoted the first user by created_at,
--    leaving subsequent owners as 'customer'. This catches them all.
UPDATE profiles
SET    platform_role = 'super_admin'
WHERE  account_role = 'owner'
  AND  platform_role = 'customer';

-- 2. Modify handle_new_user() — skip the self-contained account
--    bootstrap when the user was created by an admin. The admin
--    API sets created_by_admin = true in raw_user_meta_data so
--    the trigger knows to defer to the API for profile + project
--    membership.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_full_name   TEXT;
  v_account_id  UUID;
  v_created_by_admin BOOLEAN;
BEGIN
  v_full_name := COALESCE(
    NEW.raw_user_meta_data ->> 'full_name',
    NEW.raw_user_meta_data ->> 'name',
    ''
  );

  v_created_by_admin := (NEW.raw_user_meta_data ->> 'created_by_admin') = 'true';

  IF v_created_by_admin THEN
    -- Admin-created users: the admin API will handle profile
    -- creation (pointing to the admin's account) and project
    -- membership. Do NOT create an account, project, or profile
    -- here — the trigger is a no-op for this user.
    RETURN NEW;
  END IF;

  -- Self-service signup (should be disabled in production, but
  -- kept for backward compat): create the full self-contained
  -- tenant as before.
  INSERT INTO public.accounts (name, owner_user_id)
  VALUES (COALESCE(NULLIF(v_full_name, ''), NEW.email, 'My account'), NEW.id)
  RETURNING id INTO v_account_id;

  INSERT INTO public.projects (account_id, name, slug, channel_type, allowed_channels)
  VALUES (v_account_id, 'Default', 'default', 'qr', ARRAY['qr', 'cloud_api']::TEXT[])
  ON CONFLICT (account_id, slug) DO NOTHING;

  INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role)
  VALUES (NEW.id, v_full_name, NEW.email, v_account_id, 'owner');

  RETURN NEW;
END;
$$;
