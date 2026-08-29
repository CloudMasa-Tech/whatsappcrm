/**
 * Centralized Notification Dispatcher
 *
 * Dispatches in-app notifications to agents/users with Supabase Realtime trigger support.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { NotificationType } from "@/types";

export interface CreateNotificationParams {
  accountId: string;
  projectId?: string;
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  conversationId?: string;
  contactId?: string;
  actorUserId?: string;
}

export async function dispatchNotification(
  db: SupabaseClient,
  params: CreateNotificationParams
): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    const {
      accountId,
      projectId,
      userId,
      type,
      title,
      body,
      conversationId,
      contactId,
      actorUserId,
    } = params;

    const { data, error } = await db
      .from("notifications")
      .insert({
        account_id: accountId,
        project_id: projectId || null,
        user_id: userId,
        type,
        title,
        body: body || null,
        conversation_id: conversationId || null,
        contact_id: contactId || null,
        actor_user_id: actorUserId || null,
      })
      .select("id")
      .single();

    if (error) {
      console.error("[notifications] insert error:", error);
      return { success: false, error: error.message };
    }

    return { success: true, id: data.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown notification error";
    console.error("[notifications] unexpected error:", err);
    return { success: false, error: msg };
  }
}
