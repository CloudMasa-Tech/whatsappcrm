import { NextResponse } from 'next/server';
import { toErrorResponse } from '@/lib/auth/account';
import { getCurrentProject, requireProjectRole } from '@/lib/auth/project';
import { supabaseAdmin } from '@/lib/automations/admin-client';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { projectId, supabase } = await getCurrentProject();

    const { data: pipeline, error } = await supabase
      .from('pipelines')
      .select('*, stages:pipeline_stages(*)')
      .eq('id', id)
      .eq('project_id', projectId)
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    return NextResponse.json({ pipeline });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let ctx;
  try {
    ctx = await requireProjectRole('admin');
  } catch (err) {
    return toErrorResponse(err);
  }

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as {
    name?: unknown;
    stages?: Array<{
      id?: string;
      name: string;
      color: string;
      position: number;
    }>;
  } | null;

  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const admin = supabaseAdmin();

    if (typeof body.name === 'string' && body.name.trim()) {
      const { error: updateError } = await admin
        .from('pipelines')
        .update({ name: body.name.trim() })
        .eq('id', id)
        .eq('project_id', ctx.projectId);

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 });
      }
    }

    // Update stages if provided
    if (Array.isArray(body.stages)) {
      for (const stage of body.stages) {
        if (stage.id) {
          await admin
            .from('pipeline_stages')
            .update({
              name: stage.name,
              color: stage.color,
              position: stage.position,
            })
            .eq('id', stage.id)
            .eq('pipeline_id', id);
        } else {
          await admin.from('pipeline_stages').insert({
            pipeline_id: id,
            name: stage.name,
            color: stage.color,
            position: stage.position,
          });
        }
      }
    }

    const { data: updated } = await admin
      .from('pipelines')
      .select('*, stages:pipeline_stages(*)')
      .eq('id', id)
      .single();

    return NextResponse.json({ pipeline: updated });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let ctx;
  try {
    ctx = await requireProjectRole('admin');
  } catch (err) {
    return toErrorResponse(err);
  }

  const { id } = await params;

  try {
    const admin = supabaseAdmin();

    // Check pipeline belongs to this project
    const { data: existing } = await admin
      .from('pipelines')
      .select('id')
      .eq('id', id)
      .eq('project_id', ctx.projectId)
      .single();

    if (!existing) {
      return NextResponse.json({ error: 'Pipeline not found' }, { status: 404 });
    }

    const { error } = await admin.from('pipelines').delete().eq('id', id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
