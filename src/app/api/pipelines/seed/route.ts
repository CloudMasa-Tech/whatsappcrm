import { NextResponse } from 'next/server';
import { toErrorResponse } from '@/lib/auth/account';
import { getCurrentProject } from '@/lib/auth/project';
import { supabaseAdmin } from '@/lib/automations/admin-client';

const SPEC_DEFAULT_STAGES = [
  { name: 'Lead', color: '#3b82f6', position: 0 },
  { name: 'Contact Made', color: '#8b5cf6', position: 1 },
  { name: 'Proposal Sent', color: '#f59e0b', position: 2 },
  { name: 'Negotiation', color: '#ec4899', position: 3 },
  { name: 'Won', color: '#10b981', position: 4 },
  { name: 'Lost', color: '#ef4444', position: 5 },
];

export async function POST() {
  try {
    const { projectId, accountId, userId } = await getCurrentProject();
    const admin = supabaseAdmin();

    // Check if pipelines already exist for this project
    const { data: existing } = await admin
      .from('pipelines')
      .select('id, name')
      .eq('project_id', projectId)
      .limit(1);

    if (existing && existing.length > 0) {
      return NextResponse.json({ pipeline: existing[0], created: false });
    }

    // Insert default Sales Pipeline
    const { data: pipeline, error: pipelineError } = await admin
      .from('pipelines')
      .insert({
        user_id: userId,
        account_id: accountId,
        project_id: projectId,
        name: 'Sales Pipeline',
      })
      .select()
      .single();

    if (pipelineError || !pipeline) {
      console.error('[POST /api/pipelines/seed] error:', pipelineError);
      return NextResponse.json(
        { error: pipelineError?.message ?? 'Failed to seed pipeline' },
        { status: 500 },
      );
    }

    const stagesPayload = SPEC_DEFAULT_STAGES.map((s) => ({
      pipeline_id: pipeline.id,
      name: s.name,
      color: s.color,
      position: s.position,
    }));

    await admin.from('pipeline_stages').insert(stagesPayload);

    return NextResponse.json({ pipeline, created: true }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
