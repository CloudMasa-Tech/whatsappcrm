// ============================================================
// POST /api/inbox/snooze
// GET /api/inbox/snooze?conversation_id=...
// DELETE /api/inbox/snooze?conversation_id=...
//
// Manages conversation snooze & follow-up reminders.
// ============================================================

import { NextResponse } from "next/server";
import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";

export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const { searchParams } = new URL(request.url);
    const conversationId = searchParams.get("conversation_id");

    if (!conversationId) {
      return NextResponse.json(
        { error: "conversation_id query parameter is required" },
        { status: 400 }
      );
    }

    const client = ctx.supabase;
    const { data: reminder, error } = await client
      .from("conversation_reminders")
      .select("*")
      .eq("conversation_id", conversationId)
      .is("completed_at", null)
      .order("remind_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.warn("[snooze GET] reminder lookup warning:", error.message);
      return NextResponse.json({ reminder: null });
    }

    return NextResponse.json({ reminder: reminder ?? null });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const body = await request.json().catch(() => ({}));

    const conversationId = (body.conversation_id || body.conversationId || "") as string;
    const remindAt = (body.remind_at || body.remindAt || "") as string;
    const note = (body.note || null) as string | null;

    if (!conversationId) {
      return NextResponse.json(
        { error: "conversation_id is required" },
        { status: 400 }
      );
    }

    if (!remindAt || isNaN(Date.parse(remindAt))) {
      return NextResponse.json(
        { error: "Valid remind_at ISO timestamp is required" },
        { status: 400 }
      );
    }

    const client = ctx.supabase;

    // Verify conversation belongs to this account
    const { data: conv, error: convErr } = await client
      .from("conversations")
      .select("id, account_id, project_id")
      .eq("id", conversationId)
      .maybeSingle();

    if (convErr || !conv) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 }
      );
    }

    if (conv.account_id !== ctx.accountId) {
      return NextResponse.json(
        { error: "Conversation not in current account" },
        { status: 403 }
      );
    }

    // Complete any prior incomplete reminders for this conversation
    await client
      .from("conversation_reminders")
      .update({ completed_at: new Date().toISOString() })
      .eq("conversation_id", conversationId)
      .is("completed_at", null);

    // Insert new reminder
    const { data: newReminder, error: insertErr } = await client
      .from("conversation_reminders")
      .insert({
        account_id: ctx.accountId,
        project_id: conv.project_id,
        conversation_id: conversationId,
        user_id: ctx.userId,
        remind_at: new Date(remindAt).toISOString(),
        note,
      })
      .select()
      .single();

    if (insertErr) {
      console.error("[snooze POST] insert error:", insertErr.message);
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

    // Automatically put conversation in 'pending' status
    await client
      .from("conversations")
      .update({
        status: "pending",
        updated_at: new Date().toISOString(),
      })
      .eq("id", conversationId);

    return NextResponse.json({ success: true, reminder: newReminder });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const { searchParams } = new URL(request.url);
    const conversationId = searchParams.get("conversation_id");

    if (!conversationId) {
      return NextResponse.json(
        { error: "conversation_id query parameter is required" },
        { status: 400 }
      );
    }

    const client = ctx.supabase;

    // Verify conversation belongs to account
    const { data: conv, error: convErr } = await client
      .from("conversations")
      .select("id, account_id")
      .eq("id", conversationId)
      .maybeSingle();

    if (convErr || !conv || conv.account_id !== ctx.accountId) {
      return NextResponse.json(
        { error: "Conversation not found or not in account" },
        { status: 404 }
      );
    }

    // Mark active reminders as completed
    await client
      .from("conversation_reminders")
      .update({ completed_at: new Date().toISOString() })
      .eq("conversation_id", conversationId)
      .is("completed_at", null);

    // Restore conversation status to 'open'
    await client
      .from("conversations")
      .update({
        status: "open",
        updated_at: new Date().toISOString(),
      })
      .eq("id", conversationId);

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

