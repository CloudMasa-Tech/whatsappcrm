/**
 * GET /api/email/track/click/[token]?u=<target>
 *
 * Click tracking. Public and unauthenticated — the recipient's browser
 * follows this straight from their mail client.
 *
 * OPEN REDIRECT DEFENCE: `u` is attacker-controllable, so it is never
 * trusted on its own. The target must appear verbatim in the campaign's
 * stored `body_html`; anything else redirects to the site root instead.
 * Without that check this endpoint would happily bounce victims to any
 * URL while wearing our domain's reputation.
 */

import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  ensureEmailConversation,
  fireEmailTrigger,
  logEmailEvent,
} from '@/lib/email/lead-flow';

function siteOrigin(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000')
    .trim()
    .replace(/\/+$/, '');
}

/** Absolute http(s) only — blocks javascript:, data:, and protocol-relative. */
function isSafeHttpUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const fallback = siteOrigin();

  try {
    const { token } = await params;
    const target = new URL(request.url).searchParams.get('u') ?? '';

    if (!token || !/^[a-f0-9]{16,64}$/i.test(token) || !isSafeHttpUrl(target)) {
      return NextResponse.redirect(fallback, 302);
    }

    const db = supabaseAdmin();

    // Resolve the recipient and its campaign body BEFORE recording, so
    // a forged target never gets counted as a real click.
    const { data: recipient, error: lookupErr } = await db
      .from('email_campaign_recipients')
      .select(
        'id, campaign_id, contact_id, email, campaign:email_campaigns(id, account_id, project_id, body_html)',
      )
      .eq('tracking_token', token)
      .maybeSingle();

    if (lookupErr || !recipient) {
      return NextResponse.redirect(fallback, 302);
    }

    const campaign = Array.isArray(recipient.campaign)
      ? recipient.campaign[0]
      : recipient.campaign;

    if (!campaign) return NextResponse.redirect(fallback, 302);

    // The link must be one we actually sent.
    if (!String(campaign.body_html ?? '').includes(target)) {
      console.warn(
        '[email/track/click] target not present in campaign body, refusing redirect',
      );
      return NextResponse.redirect(fallback, 302);
    }

    const { data, error } = await db
      .rpc('record_email_click', { p_token: token, p_url: target })
      .maybeSingle<{
        recipient_id: string;
        campaign_id: string;
        contact_id: string | null;
        account_id: string;
        project_id: string | null;
        owner_user_id: string;
        email: string;
        is_first_click: boolean;
      }>();

    if (error) {
      console.error('[email/track/click] rpc error:', error);
      // Still deliver the recipient to their destination — a tracking
      // failure must not break the link they clicked.
      return NextResponse.redirect(target, 302);
    }

    if (data?.recipient_id) {
      const userAgent = request.headers.get('user-agent');
      const ip =
        request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
        request.headers.get('x-real-ip');

      await logEmailEvent({
        accountId: data.account_id,
        projectId: data.project_id,
        campaignId: data.campaign_id,
        recipientId: data.recipient_id,
        contactId: data.contact_id,
        eventType: 'click',
        url: target,
        userAgent,
        ipAddress: ip,
        metadata: { first_click: data.is_first_click },
      });

      if (data.is_first_click && data.contact_id) {
        const conversationId = await ensureEmailConversation({
          accountId: data.account_id,
          projectId: data.project_id,
          ownerUserId: data.owner_user_id,
          contactId: data.contact_id,
          subject: null,
        });

        await fireEmailTrigger({
          accountId: data.account_id,
          projectId: data.project_id,
          contactId: data.contact_id,
          triggerType: 'email_clicked',
          conversationId,
          messageText: target,
        });
      }
    }

    return NextResponse.redirect(target, 302);
  } catch (err) {
    console.error('[email/track/click] unexpected error:', err);
    return NextResponse.redirect(fallback, 302);
  }
}
