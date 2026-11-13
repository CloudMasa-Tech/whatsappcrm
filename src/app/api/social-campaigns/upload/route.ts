import { NextRequest, NextResponse } from 'next/server';
import { toErrorResponse } from '@/lib/auth/account';
import { requireProject, requireProjectRole } from '@/lib/auth/project';
import { checkRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/rate-limit';
import {
  detectMediaKindFromMimeOrUrl,
  validateSocialMediaFile,
} from '@/lib/social/campaigns';
import { buildProjectMediaPath } from '@/lib/storage/upload-media';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const requestedProjectId = formData.get('projectId');
    const ctx =
      typeof requestedProjectId === 'string' &&
      requestedProjectId.trim() &&
      requestedProjectId.trim() !== 'all'
        ? await requireProject(requestedProjectId.trim(), 'agent')
        : await requireProjectRole('agent');

    const limit = checkRateLimit(`social:upload:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const file = formData.get('file') as File | null;
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const validationError = validateSocialMediaFile(
      file.name,
      file.type || '',
      file.size,
    );
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const path = buildProjectMediaPath(ctx.accountId, ctx.projectId, file.name);
    const db = supabaseAdmin();

    let bucket = 'chat-media';
    let uploadRes = await db.storage.from(bucket).upload(path, buffer, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    });

    if (uploadRes.error) {
      bucket = 'flow-media';
      uploadRes = await db.storage.from(bucket).upload(path, buffer, {
        contentType: file.type || 'application/octet-stream',
        upsert: false,
      });
    }

    if (uploadRes.error) {
      return NextResponse.json(
        { error: `Storage upload failed: ${uploadRes.error.message}` },
        { status: 500 },
      );
    }

    const { data: publicUrlData } = db.storage.from(bucket).getPublicUrl(path);
    return NextResponse.json({
      success: true,
      url: publicUrlData.publicUrl,
      kind: detectMediaKindFromMimeOrUrl(file.type || file.name),
      path,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type || 'application/octet-stream',
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
