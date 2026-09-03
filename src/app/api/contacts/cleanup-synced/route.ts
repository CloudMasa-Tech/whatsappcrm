import { NextResponse } from 'next/server';
import { toErrorResponse } from '@/lib/auth/account';
import { requireProjectRole, requireProject } from '@/lib/auth/project';
import { cleanupSyncedWhatsAppContacts } from '@/lib/contacts/cleanup-synced';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const requested = typeof body?.projectId === 'string' ? body.projectId : null;

    const ctx = requested
      ? await requireProject(requested, 'admin')
      : await requireProjectRole('admin');

    const result = await cleanupSyncedWhatsAppContacts(ctx.supabase, ctx.projectId);

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
