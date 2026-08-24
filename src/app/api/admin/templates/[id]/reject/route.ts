import { NextResponse } from 'next/server';
import { requireSuperAdmin, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireSuperAdmin();
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { reason?: string };
    const reason = typeof body.reason === 'string' && body.reason.trim()
      ? body.reason.trim()
      : 'Rejected by platform administrator.';

    const { data: updated, error } = await ctx.supabase
      .from('message_templates')
      .update({
        status: 'REJECTED',
        rejection_reason: reason,
      })
      .eq('id', id)
      .select()
      .single();

    if (error || !updated) {
      return NextResponse.json(
        { error: error?.message ?? 'Failed to reject template' },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true, template: updated });
  } catch (err) {
    return toErrorResponse(err);
  }
}
