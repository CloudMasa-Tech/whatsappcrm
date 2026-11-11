import { NextRequest, NextResponse } from 'next/server';
import { requireProjectRole } from '@/lib/auth/project';
import { toErrorResponse } from '@/lib/auth/account';
import {
  fetchLinkedInComments,
  LinkedInApiError,
  replyToLinkedInComment,
} from '@/lib/linkedin/client';
import { loadActiveLinkedInConfig } from '@/lib/linkedin/config-store';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireProjectRole('viewer');
    const postUrn = request.nextUrl.searchParams.get('postUrn')?.trim();
    if (!postUrn) {
      return NextResponse.json({ error: 'postUrn query parameter is required.' }, { status: 400 });
    }

    const cfg = await loadActiveLinkedInConfig(ctx.projectId);
    if (!cfg) {
      return NextResponse.json(
        { error: 'LinkedIn is not connected for this project.' },
        { status: 400 },
      );
    }

    const comments = await fetchLinkedInComments(cfg.accessToken, postUrn);
    return NextResponse.json({ success: true, comments });
  } catch (err) {
    if (err instanceof LinkedInApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status || 400 });
    }
    return toErrorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireProjectRole('agent');
    const body = (await request.json().catch(() => null)) as {
      postUrn?: unknown;
      text?: unknown;
      parentCommentUrn?: unknown;
    } | null;

    const postUrn = typeof body?.postUrn === 'string' ? body.postUrn.trim() : '';
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    if (!postUrn || !text) {
      return NextResponse.json({ error: 'postUrn and text are required.' }, { status: 400 });
    }

    const cfg = await loadActiveLinkedInConfig(ctx.projectId);
    if (!cfg) {
      return NextResponse.json(
        { error: 'LinkedIn is not connected for this project.' },
        { status: 400 },
      );
    }

    const res = await replyToLinkedInComment({
      accessToken: cfg.accessToken,
      postUrn,
      actorUrn: cfg.authorUrn,
      text,
      parentCommentUrn:
        typeof body?.parentCommentUrn === 'string' ? body.parentCommentUrn.trim() : undefined,
    });

    return NextResponse.json({ success: true, commentUrn: res.commentUrn });
  } catch (err) {
    if (err instanceof LinkedInApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status || 400 });
    }
    return toErrorResponse(err);
  }
}

