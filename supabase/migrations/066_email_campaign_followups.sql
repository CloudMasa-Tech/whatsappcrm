-- ============================================================
-- 066_email_campaign_followups.sql
--
-- Adds support for Campaign Reminders & Follow-up sequences directly
-- inside Email Campaigns:
--   1. parent_campaign_id & is_followup on email_campaigns
--   2. parent_message_id on email_campaign_recipients for threading
--   3. Index for scheduled reminders and fast lookups
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE public.email_campaigns
  ADD COLUMN IF NOT EXISTS parent_campaign_id UUID REFERENCES public.email_campaigns(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_followup BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS followup_type TEXT;

CREATE INDEX IF NOT EXISTS idx_email_campaigns_parent
  ON public.email_campaigns(parent_campaign_id);

CREATE INDEX IF NOT EXISTS idx_email_campaigns_scheduled
  ON public.email_campaigns(status, scheduled_at)
  WHERE status = 'scheduled';

ALTER TABLE public.email_campaign_recipients
  ADD COLUMN IF NOT EXISTS parent_message_id TEXT;

NOTIFY pgrst, 'reload schema';
