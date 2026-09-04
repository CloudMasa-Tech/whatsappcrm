-- 060_expand_notifications_and_reminders.sql
-- 1. Expand notification types
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check 
  CHECK (type IN ('conversation_assigned', 'new_message', 'snooze_reminder'));

-- 2. Conversation reminders for chat snooze
CREATE TABLE IF NOT EXISTS conversation_reminders (
  id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  remind_at TIMESTAMPTZ NOT NULL,
  note TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reminders_user_pending 
  ON conversation_reminders(user_id, remind_at) 
  WHERE completed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_reminders_conversation 
  ON conversation_reminders(conversation_id);

ALTER TABLE conversation_reminders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view reminders" ON conversation_reminders;
CREATE POLICY "Members can view reminders" ON conversation_reminders FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS "Members can create reminders" ON conversation_reminders;
CREATE POLICY "Members can create reminders" ON conversation_reminders FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS "Members can update reminders" ON conversation_reminders;
CREATE POLICY "Members can update reminders" ON conversation_reminders FOR UPDATE
  USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS "Members can delete reminders" ON conversation_reminders;
CREATE POLICY "Members can delete reminders" ON conversation_reminders FOR DELETE
  USING (is_account_member(account_id, 'agent'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversation_reminders TO authenticated;
