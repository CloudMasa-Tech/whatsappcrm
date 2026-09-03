import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getCurrentProject } from '@/lib/auth/project';
import { STARTER_MESSAGE_TEMPLATES } from '@/lib/whatsapp/starter-templates';

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const queryProjectId = searchParams.get('project_id');
    const includeStarters = searchParams.get('include_starters') === 'true';

    let activeProjectId = queryProjectId;
    if (!activeProjectId) {
      try {
        const proj = await getCurrentProject();
        activeProjectId = proj?.projectId ?? null;
      } catch {
        activeProjectId = null;
      }
    }

    // Get user profile for account_id and platform_role
    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id, platform_role')
      .eq('user_id', user.id)
      .maybeSingle();

    const isSuperAdmin = profile?.platform_role === 'super_admin';
    const accountId = profile?.account_id;

    // Build query for message_templates:
    // Fetches:
    // 1. Templates belonging to the active project
    // 2. Common templates (project_id IS NULL)
    let query = supabase.from('message_templates').select('*');

    if (accountId) {
      query = query.eq('account_id', accountId);
    }

    if (activeProjectId) {
      query = query.or(`project_id.eq.${activeProjectId},project_id.is.null`);
    } else if (!isSuperAdmin) {
      query = query.is('project_id', null);
    }

    const { data: templates, error: fetchError } = await query.order('created_at', { ascending: false });

    if (fetchError) {
      console.error('Failed to fetch templates:', fetchError);
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }

    const decoratedTemplates = (templates || []).map((t) => ({
      ...t,
      is_common: !t.project_id,
    }));

    return NextResponse.json({
      templates: decoratedTemplates,
      starter_templates: includeStarters ? STARTER_MESSAGE_TEMPLATES : undefined,
    });
  } catch (err: unknown) {
    console.error('Templates route error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { starter_slug, make_common } = body;

    if (!starter_slug) {
      return NextResponse.json({ error: 'starter_slug is required' }, { status: 400 });
    }

    const starter = STARTER_MESSAGE_TEMPLATES.find((s) => s.slug === starter_slug);
    if (!starter) {
      return NextResponse.json({ error: `Starter template "${starter_slug}" not found` }, { status: 404 });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id, platform_role')
      .eq('user_id', user.id)
      .maybeSingle();

    const isSuperAdmin = profile?.platform_role === 'super_admin';
    const accountId = profile?.account_id;

    if (!accountId) {
      return NextResponse.json({ error: 'Account not found for user' }, { status: 400 });
    }

    let targetProjectId: string | null = null;
    if (!make_common) {
      try {
        const proj = await getCurrentProject();
        targetProjectId = proj?.projectId ?? null;
      } catch {
        targetProjectId = null;
      }
    } else if (!isSuperAdmin) {
      return NextResponse.json(
        { error: 'Only super admins can install templates as Common Templates for all projects' },
        { status: 403 }
      );
    }

    const row = {
      account_id: accountId,
      project_id: targetProjectId,
      user_id: user.id,
      name: starter.name,
      category: starter.category,
      language: starter.language,
      header_type: starter.header_format === 'none' ? null : starter.header_format,
      header_content: starter.header_content ?? null,
      header_media_url: starter.header_media_url ?? null,
      body_text: starter.body_text,
      footer_text: starter.footer_text ?? null,
      buttons: starter.buttons ?? null,
      sample_values: starter.sample_values ?? null,
      status: 'APPROVED',
    };

    const { data: created, error: insertError } = await supabase
      .from('message_templates')
      .upsert(row, { onConflict: 'user_id,name,language' })
      .select()
      .single();

    if (insertError) {
      console.error('Failed to install starter template:', insertError);
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      template: { ...created, is_common: !created.project_id },
      message: make_common
        ? `Template "${starter.title}" installed as Common Template across all projects!`
        : `Template "${starter.title}" added to project!`,
    });
  } catch (err: unknown) {
    console.error('Install starter template error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
