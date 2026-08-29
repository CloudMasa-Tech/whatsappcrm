/**
 * GET /api/channels/readiness?projectId=<id>
 *
 * "Which channels can actually send or receive right now?"
 *
 * WhatsApp is deliberately NOT here. Its state is live — a paired phone
 * can drop at any moment — so the inbox subscribes to it directly via
 * useChannelStatus. These three change only when someone edits
 * configuration, so a single read on inbox load is enough.
 *
 * Facebook reports a real state as of migration 058, which gave it a
 * `facebook_config` credential store like Instagram's.
 */

import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/supabase/admin';

export type ChannelReadinessState =
  | 'ready'
  | 'not_configured'
  | 'error'
  | 'unsupported';

export interface ChannelReadiness {
  state: ChannelReadinessState;
  detail?: string | null;
}

export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const projectId = new URL(request.url).searchParams.get('projectId')?.trim() || null;

    const db = supabaseAdmin();

    // ---- Instagram -------------------------------------------------
    let instagram: ChannelReadiness = { state: 'not_configured' };
    {
      let query = db
        .from('instagram_config')
        .select('status, last_error, username')
        .eq('account_id', ctx.accountId)
        .limit(1);
      if (projectId) query = query.eq('project_id', projectId);

      const { data } = await query.maybeSingle();

      if (data) {
        if (data.status === 'connected') {
          instagram = { state: 'ready', detail: data.username ?? null };
        } else if (data.status === 'error') {
          instagram = { state: 'error', detail: data.last_error ?? null };
        } else {
          // 'disconnected' / '2fa_pending' — configured but not usable.
          instagram = { state: 'not_configured', detail: data.status };
        }
      }
    }

    // ---- Email -----------------------------------------------------
    // Mirrors resolveEmailConfig(): a stored row wins, and the SMTP_*
    // environment variables are a valid fallback, so checking only the
    // table would wrongly report a working env-configured setup as
    // unconfigured.
    let email: ChannelReadiness = { state: 'not_configured' };
    {
      let query = db
        .from('email_configs')
        .select('smtp_host, smtp_user, smtp_pass, from_email')
        .eq('account_id', ctx.accountId)
        .limit(1);
      if (projectId) query = query.eq('project_id', projectId);

      const { data } = await query.maybeSingle();

      const rowUsable = Boolean(data?.smtp_host && data?.smtp_user && data?.smtp_pass);
      const envUsable = Boolean(
        process.env.SMTP_HOST &&
          (process.env.SMTP_USER || process.env.EMAIL_SERVER_USER) &&
          (process.env.SMTP_PASS || process.env.EMAIL_SERVER_PASSWORD),
      );

      if (rowUsable) {
        email = { state: 'ready', detail: data?.from_email ?? null };
      } else if (envUsable) {
        email = { state: 'ready', detail: process.env.SMTP_FROM ?? null };
      }
    }

    // ---- Facebook ---------------------------------------------------
    let facebook: ChannelReadiness = { state: 'not_configured' };
    {
      let query = db
        .from('facebook_config')
        .select('status, last_error, page_name')
        .eq('account_id', ctx.accountId)
        .limit(1);
      if (projectId) query = query.eq('project_id', projectId);

      // `.select()` on a table that does not exist yet rejects; treat a
      // missing migration as simply unconfigured rather than a 500.
      const { data, error } = await query.maybeSingle();

      if (!error && data) {
        if (data.status === 'connected') {
          facebook = { state: 'ready', detail: data.page_name ?? null };
        } else if (data.status === 'error') {
          facebook = { state: 'error', detail: data.last_error ?? null };
        }
      }
    }

    return NextResponse.json({ instagram, email, facebook });
  } catch (err) {
    return toErrorResponse(err);
  }
}
