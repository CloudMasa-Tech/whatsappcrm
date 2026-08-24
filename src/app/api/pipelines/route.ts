import { NextResponse } from 'next/server';
import { toErrorResponse } from '@/lib/auth/account';
import { getCurrentProject, requireProjectRole } from '@/lib/auth/project';
import { supabaseAdmin } from '@/lib/automations/admin-client';

const SPEC_DEFAULT_STAGES = [
  { name: 'Lead', color: '#3b82f6', position: 0 },
  { name: 'Contact Made', color: '#8b5cf6', position: 1 },
  { name: 'Proposal Sent', color: '#f59e0b', position: 2 },
  { name: 'Negotiation', color: '#ec4899', position: 3 },
  { name: 'Won', color: '#10b981', position: 4 },
  { name: 'Lost', color: '#ef4444', position: 5 },
];

export async function GET() {
  try {
    const { projectId, supabase } = await getCurrentProject();

    const { data: pipelines, error } = await supabase
      .from('pipelines')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true });

    if (error) {
      // Fallback with service role if RLS check fails on project
      const { data: fallback, error: fbErr } = await supabaseAdmin()
        .from('pipelines')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true });

      if (fbErr) {
        return NextResponse.json({ error: fbErr.message }, { status: 500 });
      }
      return NextResponse.json({ pipelines: fallback ?? [] });
    }

    return NextResponse.json({ pipelines: pipelines ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  let ctx;
  try {
    // Admin, owner, or super admin can create pipelines.
    ctx = await requireProjectRole('admin');
  } catch (err) {
    return toErrorResponse(err);
  }

  const body = (await request.json().catch(() => null)) as {
    name?: unknown;
    stages?: unknown[];
  } | null;

  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) {
    return NextResponse.json({ error: 'Pipeline name is required' }, { status: 400 });
  }

  try {
    const admin = supabaseAdmin();

    const { data: pipeline, error: pipelineError } = await admin
      .from('pipelines')
      .insert({
        user_id: ctx.userId,
        account_id: ctx.accountId,
        project_id: ctx.projectId,
        name,
      })
      .select()
      .single();

    if (pipelineError || !pipeline) {
      console.error('[POST /api/pipelines] insert error:', pipelineError);
      return NextResponse.json(
        { error: pipelineError?.message ?? 'Failed to create pipeline' },
        { status: 500 },
      );
    }

    const stagesToInsert = Array.isArray(body.stages) && body.stages.length > 0
      ? body.stages.map((s: any, idx) => ({
          pipeline_id: pipeline.id,
          name: typeof s.name === 'string' ? s.name : `Stage ${idx + 1}`,
          color: typeof s.color === 'string' ? s.color : '#3b82f6',
          position: typeof s.position === 'number' ? s.position : idx,
        }))
      : SPEC_DEFAULT_STAGES.map((s) => ({
          pipeline_id: pipeline.id,
          name: s.name,
          color: s.color,
          position: s.position,
        }));

    const { data: stages, error: stagesError } = await admin
      .from('pipeline_stages')
      .insert(stagesToInsert)
      .select()
      .order('position', { ascending: true });

    if (stagesError) {
      console.error('[POST /api/pipelines] stages insert error:', stagesError);
    }

    return NextResponse.json({ pipeline, stages: stages ?? [] }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
