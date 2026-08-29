-- ============================================================
-- 059_fix_assignment_notifications.sql
--
-- Fixes conversation assignment notifications so:
-- 1. notify_conversation_assigned() trigger properly copies
--    NEW.project_id to notifications.project_id.
-- 2. RLS policies allow recipients to view their notifications
--    (auth.uid() = user_id AND (project_id IS NULL OR is_project_member(project_id))).
-- 3. Backfills project_id on existing notifications.
-- 4. Ensures notifications table is on the realtime publication.
-- ============================================================

-- 1. Update trigger function with project_id support
CREATE OR REPLACE FUNCTION notify_conversation_assigned()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact_name TEXT;
  v_actor_name TEXT;
  v_project_id UUID;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.assigned_agent_id IS NULL THEN
      RETURN NEW;
    END IF;
  ELSE
    IF NEW.assigned_agent_id IS NULL
       OR NEW.assigned_agent_id IS NOT DISTINCT FROM OLD.assigned_agent_id THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Skip self-assignment — nothing to notify the agent about.
  IF auth.uid() IS NOT NULL AND auth.uid() = NEW.assigned_agent_id THEN
    RETURN NEW;
  END IF;

  -- Resolve contact display name
  SELECT COALESCE(NULLIF(name, ''), phone) INTO v_contact_name
  FROM contacts WHERE id = NEW.contact_id;

  -- Resolve assigning actor's name
  IF auth.uid() IS NOT NULL THEN
    SELECT full_name INTO v_actor_name
    FROM profiles WHERE user_id = auth.uid();
  END IF;

  v_project_id := NEW.project_id;

  INSERT INTO notifications (
    account_id,
    project_id,
    user_id,
    type,
    conversation_id,
    contact_id,
    actor_user_id,
    title,
    body
  ) VALUES (
    NEW.account_id,
    v_project_id,
    NEW.assigned_agent_id,
    'conversation_assigned',
    NEW.id,
    NEW.contact_id,
    auth.uid(),
    'New conversation assigned',
    COALESCE(v_actor_name, 'An administrator') || ' assigned you a conversation with '
      || COALESCE(v_contact_name, 'a contact')
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never let a notification failure block the assignment itself.
  RAISE WARNING 'Failed to create assignment notification for conversation %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION notify_conversation_assigned() OWNER TO postgres;

-- Reattach trigger
DROP TRIGGER IF EXISTS on_conversation_assigned ON conversations;
CREATE TRIGGER on_conversation_assigned
  AFTER INSERT OR UPDATE OF assigned_agent_id ON conversations
  FOR EACH ROW EXECUTE FUNCTION notify_conversation_assigned();

-- 2. Update RLS policies on notifications
DROP POLICY IF EXISTS notifications_select ON notifications;
DROP POLICY IF EXISTS notifications_update ON notifications;

CREATE POLICY notifications_select ON notifications FOR SELECT
  USING (
    auth.uid() = user_id 
    AND (project_id IS NULL OR is_project_member(project_id) OR auth.uid() IN (SELECT user_id FROM profiles WHERE platform_role = 'super_admin'))
  );

CREATE POLICY notifications_update ON notifications FOR UPDATE
  USING (
    auth.uid() = user_id 
    AND (project_id IS NULL OR is_project_member(project_id) OR auth.uid() IN (SELECT user_id FROM profiles WHERE platform_role = 'super_admin'))
  )
  WITH CHECK (
    auth.uid() = user_id 
    AND (project_id IS NULL OR is_project_member(project_id) OR auth.uid() IN (SELECT user_id FROM profiles WHERE platform_role = 'super_admin'))
  );

-- 3. Backfill project_id for notifications missing it
UPDATE notifications n
SET project_id = c.project_id
FROM conversations c
WHERE n.conversation_id = c.id
  AND n.project_id IS NULL;

-- 4. Realtime publication check
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
  END IF;
END;
$$;
