-- ============================================================
-- 049 — allowed_channels on projects
--
-- Adds a TEXT[] column that stores which WhatsApp connection
-- methods are ENABLED for a project. The existing `channel_type`
-- column remains untouched as the "active/primary" channel for
-- backward compatibility with sending logic.
--
-- Backfill: each project keeps only its current channel_type
-- as the sole allowed method. This prevents unexpectedly
-- enabling both methods for existing customers.
-- ============================================================

-- 1. Add the column (nullable first for safe backfill)
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS allowed_channels TEXT[];

-- 2. Backfill from channel_type — each project keeps its own
--    current method only. No cross-enabling.
UPDATE projects
SET    allowed_channels = ARRAY[channel_type]::TEXT[]
WHERE  allowed_channels IS NULL;

-- 3. Set NOT NULL + default now that every existing row has a value.
--    New projects created by handle_new_user() or the API will
--    get this default; the API can override it.
ALTER TABLE projects
  ALTER COLUMN allowed_channels SET NOT NULL;

ALTER TABLE projects
  ALTER COLUMN allowed_channels SET DEFAULT ARRAY['qr']::TEXT[];

-- 4. Validate: only 'qr' and 'cloud_api' may appear in the array.
--
-- Guarded: ADD CONSTRAINT has no IF NOT EXISTS, so re-running this
-- migration (which the other files here are all safe to do) aborted
-- with "constraint already exists".
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'allowed_channels_check'
       AND conrelid = 'public.projects'::regclass
  ) THEN
    ALTER TABLE projects
      ADD CONSTRAINT allowed_channels_check
      CHECK (
        allowed_channels <@ ARRAY['qr', 'cloud_api']::TEXT[]
      );
  END IF;
END $$;

-- 5. Update the handle_new_user() trigger so new signups also
--    get allowed_channels. The trigger runs as SECURITY DEFINER
--    so it bypasses RLS.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
  v_full_name   TEXT;
BEGIN
  v_full_name := COALESCE(
    NEW.raw_user_meta_data ->> 'full_name',
    NEW.raw_user_meta_data ->> 'name',
    ''
  );

  -- 1. Create account
  INSERT INTO public.accounts (name, owner_user_id)
  VALUES (COALESCE(NULLIF(v_full_name, ''), NEW.email, 'My account'), NEW.id)
  RETURNING id INTO v_account_id;

  -- 2. Create default project (QR channel, both methods allowed)
  INSERT INTO public.projects (account_id, name, slug, channel_type, allowed_channels)
  VALUES (v_account_id, 'Default', 'default', 'qr', ARRAY['qr', 'cloud_api']::TEXT[])
  ON CONFLICT (account_id, slug) DO NOTHING;

  -- 3. Create owner profile
  INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role)
  VALUES (NEW.id, v_full_name, NEW.email, v_account_id, 'owner');

  RETURN NEW;
END;
$$;

-- 6. Grant SELECT on allowed_channels to authenticated (already
--    covered by the projects SELECT grant, but explicit is safe).
