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

    let makeCommon = false;
    try {
      const body = await request.json();
      makeCommon = Boolean(body?.makeCommon);
    } catch {
      // Body is optional
    }

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

    // If approved as a common template, sync across all active projects in the account
    if (makeCommon && updated.account_id) {
      const { data: projects } = await ctx.supabase
        .from('projects')
        .select('id')
        .eq('account_id', updated.account_id)
        .is('archived_at', null);

      if (projects && projects.length > 0) {
        for (const p of projects) {
          if (p.id !== updated.project_id) {
            await ctx.supabase.from('message_templates').upsert(
              {
                account_id: updated.account_id,
                project_id: p.id,
                user_id: updated.user_id,
                name: updated.name,
                category: updated.category,
                language: updated.language,
                header_type: updated.header_type,
                header_content: updated.header_content,
                header_media_url: updated.header_media_url,
                body_text: updated.body_text,
                footer_text: updated.footer_text,
                buttons: updated.buttons,
                sample_values: updated.sample_values,
                status: 'APPROVED',
              },
              { onConflict: 'user_id,name,language' },
            );
          }
        }
      }
    }

    return NextResponse.json({ success: true, template: updated });
  } catch (err) {
    return toErrorResponse(err);
  }
}
