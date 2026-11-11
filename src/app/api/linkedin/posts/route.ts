import { NextRequest, NextResponse } from 'next/server';
import { requireProjectRole } from '@/lib/auth/project';
import { toErrorResponse } from '@/lib/auth/account';
import {
  deleteLinkedInPost,
  fetchLinkedInPosts,
  LinkedInApiError,
  publishLinkedInPost,
} from '@/lib/linkedin/client';
import { loadActiveLinkedInConfig } from '@/lib/linkedin/config-store';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireProjectRole('viewer');
    const cfg = await loadActiveLinkedInConfig(ctx.projectId);
    if (!cfg) {
      return NextResponse.json(
        { error: 'LinkedIn is not connected for this project.' },
        { status: 400 },
      );
    }

    const requestedAuthor = request.nextUrl.searchParams.get('authorUrn')?.trim();
    const authorUrn = requestedAuthor || cfg.authorUrn;
    const posts = await fetchLinkedInPosts(cfg.accessToken, authorUrn, 15);
    return NextResponse.json({ success: true, posts, authorUrn });
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
    const cfg = await loadActiveLinkedInConfig(ctx.projectId);
    if (!cfg) {
      return NextResponse.json(
        { error: 'LinkedIn is not connected for this project.' },
        { status: 400 },
      );
    }

    const body = (await request.json().catch(() => null)) as {
      text?: unknown;
      visibility?: unknown;
      authorUrn?: unknown;
      articleUrl?: unknown;
      articleTitle?: unknown;
      articleDescription?: unknown;
      imageUrl?: unknown;
    } | null;

    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    if (!text) {
      return NextResponse.json({ error: 'Post text is required.' }, { status: 400 });
    }

    const requestedAuthor =
      typeof body?.authorUrn === 'string' ? body.authorUrn.trim() : '';
    const allowedAuthors = new Set(
      [cfg.memberUrn, cfg.organizationUrn, cfg.authorUrn].filter(Boolean) as string[],
    );
    const authorUrn =
      requestedAuthor && allowedAuthors.has(requestedAuthor)
        ? requestedAuthor
        : cfg.authorUrn;

    const result = await publishLinkedInPost({
      accessToken: cfg.accessToken,
      authorUrn,
      text,
      visibility: body?.visibility === 'CONNECTIONS' ? 'CONNECTIONS' : 'PUBLIC',
      articleUrl: typeof body?.articleUrl === 'string' ? body.articleUrl : undefined,
      articleTitle: typeof body?.articleTitle === 'string' ? body.articleTitle : undefined,
      articleDescription:
        typeof body?.articleDescription === 'string' ? body.articleDescription : undefined,
      imageUrl: typeof body?.imageUrl === 'string' ? body.imageUrl : undefined,
    });

    return NextResponse.json({ success: true, postUrn: result.postUrn, authorUrn });
  } catch (err) {
    if (err instanceof LinkedInApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status || 400 });
    }
    return toErrorResponse(err);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const ctx = await requireProjectRole('agent');
    const cfg = await loadActiveLinkedInConfig(ctx.projectId);
    if (!cfg) {
      return NextResponse.json(
        { error: 'LinkedIn is not connected for this project.' },
        { status: 400 },
      );
    }

    const postUrn = request.nextUrl.searchParams.get('postUrn')?.trim();
    if (!postUrn) {
      return NextResponse.json({ error: 'postUrn query parameter is required.' }, { status: 400 });
    }

    await deleteLinkedInPost(cfg.accessToken, postUrn);
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof LinkedInApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status || 400 });
    }
    return toErrorResponse(err);
  }
}

