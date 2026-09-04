import { NextResponse } from "next/server";
import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { processDueReminders } from "@/lib/inbox/reminders";

export async function POST() {
  try {
    const ctx = await getCurrentAccount();
    const client = ctx.supabase;
    const processed = await processDueReminders(client);
    return NextResponse.json({ success: true, processed });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function GET() {
  return POST();
}

