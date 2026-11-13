-- 065_email_recipient_metadata.sql
-- Add JSONB metadata column to email_campaign_recipients to store arbitrary spreadsheet / CSV column values
-- for merge field replacements (e.g. company_name, incorporation_date, login_mail, etc.).

ALTER TABLE public.email_campaign_recipients
ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_email_campaign_recipients_metadata
ON public.email_campaign_recipients USING gin(metadata);

