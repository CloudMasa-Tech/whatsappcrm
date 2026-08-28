-- ==============================================================================
-- 056: Email Server Configuration & Email Campaign Infrastructure
-- ==============================================================================

-- 1. email_configs: stores SMTP / mail settings per account or project
CREATE TABLE IF NOT EXISTS public.email_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
    smtp_host TEXT NOT NULL,
    smtp_port INTEGER NOT NULL DEFAULT 587,
    smtp_secure BOOLEAN NOT NULL DEFAULT false,
    smtp_user TEXT NOT NULL,
    smtp_pass TEXT NOT NULL,
    from_name TEXT NOT NULL DEFAULT 'MaSa CRM',
    from_email TEXT NOT NULL,
    reply_to TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (account_id, project_id)
);

-- Index for speedy lookups
CREATE INDEX IF NOT EXISTS idx_email_configs_project ON public.email_configs(project_id);
CREATE INDEX IF NOT EXISTS idx_email_configs_account ON public.email_configs(account_id);

-- Enable RLS
ALTER TABLE public.email_configs ENABLE ROW LEVEL SECURITY;

-- Policy: Account members can view and manage their email configs
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'email_configs' AND policyname = 'account_members_manage_email_configs'
    ) THEN
        CREATE POLICY account_members_manage_email_configs ON public.email_configs
            FOR ALL
            TO authenticated
            USING (
                account_id IN (
                    SELECT account_id FROM public.profiles WHERE user_id = auth.uid()
                )
            )
            WITH CHECK (
                account_id IN (
                    SELECT account_id FROM public.profiles WHERE user_id = auth.uid()
                )
            );
    END IF;
END $$;

-- 2. email_campaigns: stores bulk email broadcasts
CREATE TABLE IF NOT EXISTS public.email_campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    subject TEXT NOT NULL,
    body_html TEXT NOT NULL,
    body_text TEXT,
    from_name TEXT,
    from_email TEXT,
    reply_to TEXT,
    status TEXT NOT NULL DEFAULT 'draft', -- 'draft', 'scheduled', 'sending', 'sent', 'failed'
    total_recipients INTEGER NOT NULL DEFAULT 0,
    sent_count INTEGER NOT NULL DEFAULT 0,
    delivered_count INTEGER NOT NULL DEFAULT 0,
    opened_count INTEGER NOT NULL DEFAULT 0,
    clicked_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    audience_filter JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_campaigns_project ON public.email_campaigns(project_id);
CREATE INDEX IF NOT EXISTS idx_email_campaigns_account ON public.email_campaigns(account_id);

ALTER TABLE public.email_campaigns ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'email_campaigns' AND policyname = 'account_members_manage_email_campaigns'
    ) THEN
        CREATE POLICY account_members_manage_email_campaigns ON public.email_campaigns
            FOR ALL
            TO authenticated
            USING (
                account_id IN (
                    SELECT account_id FROM public.profiles WHERE user_id = auth.uid()
                )
            )
            WITH CHECK (
                account_id IN (
                    SELECT account_id FROM public.profiles WHERE user_id = auth.uid()
                )
            );
    END IF;
END $$;

-- 3. email_campaign_recipients: track per-recipient delivery
CREATE TABLE IF NOT EXISTS public.email_campaign_recipients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES public.email_campaigns(id) ON DELETE CASCADE,
    contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
    email TEXT NOT NULL,
    name TEXT,
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'sent', 'delivered', 'opened', 'failed'
    error_message TEXT,
    message_id TEXT,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_campaign_recipients_campaign ON public.email_campaign_recipients(campaign_id);
CREATE INDEX IF NOT EXISTS idx_email_campaign_recipients_email ON public.email_campaign_recipients(email);

ALTER TABLE public.email_campaign_recipients ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'email_campaign_recipients' AND policyname = 'account_members_manage_email_recipients'
    ) THEN
        CREATE POLICY account_members_manage_email_recipients ON public.email_campaign_recipients
            FOR ALL
            TO authenticated
            USING (
                campaign_id IN (
                    SELECT id FROM public.email_campaigns WHERE account_id IN (
                        SELECT account_id FROM public.profiles WHERE user_id = auth.uid()
                    )
                )
            );
    END IF;
END $$;

-- 4. Grant Full Permissions to service_role and authenticated
GRANT ALL ON TABLE public.email_configs TO service_role, postgres, authenticated;
GRANT ALL ON TABLE public.email_campaigns TO service_role, postgres, authenticated;
GRANT ALL ON TABLE public.email_campaign_recipients TO service_role, postgres, authenticated;
