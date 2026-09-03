-- Migration 058: Designate and protect the SuperAdmin-created default project administrator
--
-- Adds is_default_admin column to profiles (if not present) and ensures
-- default administrators created by SuperAdmin have is_default_admin = true
-- and 'default_admin' in beta_features.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'is_default_admin'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN is_default_admin BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;
END $$;

-- Mark Keerthana (primary project administrator for cloudmasa) as default admin
UPDATE public.profiles
SET is_default_admin = TRUE,
    beta_features = array_append(COALESCE(beta_features, '{}'::text[]), 'default_admin')
WHERE user_id = '1fde628b-650c-401b-bd55-f7aab8cdb4d6'
  AND NOT ('default_admin' = ANY(COALESCE(beta_features, '{}'::text[])));

-- Mark Jagadeesh (admin for the second project) as default admin
UPDATE public.profiles
SET is_default_admin = TRUE,
    beta_features = array_append(COALESCE(beta_features, '{}'::text[]), 'default_admin')
WHERE user_id = 'cb0bc9b5-93a6-4610-bdca-2b36ae434f47'
  AND NOT ('default_admin' = ANY(COALESCE(beta_features, '{}'::text[])));
