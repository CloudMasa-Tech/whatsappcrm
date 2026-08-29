/**
 * GET /api/email/track/open/[token]
 *
 * Open-tracking pixel. Public and unauthenticated by necessity — it is
 * fetched by the recipient's mail client, which carries no session.
 *
 * Always returns the 1x1 GIF, even for an unknown or malformed token:
 * a broken image in someone's inbox is worse than a silently ignored
 * hit, and a distinguishable response would let a scanner confirm which
 * tokens are real.
 */

import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/supabase/admin';
import { TRACKING_PIXEL } from '@/lib/email/tracking';
import {
  ensureEmailConversation,
  fireEmailTrigger,
  logEmailEvent,
} from '@/lib/email/lead-flow';

function pixelResponse() {
  return new NextResponse(new Uint8Array(TRACKING_PIXEL), {
    status: 200,
    headers: {
      'Content-Type': 'image/gif',
      'Content-Length': String(TRACKING_PIXEL.length),
      // Must never be cached: a cached pixel means later opens are
      // invisible to us.
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      Pragma: 'no-cache',
      Expires: '0',
    },
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;

    if (!token || !/^[a-f0-9]{16,64}$/i.test(token)) {
      return pixelResponse();
    }

    // Counters move inside SQL so concurrent proxy fetches cannot lose
    // increments; the RPC also tells us whether this was the first open.
    const { data, error } = await supabaseAdmin()
      .rpc('record_email_open', { p_token: token })
      .maybeSingle<{
        recipient_id: string;
        campaign_id: string;
        contact_id: string | null;
        account_id: string;
        project_id: string | null;
        owner_user_id: string;
        email: string;
        is_first_open: boolean;
      }>();

    if (error) {
      console.error('[email/track/open] rpc error:', error);
      return pixelResponse();
    }
    if (!data?.recipient_id) return pixelResponse();

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
      eventType: 'open',
      userAgent,
      ipAddress: ip,
      metadata: { first_open: data.is_first_open },
    });

    // Lead flow runs on the FIRST open only. Mail clients and corporate
    // image proxies refetch the pixel repeatedly; firing every time
    // would spam automations and re-open conversations.
    if (data.is_first_open && data.contact_id) {
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
        triggerType: 'email_opened',
        conversationId,
      });
    }

    return pixelResponse();
  } catch (err) {
    console.error('[email/track/open] unexpected error:', err);
    return pixelResponse();
  }
}
