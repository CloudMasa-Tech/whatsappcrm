/**
 * /api/email/campaigns/[id]
 *
 * GET    — campaign with its recipients and engagement detail
 * PATCH  — edit a draft (a sent campaign is immutable)
 * DELETE — remove a campaign and, by cascade, its recipients/events
 */

import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/supabase/admin';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getCurrentAccount();
    const { id } = await params;

    const { data: campaign, error } = await ctx.supabase
      .from('email_campaigns')
      .select('*')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (error || !campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    const { data: recipients } = await ctx.supabase
      .from('email_campaign_recipients')
      .select(
        'id, email, name, status, sent_at, open_count, first_opened_at, click_count, first_clicked_at, replied_at, conversation_id, contact_id, error_message',
      )
      .eq('campaign_id', id)
      .order('created_at', { ascending: true });

    return NextResponse.json({ campaign, recipients: recipients ?? [] });
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
    ctx = await getCurrentAccount();
  } catch (err) {
    return toErrorResponse(err);
  }

  const { id } = await params;
  const db = supabaseAdmin();

  const { data: campaign } = await db
    .from('email_campaigns')
    .select('id, status')
    .eq('id', id)
    .eq('account_id', ctx.accountId)
    .maybeSingle();

  if (!campaign) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  }

  // Editing a campaign that has gone out would misrepresent what was
  // actually delivered, and its tracked bodies are already in inboxes.
  if (campaign.status !== 'draft') {
    return NextResponse.json(
      { error: 'Only draft campaigns can be edited' },
      { status: 409 },
    );
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  if (typeof body.name === 'string' && body.name.trim()) update.name = body.name.trim();
  if (typeof body.subject === 'string' && body.subject.trim())
    update.subject = body.subject.trim();
  if (typeof body.bodyHtml === 'string' && body.bodyHtml.trim())
    update.body_html = body.bodyHtml;
  if (typeof body.bodyText === 'string') update.body_text = body.bodyText;
  if (typeof body.fromName === 'string') update.from_name = body.fromName.trim() || null;
  if (typeof body.fromEmail === 'string') update.from_email = body.fromEmail.trim() || null;
  if (typeof body.replyTo === 'string') update.reply_to = body.replyTo.trim() || null;
  if (typeof body.trackOpens === 'boolean') update.track_opens = body.trackOpens;
  if (typeof body.trackClicks === 'boolean') update.track_clicks = body.trackClicks;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No supported fields to update' }, { status: 400 });
  }

  update.updated_at = new Date().toISOString();

  const { data: updated, error: updateErr } = await db
    .from('email_campaigns')
    .update(update)
    .eq('id', id)
    .select('*')
    .single();

  if (updateErr) {
    console.error('[PATCH /api/email/campaigns/[id]] error:', updateErr);
    return NextResponse.json({ error: 'Failed to update campaign' }, { status: 500 });
  }

  return NextResponse.json({ campaign: updated });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let ctx;
  try {
    ctx = await getCurrentAccount();
  } catch (err) {
    return toErrorResponse(err);
  }

  const { id } = await params;

  const { error } = await supabaseAdmin()
    .from('email_campaigns')
    .delete()
    .eq('id', id)
    .eq('account_id', ctx.accountId);

  if (error) {
    console.error('[DELETE /api/email/campaigns/[id]] error:', error);
    return NextResponse.json({ error: 'Failed to delete campaign' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
