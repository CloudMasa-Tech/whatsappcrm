import { NextResponse } from "next/server";
import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { processDueReminders } from "@/lib/inbox/reminders";

export async function POST() {
  try {
    await getCurrentAccount();
    const admin = supabaseAdmin();
    const processed = await processDueReminders(admin);
    return NextResponse.json({ success: true, processed });
  } catch (err) {
    return toErrorResponse(err);
  }
}
