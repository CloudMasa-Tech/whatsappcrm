import { NextRequest, NextResponse } from 'next/server';
import { toErrorResponse } from '@/lib/auth/account';
import { requireProject, requireProjectRole } from '@/lib/auth/project';
import { resolveProjectChannel } from '@/lib/channels/resolve';
import { deriveSessionStatus, type StoredSessionStatus } from '@/lib/channels/session-status';
import { loadActiveLinkedInConfig } from '@/lib/linkedin/config-store';
import { loadActiveXConfig } from '@/lib/x/config-store';
import type { SocialPlatformStatus } from '@/lib/social/campaigns';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const requestedProjectId = request.nextUrl.searchParams.get('projectId')?.trim();
    const ctx =
      requestedProjectId && requestedProjectId !== 'all'
        ? await requireProject(requestedProjectId, 'agent')
        : await requireProjectRole('agent');

    const db = supabaseAdmin();
    const projectId = ctx.projectId;
    const channel = await resolveProjectChannel(db, projectId);
    const channelType = channel?.channelType ?? 'qr';

    // ---- WhatsApp ----------------------------------------------------------
    let whatsappStatus: SocialPlatformStatus = {
      platform: 'whatsapp',
      connected: false,
      label: 'WhatsApp',
      detail: null,
      mode: channelType,
      reason: 'WhatsApp is not connected for this project.',
    };

    if (channelType === 'qr') {
      const { data: sessionRow } = await db
        .from('whatsapp_sessions')
        .select('status, heartbeat_at, phone_number, display_name, last_error')
        .eq('project_id', projectId)
        .maybeSingle();

      const derived = deriveSessionStatus(
        (sessionRow?.status as StoredSessionStatus | undefined) ?? null,
        sessionRow?.heartbeat_at ?? null,
        Date.now(),
      );
      const isLive = derived === 'connected';
      whatsappStatus = {
        platform: 'whatsapp',
        connected: isLive,
        label: 'WhatsApp (QR)',
        detail: sessionRow?.phone_number || sessionRow?.display_name || null,
        mode: 'qr',
        reason: isLive
          ? null
          : sessionRow?.last_error ||
            `QR session status is "${derived}". Pair WhatsApp to enable broadcasts.`,
      };
    } else {
      const { data: waCfg } = await db
        .from('whatsapp_config')
        .select('phone_number_id, access_token, status')
        .eq('project_id', projectId)
        .maybeSingle();

      const hasCloudCreds = Boolean(waCfg?.phone_number_id && waCfg?.access_token);
      whatsappStatus = {
        platform: 'whatsapp',
        connected: hasCloudCreds,
        label: 'WhatsApp (Cloud API)',
        detail: waCfg?.phone_number_id ?? null,
        mode: 'cloud_api',
        reason: hasCloudCreds
          ? null
          : 'Configure WhatsApp Cloud API credentials in WhatsApp settings first.',
      };
    }

    // ---- Instagram ---------------------------------------------------------
    let instagramStatus: SocialPlatformStatus = {
      platform: 'instagram',
      connected: false,
      label: 'Instagram',
      detail: null,
      reason: 'Instagram is not connected for this project.',
    };
    {
      const { data: igRow } = await db
        .from('instagram_config')
        .select('status, connection_method, username, name, access_token, last_error')
        .eq('project_id', projectId)
        .maybeSingle();

      if (igRow) {
        if (igRow.status === 'connected' && igRow.connection_method === 'cloud_api' && igRow.access_token) {
          instagramStatus = {
            platform: 'instagram',
            connected: true,
            label: 'Instagram',
            detail: igRow.username ? `@${igRow.username}` : igRow.name || 'Connected',
            mode: 'cloud_api',
            reason: null,
          };
        } else if (igRow.status === 'connected') {
          instagramStatus = {
            platform: 'instagram',
            connected: false,
            label: 'Instagram',
            detail: igRow.username ? `@${igRow.username}` : igRow.name || null,
            mode: 'direct_login',
            reason:
              'Connected via Web Frame only — connect a Meta Cloud API token on the Instagram page to publish posts/reels via broadcast.',
          };
        } else {
          instagramStatus = {
            platform: 'instagram',
            connected: false,
            label: 'Instagram',
            detail: igRow.username ? `@${igRow.username}` : null,
            reason: igRow.last_error || `Instagram status: ${igRow.status}.`,
          };
        }
      }
    }

    // ---- Facebook ----------------------------------------------------------
    let facebookStatus: SocialPlatformStatus = {
      platform: 'facebook',
      connected: false,
      label: 'Facebook Page',
      detail: null,
      reason: 'Facebook Page is not connected for this project.',
    };
    {
      const { data: fbRow } = await db
        .from('facebook_config')
        .select('status, page_id, page_name, access_token, last_error')
        .eq('project_id', projectId)
        .maybeSingle();

      if (fbRow) {
        const isConnected =
          fbRow.status === 'connected' && Boolean(fbRow.page_id) && Boolean(fbRow.access_token);
        facebookStatus = {
          platform: 'facebook',
          connected: isConnected,
          label: 'Facebook Page',
          detail: fbRow.page_name || fbRow.page_id || null,
          mode: 'cloud_api',
          reason: isConnected
            ? null
            : fbRow.last_error || 'Reconnect your Facebook Page with a valid Page token.',
        };
      }
    }

    // ---- LinkedIn ----------------------------------------------------------
    let linkedinStatus: SocialPlatformStatus = {
      platform: 'linkedin',
      connected: false,
      label: 'LinkedIn',
      detail: null,
      reason: 'LinkedIn is not connected for this project.',
    };
    {
      const liCfg = await loadActiveLinkedInConfig(projectId).catch(() => null);
      if (liCfg) {
        const authorOptions: Array<{ label: string; value: string }> = [];
        if (liCfg.memberUrn) {
          authorOptions.push({
            label: `${liCfg.displayName || 'Personal Profile'} (Member)`,
            value: liCfg.memberUrn,
          });
        }
        if (liCfg.organizationUrn) {
          authorOptions.push({
            label: `${liCfg.displayName || 'Company Page'} (Organization)`,
            value: liCfg.organizationUrn,
          });
        }
        if (authorOptions.length === 0 && liCfg.authorUrn) {
          authorOptions.push({
            label: liCfg.displayName || liCfg.authorUrn,
            value: liCfg.authorUrn,
          });
        }

        linkedinStatus = {
          platform: 'linkedin',
          connected: true,
          label: 'LinkedIn',
          detail: liCfg.displayName || liCfg.authorUrn,
          mode: 'cloud_api',
          reason: null,
          authorOptions,
        };
      }
    }

    // ---- X (Twitter) -------------------------------------------------------
    let xStatus: SocialPlatformStatus = {
      platform: 'x',
      connected: false,
      label: 'X (Twitter)',
      detail: null,
      reason: 'X account is not connected for this project.',
    };
    {
      const xCfg = await loadActiveXConfig(projectId).catch(() => null);
      if (xCfg) {
        xStatus = {
          platform: 'x',
          connected: true,
          label: 'X (Twitter)',
          detail: xCfg.username ? `@${xCfg.username}` : xCfg.displayName || 'Connected',
          mode: 'cloud_api',
          reason: null,
        };
      }
    }

    // ---- Supporting Audience & Template Data -------------------------------
    const [{ data: tags }, { count: contactCount }, { data: waTemplates }] = await Promise.all([
      db
        .from('tags')
        .select('id, name, color')
        .eq('project_id', projectId)
        .order('name', { ascending: true }),
      db
        .from('contacts')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', projectId)
        .not('phone', 'is', null)
        .neq('phone', ''),
      db
        .from('message_templates')
        .select('id, name, language, category, body_text, header_type, header_content, header_media_url, footer_text, buttons')
        .eq('project_id', projectId)
        .eq('status', 'APPROVED')
        .order('created_at', { ascending: false }),
    ]);

    return NextResponse.json({
      projectId,
      platforms: [whatsappStatus, instagramStatus, facebookStatus, linkedinStatus, xStatus],
      whatsappAudience: {
        contactCount: contactCount ?? 0,
        tags: tags ?? [],
        approvedTemplates: waTemplates ?? [],
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
