import type { SupabaseClient } from "@supabase/supabase-js";
import { dispatchNotification } from "@/lib/notifications/dispatch";

/**
 * Checks for any due reminders across conversations, marks them complete,
 * restores conversation status to 'open', and notifies the agent.
 */
export async function processDueReminders(db: SupabaseClient): Promise<number> {
  const nowIso = new Date().toISOString();

  // Find due reminders that haven't been completed yet
  const { data: dueReminders, error } = await db
    .from("conversation_reminders")
    .select("id, account_id, project_id, conversation_id, user_id, note")
    .is("completed_at", null)
    .lte("remind_at", nowIso)
    .limit(50);

  if (error || !dueReminders || dueReminders.length === 0) {
    return 0;
  }

  let processedCount = 0;

  for (const r of dueReminders) {
    try {
      // 1. Mark completed
      await db
        .from("conversation_reminders")
        .update({ completed_at: nowIso })
        .eq("id", r.id);

      // 2. Fetch conversation contact info for a friendly notification
      const { data: conv } = await db
        .from("conversations")
        .select("id, status, contact:contacts(name, phone)")
        .eq("id", r.conversation_id)
        .maybeSingle();

      // 3. Restore conversation status to 'open'
      await db
        .from("conversations")
        .update({ status: "open", updated_at: nowIso })
        .eq("id", r.conversation_id);

      // 4. Dispatch notification to agent
      const contactObj = conv?.contact as { name?: string; phone?: string } | null;
      const contactName = contactObj?.name || contactObj?.phone || "Customer";

      await dispatchNotification(db, {
        accountId: r.account_id,
        projectId: r.project_id || undefined,
        userId: r.user_id,
        type: "snooze_reminder",
        title: `Reminder: Follow up with ${contactName}`,
        body: r.note || "Snooze duration ended. Chat reopened in Inbox.",
        conversationId: r.conversation_id,
      });

      processedCount++;
    } catch (err) {
      console.error("[reminders] error processing due reminder:", r.id, err);
    }
  }

  return processedCount;
}
