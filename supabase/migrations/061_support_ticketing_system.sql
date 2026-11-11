-- 061_support_ticketing_system.sql
-- Enterprise Support Ticketing System for CloudMaSa CRM
-- Automatically dispatches notifications to Super Admin (info@cloudmasa.com)

-- 1. Create sequence for human-readable ticket numbers
CREATE SEQUENCE IF NOT EXISTS ticket_number_seq START 1001;

-- 2. Create tickets table
CREATE TABLE IF NOT EXISTS public.tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number TEXT UNIQUE NOT NULL,
  account_id UUID REFERENCES public.accounts(id) ON DELETE CASCADE,
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_name TEXT,
  created_by_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'technical'
    CHECK (category IN ('technical', 'whatsapp_gateway', 'bug_report', 'billing', 'feature_request', 'account_access', 'other')),
  priority TEXT NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  attachment_urls TEXT[] DEFAULT '{}'::TEXT[],
  resolution_notes TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Create ticket_replies table
CREATE TABLE IF NOT EXISTS public.ticket_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  user_name TEXT,
  user_email TEXT NOT NULL,
  user_role TEXT DEFAULT 'agent',
  message TEXT NOT NULL,
  is_internal BOOLEAN DEFAULT false,
  attachment_urls TEXT[] DEFAULT '{}'::TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Auto-generate ticket number trigger function
CREATE OR REPLACE FUNCTION public.generate_ticket_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.ticket_number IS NULL OR NEW.ticket_number = '' THEN
    NEW.ticket_number := 'TCK-' || LPAD(nextval('ticket_number_seq')::text, 5, '0');
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_generate_ticket_number ON public.tickets;
CREATE TRIGGER trg_generate_ticket_number
  BEFORE INSERT ON public.tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.generate_ticket_number();

-- 5. Trigger to update updated_at on ticket updates
CREATE OR REPLACE FUNCTION public.update_ticket_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  IF NEW.status = 'resolved' AND OLD.status != 'resolved' AND NEW.resolved_at IS NULL THEN
    NEW.resolved_at := NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_ticket_timestamp ON public.tickets;
CREATE TRIGGER trg_update_ticket_timestamp
  BEFORE UPDATE ON public.tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.update_ticket_timestamp();

-- 6. Indexes for high performance querying
CREATE INDEX IF NOT EXISTS idx_tickets_project_id ON public.tickets(project_id);
CREATE INDEX IF NOT EXISTS idx_tickets_account_id ON public.tickets(account_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON public.tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_priority ON public.tickets(priority);
CREATE INDEX IF NOT EXISTS idx_tickets_created_at ON public.tickets(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ticket_replies_ticket_id ON public.ticket_replies(ticket_id, created_at ASC);

-- 7. Enable Row Level Security (RLS)
ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_replies ENABLE ROW LEVEL SECURITY;

-- 8. RLS Policies for tickets
DROP POLICY IF EXISTS "Super admins can manage all tickets" ON public.tickets;
CREATE POLICY "Super admins can manage all tickets" ON public.tickets
  FOR ALL USING (
    is_super_admin()
  );

DROP POLICY IF EXISTS "Account members can view project tickets" ON public.tickets;
CREATE POLICY "Account members can view project tickets" ON public.tickets
  FOR SELECT USING (
    created_by = auth.uid()
    OR is_super_admin()
    OR (project_id IS NOT NULL AND is_project_member(project_id, 'viewer'))
  );

DROP POLICY IF EXISTS "Users can insert tickets" ON public.tickets;
CREATE POLICY "Users can insert tickets" ON public.tickets
  FOR INSERT WITH CHECK (
    auth.uid() IS NOT NULL
  );

DROP POLICY IF EXISTS "Users can update their own tickets or project members" ON public.tickets;
CREATE POLICY "Users can update their own tickets or project members" ON public.tickets
  FOR UPDATE USING (
    created_by = auth.uid()
    OR is_super_admin()
    OR (project_id IS NOT NULL AND is_project_member(project_id, 'admin'))
  );

-- 9. RLS Policies for ticket_replies
DROP POLICY IF EXISTS "Super admins can manage all replies" ON public.ticket_replies;
CREATE POLICY "Super admins can manage all replies" ON public.ticket_replies
  FOR ALL USING (
    is_super_admin()
  );

DROP POLICY IF EXISTS "Users can view non-internal replies for their tickets" ON public.ticket_replies;
CREATE POLICY "Users can view non-internal replies for their tickets" ON public.ticket_replies
  FOR SELECT USING (
    is_super_admin()
    OR (
      ticket_id IN (
        SELECT id FROM public.tickets
        WHERE created_by = auth.uid()
           OR (project_id IS NOT NULL AND is_project_member(project_id, 'viewer'))
      )
      AND is_internal = false
    )
  );

DROP POLICY IF EXISTS "Users can insert replies on their tickets" ON public.ticket_replies;
CREATE POLICY "Users can insert replies on their tickets" ON public.ticket_replies
  FOR INSERT WITH CHECK (
    auth.uid() IS NOT NULL
    AND (
      is_super_admin()
      OR ticket_id IN (
        SELECT id FROM public.tickets
        WHERE created_by = auth.uid()
           OR (project_id IS NOT NULL AND is_project_member(project_id, 'viewer'))
      )
    )
  );

-- 10. Grant table access to authenticated users and service_role
GRANT ALL ON public.tickets TO service_role, authenticated;
GRANT ALL ON public.ticket_replies TO service_role, authenticated;
GRANT USAGE, SELECT ON SEQUENCE ticket_number_seq TO service_role, authenticated;

