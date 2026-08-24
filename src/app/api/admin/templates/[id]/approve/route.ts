import { NextResponse } from 'next/server';
import { requireSuperAdmin, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireSuperAdmin();
    const { id } = await params;

    const { data: updated, error } = await ctx.supabase
      .from('message_templates')
      .update({
        status: 'APPROVED',
        rejection_reason: null,
        submission_error: null,
      })
      .eq('id', id)
      .select()
      .single();

    if (error || !updated) {
      return NextResponse.json(
        { error: error?.message ?? 'Failed to approve template' },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true, template: updated });
  } catch (err) {
    return toErrorResponse(err);
  }
}
