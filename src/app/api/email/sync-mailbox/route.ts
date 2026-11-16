import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { syncMailbox } from '@/lib/email/mailbox-sync';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const body = (await request.json().catch(() => ({}))) as {
      projectId?: string;
      maxEmails?: number;
    };

    const result = await syncMailbox({
      projectId: body.projectId || null,
      maxEmails: body.maxEmails || 40,
    });

    if (!result.success) {
      return NextResponse.json(
        {
          error: result.error || 'Failed to sync mailbox',
          scannedCount: result.scannedCount,
        },
        { status: 500 },
      );
    }

    const message =
      result.newLeadsCount > 0
        ? `Synced ${result.scannedCount} emails from mailbox: Recorded ${result.newLeadsCount} new Lead${result.newLeadsCount === 1 ? '' : 's'} and updated Inbox!`
        : `Synced ${result.scannedCount} emails from mailbox. No new replies found.`;

    return NextResponse.json({
      success: true,
      scannedCount: result.scannedCount,
      newLeadsCount: result.newLeadsCount,
      newMessagesCount: result.newMessagesCount,
      matchedRecipients: result.matchedRecipients,
      message,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get('project_id');

    const result = await syncMailbox({
      projectId,
      maxEmails: 30,
    });

    return NextResponse.json(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}

