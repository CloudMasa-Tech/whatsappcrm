import { NextResponse } from 'next/server';
import { toErrorResponse } from '@/lib/auth/account';
import { requireProjectRole } from '@/lib/auth/project';
import { checkRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/rate-limit';
import {
  deleteXPost,
  fetchXTweets,
  publishXPost,
  uploadXMediaFromUrl,
  XApiError,
} from '@/lib/x/client';
import { loadActiveXConfig } from '@/lib/x/config-store';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const ctx = await requireProjectRole('viewer');
    const cfg = await loadActiveXConfig(ctx.projectId);
    if (!cfg || !cfg.xUserId) {
      return NextResponse.json(
        { error: 'X account is not connected for this project.' },
        { status: 400 },
      );
    }

    const posts = await fetchXTweets({
      accessToken: cfg.accessToken,
      xUserId: cfg.xUserId,
      username: cfg.username,
      displayName: cfg.displayName,
      limit: 20,
    });

    return NextResponse.json({ posts });
  } catch (err) {
    if (err instanceof XApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status || 400 });
    }
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireProjectRole('agent');
    const limit = checkRateLimit(`x:post:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const cfg = await loadActiveXConfig(ctx.projectId);
    if (!cfg) {
      return NextResponse.json(
        { error: 'X account is not connected for this project.' },
        { status: 400 },
      );
    }

    const body = (await request.json().catch(() => null)) as {
      text?: unknown;
      mediaUrl?: unknown;
      mediaMimeType?: unknown;
      mediaUrls?: unknown;
      replyToTweetId?: unknown;
    } | null;

    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    const singleMediaUrl =
      typeof body?.mediaUrl === 'string' && body.mediaUrl.trim()
        ? body.mediaUrl.trim()
        : null;
    const multiMediaUrls = Array.isArray(body?.mediaUrls)
      ? body.mediaUrls.filter((u): u is string => typeof u === 'string' && Boolean(u.trim()))
      : [];
    const targetUrls = Array.from(
      new Set([
        ...(singleMediaUrl ? [singleMediaUrl] : []),
        ...multiMediaUrls,
      ]),
    ).slice(0, 4);

    if (!text && targetUrls.length === 0) {
      return NextResponse.json(
        { error: 'Enter tweet text or attach media.' },
        { status: 400 },
      );
    }

    const mediaIds: string[] = [];
    for (const url of targetUrls) {
      const uploaded = await uploadXMediaFromUrl({
        accessToken: cfg.accessToken,
        mediaUrl: url,
        mimeType:
          typeof body?.mediaMimeType === 'string' ? body.mediaMimeType : undefined,
      });
      mediaIds.push(uploaded.mediaId);
    }

    const created = await publishXPost({
      accessToken: cfg.accessToken,
      text: text || ' ',
      mediaIds: mediaIds.length > 0 ? mediaIds : undefined,
      replyToTweetId:
        typeof body?.replyToTweetId === 'string' ? body.replyToTweetId : undefined,
    });

    return NextResponse.json({
      success: true,
      post: {
        id: created.id,
        text: created.text,
        permalink: cfg.username
          ? `https://x.com/${cfg.username}/status/${created.id}`
          : `https://x.com/i/web/status/${created.id}`,
      },
    });
  } catch (err) {
    if (err instanceof XApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status || 400 });
    }
    return toErrorResponse(err);
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await requireProjectRole('agent');
    const cfg = await loadActiveXConfig(ctx.projectId);
    if (!cfg) {
      return NextResponse.json(
        { error: 'X account is not connected for this project.' },
        { status: 400 },
      );
    }

    const id = new URL(request.url).searchParams.get('id')?.trim();
    if (!id) {
      return NextResponse.json({ error: 'Post id is required.' }, { status: 400 });
    }

    const deleted = await deleteXPost({
      accessToken: cfg.accessToken,
      tweetId: id,
    });

    return NextResponse.json({ success: deleted });
  } catch (err) {
    if (err instanceof XApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status || 400 });
    }
    return toErrorResponse(err);
  }
}

