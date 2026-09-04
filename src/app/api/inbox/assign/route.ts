// ============================================================
// POST /api/inbox/assign
//
// Assigns or unassigns a conversation to an agent, and guarantees
// the recipient agent receives a realtime notification.
// ============================================================

import { NextResponse } from "next/server";
import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { canManageMembers } from "@/lib/auth/roles";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { dispatchNotification } from "@/lib/notifications/dispatch";

export async function POST(request: Request) {
  try {
    const ctx = await getCurrentAccount();

    const body = await request.json().catch(() => ({}));
    const conversation_id = (body.conversation_id || body.conversationId || "") as string;
    const agent_id = body.agent_id !== undefined ? body.agent_id : body.agentId;
    const newAgentId = agent_id || null;

    // Admins can assign to anyone; agents can self-claim (assign to themselves)
    const isSelfClaim = newAgentId === ctx.userId;
    const isAllowed = canManageMembers(ctx.role) || ctx.platformRole === "super_admin" || isSelfClaim;
    if (!isAllowed) {
      return NextResponse.json(
        { error: "Only administrators can assign conversations to other agents" },
        { status: 403 }
      );
    }

    if (!conversation_id) {
      return NextResponse.json(
        { error: "conversation_id is required" },
        { status: 400 }
      );
    }

    const admin = supabaseAdmin();

    // 1. Fetch the conversation to ensure it exists and get contact/project context
    const { data: conv, error: convErr } = await admin
      .from("conversations")
      .select("id, account_id, project_id, contact_id, assigned_agent_id")
      .eq("id", conversation_id)
      .maybeSingle();

    if (convErr || !conv) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 }
      );
    }

    // Tenant isolation check
    if (conv.account_id !== ctx.accountId) {
      return NextResponse.json(
        { error: "Conversation not in current account" },
        { status: 403 }
      );
    }

    // 2. Update conversation assigned_agent_id
    const { error: updateErr } = await admin
      .from("conversations")
      .update({ assigned_agent_id: newAgentId })
      .eq("id", conversation_id);

    if (updateErr) {
      console.error("[POST /api/inbox/assign] update error:", updateErr);
      return NextResponse.json(
        { error: "Failed to update conversation assignment" },
        { status: 500 }
      );
    }

    // 3. If assigned to a teammate (and not self-assigned), create notification
    if (newAgentId && newAgentId !== ctx.userId) {
      // Resolve contact display name
      let contactName = "a customer";
      if (conv.contact_id) {
        const { data: contact } = await admin
          .from("contacts")
          .select("name, phone")
          .eq("id", conv.contact_id)
          .single();
        if (contact) {
          contactName = contact.name || contact.phone || "a customer";
        }
      }

      // Resolve assigner full name
      let assignerName = "An administrator";
      const { data: profile } = await admin
        .from("profiles")
        .select("full_name")
        .eq("user_id", ctx.userId)
        .single();
      if (profile?.full_name) {
        assignerName = profile.full_name;
      }

      // Dispatch notification
      await dispatchNotification(admin, {
        accountId: conv.account_id,
        projectId: conv.project_id,
        userId: newAgentId,
        type: "conversation_assigned",
        conversationId: conv.id,
        contactId: conv.contact_id,
        actorUserId: ctx.userId,
        title: "New conversation assigned",
        body: `${assignerName} assigned you a conversation with ${contactName}`,
      });
    }

    return NextResponse.json({
      success: true,
      conversation_id: conv.id,
      assigned_agent_id: newAgentId,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
