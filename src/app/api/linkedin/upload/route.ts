import { NextRequest, NextResponse } from 'next/server';
import { requireProjectRole } from '@/lib/auth/project';
import { toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { buildProjectMediaPath } from '@/lib/storage/upload-media';

export const dynamic = 'force-dynamic';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireProjectRole('agent');
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }
    if (!file.type.startsWith('image/')) {
      return NextResponse.json(
        { error: 'LinkedIn image uploads currently support image files (PNG, JPG, GIF, WebP).' },
        { status: 400 },
      );
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return NextResponse.json(
        { error: 'Image size exceeds maximum allowed limit of 10 MB.' },
        { status: 400 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const path = buildProjectMediaPath(ctx.accountId, ctx.projectId, file.name);
    const db = supabaseAdmin();

    let bucket = 'chat-media';
    let uploadRes = await db.storage.from(bucket).upload(path, buffer, {
      contentType: file.type || 'image/jpeg',
      upsert: false,
    });

    if (uploadRes.error) {
      bucket = 'flow-media';
      uploadRes = await db.storage.from(bucket).upload(path, buffer, {
        contentType: file.type || 'image/jpeg',
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
      path,
      fileName: file.name,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

