-- ============================================================
-- 052_instagram_integration.sql
--
-- Adds Instagram Direct Messaging support to MaSa CRM:
-- 1. `instagram_config` table for storing both Direct Login sessions
--    and Meta Cloud API credentials.
-- 2. Channel support on `contacts`, `conversations`, and `messages`.
-- ============================================================

-- 1. Create instagram_config table
CREATE TABLE IF NOT EXISTS instagram_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Connection method: 'direct' (username & password) or 'cloud_api' (Meta Graph API)
  connection_method TEXT NOT NULL DEFAULT 'direct' CHECK (connection_method IN ('direct', 'cloud_api')),
  
  -- Direct login credentials / session data (encrypted)
  username TEXT,
  session_data TEXT,
  two_factor_identifier TEXT,
  
  -- Meta Cloud API credentials (encrypted)
  instagram_business_id TEXT,
  page_id TEXT,
  access_token TEXT,
  verify_token TEXT,
  app_secret TEXT,
  
  -- Profile metadata
  name TEXT,
  profile_picture_url TEXT,
  status TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('connected', 'disconnected', '2fa_pending', 'error')),
  last_error TEXT,
  connected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(project_id)
);

CREATE INDEX IF NOT EXISTS idx_instagram_config_project ON instagram_config(project_id);
CREATE INDEX IF NOT EXISTS idx_instagram_config_account ON instagram_config(account_id);

-- Enable RLS
ALTER TABLE instagram_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "instagram_config_select" ON instagram_config;
CREATE POLICY "instagram_config_select" ON instagram_config FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM project_members pm
      WHERE pm.project_id = instagram_config.project_id
        AND pm.user_id = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.user_id = auth.uid()
        AND p.account_id = instagram_config.account_id
        AND p.account_role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "instagram_config_insert" ON instagram_config;
CREATE POLICY "instagram_config_insert" ON instagram_config FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM project_members pm
      WHERE pm.project_id = instagram_config.project_id
        AND pm.user_id = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.user_id = auth.uid()
        AND p.account_id = instagram_config.account_id
        AND p.account_role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "instagram_config_update" ON instagram_config;
CREATE POLICY "instagram_config_update" ON instagram_config FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM project_members pm
      WHERE pm.project_id = instagram_config.project_id
        AND pm.user_id = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.user_id = auth.uid()
        AND p.account_id = instagram_config.account_id
        AND p.account_role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "instagram_config_delete" ON instagram_config;
CREATE POLICY "instagram_config_delete" ON instagram_config FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.user_id = auth.uid()
        AND p.account_id = instagram_config.account_id
        AND p.account_role IN ('owner', 'admin')
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON instagram_config TO authenticated;
GRANT ALL ON instagram_config TO service_role;

-- 2. Extend contacts with Instagram identifiers and channel
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS instagram_id TEXT,
  ADD COLUMN IF NOT EXISTS instagram_username TEXT,
  ADD COLUMN IF NOT EXISTS channel TEXT DEFAULT 'whatsapp';

CREATE INDEX IF NOT EXISTS idx_contacts_instagram_id ON contacts(instagram_id);
CREATE INDEX IF NOT EXISTS idx_contacts_instagram_username ON contacts(instagram_username);

-- 3. Extend conversations with channel
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS channel TEXT DEFAULT 'whatsapp';

CREATE INDEX IF NOT EXISTS idx_conversations_channel ON conversations(channel);

-- 4. Extend messages with channel
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS channel TEXT DEFAULT 'whatsapp';

CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel);
