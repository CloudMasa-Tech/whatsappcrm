import { NextRequest, NextResponse } from 'next/server';
import { toErrorResponse } from '@/lib/auth/account';
import { requireProjectRole } from '@/lib/auth/project';
import { checkRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/rate-limit';
import { buildProjectMediaPath } from '@/lib/storage/upload-media';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 50 * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireProjectRole('agent');
    const limit = checkRateLimit(`x:upload:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }
    if (file.size <= 0 || file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: 'File must be between 1 byte and 50 MB.' },
        { status: 400 },
      );
    }

    const mimeType = file.type || 'application/octet-stream';
    if (!mimeType.startsWith('image/') && !mimeType.startsWith('video/')) {
      return NextResponse.json(
        { error: 'Only image and video files are supported for X posts.' },
        { status: 400 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const path = buildProjectMediaPath(ctx.accountId, ctx.projectId, file.name);
    const db = supabaseAdmin();

    let bucket = 'chat-media';
    let uploadRes = await db.storage.from(bucket).upload(path, buffer, {
      contentType: mimeType,
      upsert: false,
    });

    if (uploadRes.error) {
      bucket = 'flow-media';
      uploadRes = await db.storage.from(bucket).upload(path, buffer, {
        contentType: mimeType,
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
      fileName: file.name,
      fileType: mimeType,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

