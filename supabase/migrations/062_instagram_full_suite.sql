-- ============================================================
-- 062_instagram_full_suite.sql
--
-- Upgrades Instagram integration for:
--   1. Dual Meta Key support ('facebook_page' EAAB... and 'instagram_login' IGA...)
--   2. Stored profile metrics, granted scopes, and comment auto-reply / private DM rules
--   3. Project-level composite FK + strict is_project_member() RLS on instagram_config
--   4. Multi-channel conversations unique key (project_id, contact_id, channel)
--      so WhatsApp and Instagram threads for the same CRM contact never collide
--   5. Project-scoped unique indexes for contacts.instagram_id and instagram_username
-- ============================================================

-- 1. Extend instagram_config with full app capabilities & metadata
ALTER TABLE instagram_config
  ADD COLUMN IF NOT EXISTS token_type TEXT DEFAULT 'facebook_page',
  ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS biography TEXT,
  ADD COLUMN IF NOT EXISTS website TEXT,
  ADD COLUMN IF NOT EXISTS followers_count INTEGER,
  ADD COLUMN IF NOT EXISTS following_count INTEGER,
  ADD COLUMN IF NOT EXISTS media_count INTEGER,
  ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS granted_scopes TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS comment_auto_reply_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS comment_auto_reply_keyword TEXT,
  ADD COLUMN IF NOT EXISTS comment_auto_reply_message TEXT,
  ADD COLUMN IF NOT EXISTS comment_auto_dm_message TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'instagram_config_token_type_check'
  ) THEN
    ALTER TABLE instagram_config
      ADD CONSTRAINT instagram_config_token_type_check
      CHECK (token_type IN ('facebook_page', 'instagram_login'));
  END IF;
END $$;

-- 2. Enforce composite project+account foreign key matching other project-scoped tables
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'instagram_config_project_account_fkey'
  ) THEN
    ALTER TABLE instagram_config
      ADD CONSTRAINT instagram_config_project_account_fkey
      FOREIGN KEY (project_id, account_id)
      REFERENCES projects(id, account_id)
      ON DELETE CASCADE;
  END IF;
EXCEPTION
  WHEN others THEN
    RAISE NOTICE 'Skipping composite FK due to existing mismatched rows: %', SQLERRM;
END $$;

-- 3. Lookup indexes for webhook routing
CREATE INDEX IF NOT EXISTS idx_instagram_config_ig_biz_id
  ON instagram_config(instagram_business_id)
  WHERE instagram_business_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_instagram_config_page_id
  ON instagram_config(page_id)
  WHERE page_id IS NOT NULL;

-- 4. Tighten RLS on instagram_config using canonical is_project_member()
DROP POLICY IF EXISTS "instagram_config_select" ON instagram_config;
CREATE POLICY "instagram_config_select" ON instagram_config
  FOR SELECT
  USING (is_project_member(project_id, 'viewer'));

DROP POLICY IF EXISTS "instagram_config_insert" ON instagram_config;
CREATE POLICY "instagram_config_insert" ON instagram_config
  FOR INSERT
  WITH CHECK (is_project_member(project_id, 'admin'));

DROP POLICY IF EXISTS "instagram_config_update" ON instagram_config;
CREATE POLICY "instagram_config_update" ON instagram_config
  FOR UPDATE
  USING (is_project_member(project_id, 'admin'))
  WITH CHECK (is_project_member(project_id, 'admin'));

DROP POLICY IF EXISTS "instagram_config_delete" ON instagram_config;
CREATE POLICY "instagram_config_delete" ON instagram_config
  FOR DELETE
  USING (is_project_member(project_id, 'admin'));

-- 5. Fix conversations uniqueness to allow one thread per (project, contact, channel)
-- WhatsApp threads all use channel = 'whatsapp', preserving 1:1 WhatsApp behavior.
UPDATE conversations
  SET channel = 'whatsapp'
  WHERE channel IS NULL;

DROP INDEX IF EXISTS idx_conversations_project_contact;
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_project_contact_channel
  ON conversations (project_id, contact_id, channel);

-- 6. Deduplicate existing Instagram contacts (if any) before adding partial unique indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_project_instagram_id
  ON contacts (project_id, instagram_id)
  WHERE instagram_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_project_instagram_username_ci
  ON contacts (project_id, lower(instagram_username))
  WHERE instagram_username IS NOT NULL;

