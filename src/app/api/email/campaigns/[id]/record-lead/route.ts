import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  ensureContactForEmail,
  ensureEmailConversation,
  appendEmailMessage,
  logEmailEvent,
  fireEmailTrigger,
} from '@/lib/email/lead-flow';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getCurrentAccount();
    const { id: campaignId } = await params;
    const body = (await request.json().catch(() => null)) as {
      recipientId?: string;
      email?: string;
      replyText?: string;
      subject?: string;
    } | null;

    if (!body || (!body.recipientId && !body.email)) {
      return NextResponse.json(
        { error: 'Recipient ID or email address is required.' },
        { status: 400 },
      );
    }

    const db = supabaseAdmin();

    // 1. Verify campaign ownership
    const { data: campaign, error: campErr } = await db
      .from('email_campaigns')
      .select('id, name, subject, account_id, project_id, user_id, replied_count')
      .eq('id', campaignId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (campErr || !campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    // 2. Find recipient
    let recipientQuery = db
      .from('email_campaign_recipients')
      .select('id, email, name, status, contact_id, campaign_id')
      .eq('campaign_id', campaignId);

    if (body.recipientId) {
      recipientQuery = recipientQuery.eq('id', body.recipientId);
    } else if (body.email) {
      recipientQuery = recipientQuery.ilike('email', body.email.trim());
    }

    const { data: recipient, error: recipErr } = await recipientQuery.maybeSingle();

    if (recipErr || !recipient) {
      return NextResponse.json({ error: 'Recipient not found in this campaign' }, { status: 404 });
    }

    const accountId = campaign.account_id;
    const projectId = campaign.project_id ?? null;
    const ownerUserId = campaign.user_id;
    const fromEmail = recipient.email;
    const replySubject = body.subject?.trim() || `Re: ${campaign.subject || campaign.name}`;
    const replyBody = body.replyText?.trim() || 'Interested / positive response received from lead.';

    // 3. Ensure Contact exists
    const contactResult = await ensureContactForEmail({
      accountId,
      projectId,
      ownerUserId,
      email: fromEmail,
      name: recipient.name || fromEmail.split('@')[0],
      contactId: recipient.contact_id ?? null,
    });

    const contactId = contactResult?.contactId || recipient.contact_id || null;

    // 4. Ensure Conversation exists in Unified Inbox
    let conversationId: string | null = null;
    if (contactId) {
      conversationId = await ensureEmailConversation({
        accountId,
        projectId,
        ownerUserId,
        contactId,
        subject: replySubject,
      });

      if (conversationId) {
        await appendEmailMessage({
          conversationId,
          projectId,
          senderType: 'customer',
          subject: replySubject,
          bodyText: replyBody,
          incrementUnread: true,
        });
      }
    }

    // 5. Update recipient and campaign replied_count (Leads)
    const { error: rpcErr } = await db.rpc('record_email_reply', {
      p_recipient_id: recipient.id,
      p_conversation_id: conversationId,
    });

    if (rpcErr) {
      // Fallback if RPC migration not present
      await db
        .from('email_campaign_recipients')
        .update({
          replied_at: new Date().toISOString(),
          conversation_id: conversationId,
          status: 'replied',
        })
        .eq('id', recipient.id);

      await db
        .from('email_campaigns')
        .update({
          replied_count: (campaign.replied_count || 0) + 1,
        })
        .eq('id', campaign.id);
    }

    // 6. Log event & fire trigger
    await logEmailEvent({
      accountId,
      projectId,
      campaignId: campaign.id,
      recipientId: recipient.id,
      contactId,
      eventType: 'reply',
      metadata: { subject: replySubject, source: 'manual_or_inbound' },
    });

    if (contactId) {
      await fireEmailTrigger({
        accountId,
        projectId,
        contactId,
        triggerType: 'email_replied',
        conversationId,
        messageText: replyBody,
      });
    }

    return NextResponse.json({
      success: true,
      message: `Recorded Lead response for ${fromEmail}!`,
      conversationId,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

