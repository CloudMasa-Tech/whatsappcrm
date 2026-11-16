import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { DEFAULT_INBOUND_SECRET } from '../route';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const body = (await request.json().catch(() => null)) as {
      fromEmail?: string;
      subject?: string;
      text?: string;
    } | null;

    if (!body?.fromEmail || !body.fromEmail.includes('@')) {
      return NextResponse.json(
        { error: 'Valid fromEmail is required' },
        { status: 400 },
      );
    }

    const secret = process.env.EMAIL_INBOUND_SECRET || DEFAULT_INBOUND_SECRET;
    const url = new URL(request.url);
    const inboundUrl = `${url.origin}/api/email/inbound?secret=${encodeURIComponent(secret)}`;

    // Call the actual inbound webhook endpoint to test the full pipeline
    const inboundResponse = await fetch(inboundUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: body.fromEmail.trim(),
        subject: body.subject?.trim() || 'Re: Test Inbound Reply',
        text: body.text?.trim() || 'This is a test simulated customer reply to verify the inbound webhook.',
      }),
    });

    const data = await inboundResponse.json().catch(() => null);

    if (!inboundResponse.ok) {
      return NextResponse.json(
        {
          error: data?.error || 'Inbound webhook test failed',
          statusCode: inboundResponse.status,
        },
        { status: inboundResponse.status },
      );
    }

    return NextResponse.json({
      success: true,
      inboundResult: data,
      testEmail: body.fromEmail.trim(),
      message: data?.leadRecorded
        ? `Success! Reply matched campaign recipient and was recorded as a Lead.`
        : `Success! Reply was received and placed into the Unified Inbox.`,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

