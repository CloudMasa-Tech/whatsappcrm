import { NextResponse } from 'next/server';
import { requireSuperAdmin, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';

export async function GET() {
  try {
    await requireSuperAdmin();
    const admin = supabaseAdmin();

    const { data: templates, error } = await admin
      .from('message_templates')
      .select(`
        *,
        project:projects(id, name, channel_type),
        creator:profiles!message_templates_user_id_fkey(user_id, full_name, email)
      `)
      .order('created_at', { ascending: false });

    if (error) {
      // Fallback if profile foreign key is named differently
      const { data: fallback, error: fbErr } = await admin
        .from('message_templates')
        .select(`
          *,
          project:projects(id, name, channel_type)
        `)
        .order('created_at', { ascending: false });

      if (fbErr) {
        return NextResponse.json({ error: fbErr.message }, { status: 500 });
      }

      return NextResponse.json({ templates: fallback ?? [] });
    }

    return NextResponse.json({ templates: templates ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}
