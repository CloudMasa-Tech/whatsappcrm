import { NextResponse } from 'next/server';
import { toErrorResponse } from '@/lib/auth/account';
import { requireProjectRole } from '@/lib/auth/project';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { fetchXMentions, XApiError } from '@/lib/x/client';
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

    const mentions = await fetchXMentions({
      accessToken: cfg.accessToken,
      xUserId: cfg.xUserId,
      limit: 25,
    });

    return NextResponse.json({ mentions });
  } catch (err) {
    if (err instanceof XApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status || 400 });
    }
    return toErrorResponse(err);
  }
}

export async function POST() {
  try {
    const ctx = await requireProjectRole('agent');
    const cfg = await loadActiveXConfig(ctx.projectId);
    if (!cfg || !cfg.xUserId) {
      return NextResponse.json(
        { error: 'X account is not connected for this project.' },
        { status: 400 },
      );
    }

    const mentions = await fetchXMentions({
      accessToken: cfg.accessToken,
      xUserId: cfg.xUserId,
      limit: 25,
    });

    const db = supabaseAdmin();
    let importedCount = 0;

    for (const m of mentions) {
      if (!m.authorId || m.authorId === cfg.xUserId) continue;

      const xUrl = m.authorUsername ? `https://x.com/${m.authorUsername}` : null;
      const { data: existing } = await db
        .from('contacts')
        .select('id')
        .eq('project_id', ctx.projectId)
        .eq('x_user_id', m.authorId)
        .maybeSingle();

      if (existing?.id) {
        await db
          .from('contacts')
          .update({
            name: m.authorName || (m.authorUsername ? `@${m.authorUsername}` : 'X User'),
            x_username: m.authorUsername,
            x_url: xUrl,
          })
          .eq('id', existing.id);
      } else {
        const { error: insErr } = await db.from('contacts').insert({
          account_id: ctx.accountId,
          project_id: ctx.projectId,
          name: m.authorName || (m.authorUsername ? `@${m.authorUsername}` : 'X User'),
          channel: 'x',
          x_user_id: m.authorId,
          x_username: m.authorUsername,
          x_url: xUrl,
          source: 'x_mentions',
        });
        if (!insErr) importedCount++;
      }
    }

    return NextResponse.json({
      success: true,
      fetchedCount: mentions.length,
      importedCount,
    });
  } catch (err) {
    if (err instanceof XApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status || 400 });
    }
    return toErrorResponse(err);
  }
}

