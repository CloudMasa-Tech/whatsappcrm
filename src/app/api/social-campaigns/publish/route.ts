import { NextRequest, NextResponse } from 'next/server';
import { toErrorResponse } from '@/lib/auth/account';
import { requireProject, requireProjectRole } from '@/lib/auth/project';
import { resolveProjectChannel } from '@/lib/channels/resolve';
import { sendViaGateway, GatewayError } from '@/lib/channels/gateway';
import { deriveSessionStatus, type StoredSessionStatus } from '@/lib/channels/session-status';
import { findExistingContact } from '@/lib/contacts/dedupe';
import { publishFacebookPagePost } from '@/lib/facebook/meta-client';
import {
  InstagramMetaError,
  publishInstagramCarousel,
  publishInstagramPost,
  publishInstagramReel,
  publishInstagramStory,
} from '@/lib/instagram/meta-client';
import type { InstagramTokenType } from '@/lib/instagram/types';
import { LinkedInApiError, publishLinkedInPost } from '@/lib/linkedin/client';
import { loadActiveLinkedInConfig } from '@/lib/linkedin/config-store';
import {
  publishXPost,
  uploadXMediaFromUrl,
  XApiError,
} from '@/lib/x/client';
import { loadActiveXConfig } from '@/lib/x/config-store';
import { checkRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/rate-limit';
import {
  applySocialCaptionMergeFields,
  MAX_SOCIAL_WA_RECIPIENTS,
  type InstagramPublishMode,
  type SocialMediaItem,
  type SocialPlatform,
  type SocialPlatformPublishResult,
} from '@/lib/social/campaigns';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { decrypt } from '@/lib/whatsapp/encryption';
import { sendTemplateMessage } from '@/lib/whatsapp/meta-api';
import {
  isRecipientNotAllowedError,
  isValidE164,
  phoneVariants,
  sanitizePhoneForMeta,
} from '@/lib/whatsapp/phone-utils';
import { isMessageTemplate } from '@/lib/whatsapp/template-row-guard';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const VALID_PLATFORMS = new Set<SocialPlatform>([
  'whatsapp',
  'instagram',
  'facebook',
  'linkedin',
  'x',
]);

interface PublishRequestBody {
  projectId?: string;
  platforms?: SocialPlatform[];
  caption?: string;
  linkUrl?: string;
  media?: SocialMediaItem[];
  instagramType?: InstagramPublishMode;
  linkedinVisibility?: 'PUBLIC' | 'CONNECTIONS';
  linkedinAuthorUrn?: string;
  whatsapp?: {
    audienceType?: 'all' | 'tags' | 'csv';
    tagIds?: string[];
    csvRecipients?: Array<{ phone: string; name?: string | null }>;
    templateName?: string;
    templateLanguage?: string;
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function buildCaptionWithLink(caption: string, linkUrl: string): string {
  const cleanCaption = caption.trim();
  const cleanLink = linkUrl.trim();
  if (!cleanLink) return cleanCaption;
  if (cleanCaption.includes(cleanLink)) return cleanCaption;
  return cleanCaption ? `${cleanCaption}\n\n${cleanLink}` : cleanLink;
}

async function publishInstagramTarget(params: {
  projectId: string;
  caption: string;
  linkUrl: string;
  media: SocialMediaItem[];
  instagramType: InstagramPublishMode;
}): Promise<SocialPlatformPublishResult> {
  const { projectId, caption, linkUrl, media, instagramType } = params;
  const db = supabaseAdmin();

  const { data: config } = await db
    .from('instagram_config')
    .select('status, connection_method, access_token, instagram_business_id, token_type')
    .eq('project_id', projectId)
    .eq('status', 'connected')
    .maybeSingle();

  if (!config) {
    return {
      platform: 'instagram',
      status: 'failed',
      summary: 'Instagram not connected',
      error: 'Instagram account is not connected for this project.',
    };
  }

  if (config.connection_method !== 'cloud_api' || !config.access_token) {
    return {
      platform: 'instagram',
      status: 'failed',
      summary: 'Cloud API token required',
      error: 'Connect Instagram using a Meta Cloud API token to publish via Social Campaigns.',
    };
  }

  const visuals = media.filter((m) => m.kind === 'image' || m.kind === 'video');
  if (visuals.length === 0) {
    return {
      platform: 'instagram',
      status: 'skipped',
      summary: 'Media required for Instagram',
      error: 'Instagram Graph API requires at least one image or video.',
    };
  }

  const token = decrypt(config.access_token);
  const businessId = config.instagram_business_id || 'me';
  const tokenType = (config.token_type as InstagramTokenType | undefined) ?? null;
  const fullCaption = buildCaptionWithLink(caption, linkUrl).trim() || undefined;

  try {
    if (instagramType === 'story') {
      const first = visuals[0];
      const res = await publishInstagramStory(
        token,
        businessId,
        first.url,
        first.kind === 'video',
        tokenType,
      );
      return {
        platform: 'instagram',
        status: 'sent',
        externalId: res.mediaId,
        summary: 'Published Instagram Story',
      };
    }

    if (visuals.length >= 2 && instagramType !== 'reel' && instagramType !== 'post') {
      const res = await publishInstagramCarousel(
        token,
        businessId,
        visuals.slice(0, 10).map((item) => ({
          url: item.url,
          mediaType: item.kind === 'video' ? 'VIDEO' : 'IMAGE',
        })),
        fullCaption,
        tokenType,
      );
      return {
        platform: 'instagram',
        status: 'sent',
        externalId: res.mediaId,
        summary: `Published Instagram Carousel (${Math.min(visuals.length, 10)} items)`,
      };
    }

    const primary = visuals[0];
    if (instagramType === 'reel' || primary.kind === 'video') {
      if (primary.kind !== 'video') {
        return {
          platform: 'instagram',
          status: 'failed',
          summary: 'Reel requires a video',
          error: 'Select a video file to publish an Instagram Reel.',
        };
      }
      const res = await publishInstagramReel(
        token,
        businessId,
        primary.url,
        fullCaption,
        true,
        tokenType,
      );
      return {
        platform: 'instagram',
        status: 'sent',
        externalId: res.mediaId,
        summary: 'Published Instagram Reel',
      };
    }

    const res = await publishInstagramPost(
      token,
      businessId,
      primary.url,
      fullCaption,
      tokenType,
    );
    return {
      platform: 'instagram',
      status: 'sent',
      externalId: res.mediaId,
      summary: 'Published Instagram Photo Post',
    };
  } catch (err) {
    const message =
      err instanceof InstagramMetaError
        ? err.message
        : err instanceof Error
          ? err.message
          : 'Instagram publish failed';
    return {
      platform: 'instagram',
      status: 'failed',
      summary: 'Instagram publish failed',
      error: message,
    };
  }
}

async function publishFacebookTarget(params: {
  projectId: string;
  caption: string;
  linkUrl: string;
  media: SocialMediaItem[];
}): Promise<SocialPlatformPublishResult> {
  const { projectId, caption, linkUrl, media } = params;
  const db = supabaseAdmin();

  const { data: config } = await db
    .from('facebook_config')
    .select('status, page_id, page_name, access_token')
    .eq('project_id', projectId)
    .eq('status', 'connected')
    .maybeSingle();

  if (!config || !config.page_id || !config.access_token) {
    return {
      platform: 'facebook',
      status: 'failed',
      summary: 'Facebook Page not connected',
      error: 'Connect a Facebook Page for this project first.',
    };
  }

  const pageAccessToken = decrypt(config.access_token);
  const visuals = media.filter((m) => m.kind === 'image' || m.kind === 'video');
  const messageWithLink = visuals.length > 0 ? buildCaptionWithLink(caption, linkUrl) : caption;

  try {
    const res = await publishFacebookPagePost({
      pageAccessToken,
      pageId: config.page_id,
      message: messageWithLink,
      linkUrl: visuals.length === 0 ? linkUrl : undefined,
      mediaItems: visuals.map((m) => ({ url: m.url, kind: m.kind })),
    });

    const kindLabel =
      res.kind === 'video'
        ? 'Video'
        : res.kind === 'multi_photo'
          ? 'Multi-Photo Post'
          : res.kind === 'photo'
            ? 'Photo Post'
            : 'Feed Post';

    return {
      platform: 'facebook',
      status: 'sent',
      externalId: res.postId,
      summary: `Published Facebook ${kindLabel}${config.page_name ? ` on ${config.page_name}` : ''}`,
    };
  } catch (err) {
    return {
      platform: 'facebook',
      status: 'failed',
      summary: 'Facebook publish failed',
      error: err instanceof Error ? err.message : 'Facebook publish failed',
    };
  }
}

async function publishLinkedInTarget(params: {
  projectId: string;
  caption: string;
  linkUrl: string;
  media: SocialMediaItem[];
  visibility: 'PUBLIC' | 'CONNECTIONS';
  requestedAuthorUrn?: string;
}): Promise<SocialPlatformPublishResult> {
  const { projectId, caption, linkUrl, media, visibility, requestedAuthorUrn } = params;

  const cfg = await loadActiveLinkedInConfig(projectId).catch(() => null);
  if (!cfg) {
    return {
      platform: 'linkedin',
      status: 'failed',
      summary: 'LinkedIn not connected',
      error: 'Connect LinkedIn for this project first.',
    };
  }

  const cleanCaption = caption.trim();
  if (!cleanCaption) {
    return {
      platform: 'linkedin',
      status: 'failed',
      summary: 'LinkedIn post text required',
      error: 'Enter campaign text/caption to publish to LinkedIn.',
    };
  }

  const allowedAuthors = new Set(
    [cfg.memberUrn, cfg.organizationUrn, cfg.authorUrn].filter(Boolean) as string[],
  );
  const authorUrn =
    requestedAuthorUrn && allowedAuthors.has(requestedAuthorUrn)
      ? requestedAuthorUrn
      : cfg.authorUrn;

  const firstImage = media.find((m) => m.kind === 'image');
  const firstVideo = media.find((m) => m.kind === 'video');
  const articleUrl = linkUrl.trim() || (!firstImage && firstVideo ? firstVideo.url : '');

  try {
    const res = await publishLinkedInPost({
      accessToken: cfg.accessToken,
      authorUrn,
      text: cleanCaption,
      visibility,
      articleUrl: articleUrl || undefined,
      imageUrl: firstImage?.url,
    });

    const suffix = firstImage
      ? 'with Image'
      : articleUrl
        ? 'with Link'
        : 'Text Post';

    return {
      platform: 'linkedin',
      status: 'sent',
      externalId: res.postUrn,
      summary: `Published LinkedIn ${suffix}`,
    };
  } catch (err) {
    return {
      platform: 'linkedin',
      status: 'failed',
      summary: 'LinkedIn publish failed',
      error:
        err instanceof LinkedInApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'LinkedIn publish failed',
    };
  }
}

async function publishXTarget(params: {
  projectId: string;
  caption: string;
  linkUrl: string;
  media: SocialMediaItem[];
}): Promise<SocialPlatformPublishResult> {
  const { projectId, caption, linkUrl, media } = params;

  const cfg = await loadActiveXConfig(projectId).catch(() => null);
  if (!cfg) {
    return {
      platform: 'x',
      status: 'failed',
      summary: 'X not connected',
      error: 'Connect X (Twitter) for this project first.',
    };
  }

  const text = buildCaptionWithLink(caption, linkUrl);
  const images = media.filter((m) => m.kind === 'image').slice(0, 4);
  const firstVideo = media.find((m) => m.kind === 'video');
  const uploadItems = images.length > 0 ? images : firstVideo ? [firstVideo] : [];

  if (!text && uploadItems.length === 0) {
    return {
      platform: 'x',
      status: 'failed',
      summary: 'X post content required',
      error: 'Provide caption text or attach an image/video for X.',
    };
  }

  try {
    const mediaIds: string[] = [];
    for (const item of uploadItems) {
      const uploaded = await uploadXMediaFromUrl({
        accessToken: cfg.accessToken,
        mediaUrl: item.url,
        mimeType: item.mimeType,
      });
      mediaIds.push(uploaded.mediaId);
    }

    const res = await publishXPost({
      accessToken: cfg.accessToken,
      text: text || ' ',
      mediaIds: mediaIds.length > 0 ? mediaIds : undefined,
    });

    const summary =
      images.length > 1
        ? `Published X Post with ${images.length} Photos`
        : images.length === 1
          ? 'Published X Post with Photo'
          : firstVideo
            ? 'Published X Post with Video'
            : 'Published Post to X';

    return {
      platform: 'x',
      status: 'sent',
      externalId: res.id,
      summary,
    };
  } catch (err) {
    return {
      platform: 'x',
      status: 'failed',
      summary: 'X publish failed',
      error:
        err instanceof XApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'X publish failed',
    };
  }
}

async function resolveWhatsAppAudience(params: {
  accountId: string;
  projectId: string;
  audienceType: 'all' | 'tags' | 'csv';
  tagIds?: string[];
  csvRecipients?: Array<{ phone: string; name?: string | null }>;
}): Promise<Array<{ phone: string; name: string | null }>> {
  const { accountId, projectId, audienceType, tagIds, csvRecipients } = params;
  const db = supabaseAdmin();
  const seen = new Set<string>();
  const resolved: Array<{ phone: string; name: string | null }> = [];

  const pushUnique = (rawPhone: string | null | undefined, name?: string | null) => {
    if (!rawPhone) return;
    const clean = sanitizePhoneForMeta(rawPhone);
    if (!isValidE164(clean) || seen.has(clean)) return;
    seen.add(clean);
    resolved.push({ phone: clean, name: name?.trim() || null });
  };

  if (audienceType === 'csv') {
    for (const item of csvRecipients ?? []) {
      pushUnique(item.phone, item.name ?? null);
      if (resolved.length >= MAX_SOCIAL_WA_RECIPIENTS) break;
    }
    return resolved;
  }

  if (audienceType === 'tags') {
    const cleanTagIds = (tagIds ?? []).filter(Boolean);
    if (cleanTagIds.length === 0) return [];

    const { data: tagRows } = await db
      .from('contact_tags')
      .select('contact_id')
      .in('tag_id', cleanTagIds);

    const contactIds = Array.from(
      new Set((tagRows ?? []).map((r) => String(r.contact_id)).filter(Boolean)),
    ).slice(0, MAX_SOCIAL_WA_RECIPIENTS * 2);

    if (contactIds.length === 0) return [];

    const { data: contacts } = await db
      .from('contacts')
      .select('phone, name')
      .eq('account_id', accountId)
      .eq('project_id', projectId)
      .in('id', contactIds)
      .not('phone', 'is', null);

    for (const c of contacts ?? []) {
      pushUnique(c.phone, c.name);
      if (resolved.length >= MAX_SOCIAL_WA_RECIPIENTS) break;
    }
    return resolved;
  }

  const { data: contacts } = await db
    .from('contacts')
    .select('phone, name')
    .eq('account_id', accountId)
    .eq('project_id', projectId)
    .not('phone', 'is', null)
    .neq('phone', '')
    .limit(MAX_SOCIAL_WA_RECIPIENTS);

  for (const c of contacts ?? []) {
    pushUnique(c.phone, c.name);
  }
  return resolved;
}

async function publishWhatsAppTarget(params: {
  accountId: string;
  projectId: string;
  userId: string;
  caption: string;
  linkUrl: string;
  media: SocialMediaItem[];
  whatsappConfig?: PublishRequestBody['whatsapp'];
}): Promise<SocialPlatformPublishResult> {
  const { accountId, projectId, userId, caption, linkUrl, media, whatsappConfig } = params;
  const db = supabaseAdmin();
  const channel = await resolveProjectChannel(db, projectId);
  const channelType = channel?.channelType ?? 'qr';

  const audienceType = whatsappConfig?.audienceType ?? 'all';
  const recipients = await resolveWhatsAppAudience({
    accountId,
    projectId,
    audienceType,
    tagIds: whatsappConfig?.tagIds,
    csvRecipients: whatsappConfig?.csvRecipients,
  });

  if (recipients.length === 0) {
    return {
      platform: 'whatsapp',
      status: 'failed',
      summary: 'No valid WhatsApp recipients',
      error:
        audienceType === 'csv'
          ? 'No valid phone numbers found in your WhatsApp CSV/list.'
          : audienceType === 'tags'
            ? 'No contacts with phone numbers match the selected tags.'
            : 'No project contacts with valid phone numbers found.',
    };
  }

  if (channelType === 'qr') {
    const { data: sessionRow } = await db
      .from('whatsapp_sessions')
      .select('status, heartbeat_at, last_error')
      .eq('project_id', projectId)
      .maybeSingle();

    const derived = deriveSessionStatus(
      (sessionRow?.status as StoredSessionStatus | undefined) ?? null,
      sessionRow?.heartbeat_at ?? null,
      Date.now(),
    );

    if (derived !== 'connected') {
      return {
        platform: 'whatsapp',
        status: 'failed',
        summary: 'WhatsApp QR not connected',
        error:
          sessionRow?.last_error ||
          `WhatsApp QR session is "${derived}". Connect your WhatsApp session first.`,
      };
    }

    const baseText = buildCaptionWithLink(caption, linkUrl);
    if (!baseText && media.length === 0) {
      return {
        platform: 'whatsapp',
        status: 'failed',
        summary: 'Nothing to send on WhatsApp',
        error: 'Provide a message caption, link, or media attachment.',
      };
    }

    let sent = 0;
    let failed = 0;
    let firstError: string | null = null;
    let firstMessageId: string | null = null;

    for (let i = 0; i < recipients.length; i++) {
      const recipient = recipients[i];
      const personalized = applySocialCaptionMergeFields(baseText, {
        name: recipient.name,
        phone: recipient.phone,
      });

      try {
        let externalId: string | null = null;

        if (media.length > 0) {
          for (let mIdx = 0; mIdx < media.length; mIdx++) {
            const item = media[mIdx];
            const res = await sendViaGateway({
              projectId,
              to: recipient.phone,
              kind: item.kind,
              text: mIdx === 0 ? personalized || null : null,
              mediaUrl: item.url,
              filename: item.fileName ?? null,
              mimeType: item.mimeType ?? null,
            });
            if (mIdx === 0) externalId = res.externalId;
          }
        } else {
          const res = await sendViaGateway({
            projectId,
            to: recipient.phone,
            kind: 'text',
            text: personalized,
          });
          externalId = res.externalId;
        }

        if (!firstMessageId && externalId) firstMessageId = externalId;
        sent += 1;

        // Best-effort inbox sync so replies continue inside CRM Inbox
        try {
          let contact = await findExistingContact(db, accountId, recipient.phone, projectId);
          if (!contact) {
            const { data: inserted } = await db
              .from('contacts')
              .insert({
                account_id: accountId,
                project_id: projectId,
                user_id: userId,
                phone: recipient.phone,
                name: recipient.name,
              })
              .select('id')
              .maybeSingle();
            contact = inserted as typeof contact;
          }
          if (contact) {
            let { data: conv } = await db
              .from('conversations')
              .select('id')
              .eq('project_id', projectId)
              .eq('contact_id', contact.id)
              .maybeSingle();
            if (!conv) {
              const { data: newConv } = await db
                .from('conversations')
                .insert({
                  account_id: accountId,
                  project_id: projectId,
                  contact_id: contact.id,
                  user_id: userId,
                  status: 'open',
                  unread_count: 0,
                  last_message_text: personalized || `[${media[0]?.kind ?? 'media'}]`,
                  last_message_at: new Date().toISOString(),
                })
                .select('id')
                .single();
              conv = newConv;
            }
            if (conv) {
              await db.from('messages').insert({
                conversation_id: conv.id,
                project_id: projectId,
                sender_type: 'agent',
                content_type: media[0]?.kind ?? 'text',
                content_text: personalized || null,
                media_url: media[0]?.url ?? null,
                message_id: externalId,
                status: 'sent',
              });
              await db
                .from('conversations')
                .update({
                  last_message_text: personalized || `[${media[0]?.kind ?? 'media'}]`,
                  last_message_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                })
                .eq('id', conv.id);
            }
          }
        } catch {
          // Non-fatal inbox sync
        }
      } catch (err) {
        failed += 1;
        if (!firstError) {
          firstError =
            err instanceof GatewayError
              ? err.message
              : err instanceof Error
                ? err.message
                : 'WhatsApp gateway send failed';
        }
      }

      if (i < recipients.length - 1) {
        await sleep(1200);
      }
    }

    return {
      platform: 'whatsapp',
      status: sent > 0 ? 'sent' : 'failed',
      externalId: firstMessageId,
      summary: `WhatsApp QR: sent ${sent} of ${recipients.length}`,
      error: sent === 0 ? firstError : failed > 0 ? `${failed} failed (${firstError ?? 'check contacts'})` : null,
      stats: { total: recipients.length, sent, failed },
    };
  }

  // ---- WhatsApp Cloud API -------------------------------------------------
  const templateName = whatsappConfig?.templateName?.trim();
  const templateLanguage = whatsappConfig?.templateLanguage?.trim() || 'en_US';
  if (!templateName) {
    return {
      platform: 'whatsapp',
      status: 'failed',
      summary: 'Approved template required',
      error:
        'WhatsApp Cloud API requires selecting an approved Meta Template (or use QR mode for direct caption + media broadcasts).',
    };
  }

  const { data: waCfg } = await db
    .from('whatsapp_config')
    .select('phone_number_id, access_token')
    .eq('project_id', projectId)
    .maybeSingle();

  if (!waCfg?.phone_number_id || !waCfg?.access_token) {
    return {
      platform: 'whatsapp',
      status: 'failed',
      summary: 'WhatsApp Cloud API not configured',
      error: 'Save WhatsApp Cloud API credentials in WhatsApp settings first.',
    };
  }

  const { data: rawTemplateRow } = await db
    .from('message_templates')
    .select('*')
    .eq('project_id', projectId)
    .eq('name', templateName)
    .eq('language', templateLanguage)
    .maybeSingle();

  if (rawTemplateRow && !isMessageTemplate(rawTemplateRow)) {
    return {
      platform: 'whatsapp',
      status: 'failed',
      summary: 'Template metadata invalid',
      error: 'Selected Meta template could not be parsed. Sync templates first.',
    };
  }

  const accessToken = decrypt(waCfg.access_token);
  const firstMediaUrl = media[0]?.url;
  const captionText = buildCaptionWithLink(caption, linkUrl);

  let sent = 0;
  let failed = 0;
  let firstError: string | null = null;
  let firstMessageId: string | null = null;

  for (let i = 0; i < recipients.length; i++) {
    const recipient = recipients[i];
    const variants = phoneVariants(recipient.phone);
    const bodyText = rawTemplateRow?.body_text ?? '';
    const placeholderMatches = bodyText.match(/\{\{\d+\}\}/g) ?? [];
    const paramValues =
      placeholderMatches.length > 0
        ? placeholderMatches.map((_: string, idx: number) =>
            idx === 0
              ? recipient.name || captionText.slice(0, 80) || 'there'
              : captionText.slice(0, 80) || 'update',
          )
        : [];

    let sentId: string | null = null;
    let lastErr: string | null = null;

    for (const variant of variants) {
      try {
        const res = await sendTemplateMessage({
          phoneNumberId: waCfg.phone_number_id,
          accessToken,
          to: variant,
          templateName,
          language: templateLanguage,
          template: rawTemplateRow ?? undefined,
          params: paramValues,
          messageParams: firstMediaUrl ? { headerMediaUrl: firstMediaUrl } : undefined,
        });
        sentId = res.messageId;
        lastErr = null;
        break;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        lastErr = msg;
        if (!isRecipientNotAllowedError(msg)) break;
      }
    }

    if (sentId) {
      sent += 1;
      if (!firstMessageId) firstMessageId = sentId;
    } else {
      failed += 1;
      if (!firstError) firstError = lastErr;
    }

    if (i < recipients.length - 1) {
      await sleep(500);
    }
  }

  return {
    platform: 'whatsapp',
    status: sent > 0 ? 'sent' : 'failed',
    externalId: firstMessageId,
    summary: `WhatsApp Cloud API: sent ${sent} of ${recipients.length}`,
    error: sent === 0 ? firstError : failed > 0 ? `${failed} failed (${firstError ?? 'check numbers'})` : null,
    stats: { total: recipients.length, sent, failed },
  };
}

export async function POST(request: NextRequest) {
  let ctx;
  try {
    const body = (await request.json().catch(() => null)) as PublishRequestBody | null;
    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const requestedProjectId =
      typeof body.projectId === 'string' && body.projectId.trim() && body.projectId.trim() !== 'all'
        ? body.projectId.trim()
        : null;

    ctx = requestedProjectId
      ? await requireProject(requestedProjectId, 'agent')
      : await requireProjectRole('agent');

    const limit = checkRateLimit(
      `social:publish:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const platforms = Array.from(
      new Set((body.platforms ?? []).filter((p): p is SocialPlatform => VALID_PLATFORMS.has(p))),
    );
    if (platforms.length === 0) {
      return NextResponse.json(
        { error: 'Select at least one connected platform to broadcast.' },
        { status: 400 },
      );
    }

    const caption = typeof body.caption === 'string' ? body.caption.trim() : '';
    const linkUrl = typeof body.linkUrl === 'string' ? body.linkUrl.trim() : '';
    const media: SocialMediaItem[] = Array.isArray(body.media)
      ? body.media
          .filter(
            (m): m is SocialMediaItem =>
              Boolean(m && typeof m.url === 'string' && m.url.trim()),
          )
          .map(
            (m): SocialMediaItem => ({
              url: m.url.trim(),
              kind: m.kind === 'video' || m.kind === 'document' ? m.kind : 'image',
              fileName: m.fileName,
              mimeType: m.mimeType,
            }),
          )
      : [];

    if (!caption && !linkUrl && media.length === 0) {
      return NextResponse.json(
        { error: 'Enter campaign text, attach media, or provide a link URL.' },
        { status: 400 },
      );
    }

    const tasks = platforms.map(async (platform): Promise<SocialPlatformPublishResult> => {
      switch (platform) {
        case 'instagram':
          return publishInstagramTarget({
            projectId: ctx!.projectId,
            caption,
            linkUrl,
            media,
            instagramType: body.instagramType ?? 'auto',
          });
        case 'facebook':
          return publishFacebookTarget({
            projectId: ctx!.projectId,
            caption,
            linkUrl,
            media,
          });
        case 'linkedin':
          return publishLinkedInTarget({
            projectId: ctx!.projectId,
            caption,
            linkUrl,
            media,
            visibility: body.linkedinVisibility === 'CONNECTIONS' ? 'CONNECTIONS' : 'PUBLIC',
            requestedAuthorUrn: body.linkedinAuthorUrn,
          });
        case 'whatsapp':
          return publishWhatsAppTarget({
            accountId: ctx!.accountId,
            projectId: ctx!.projectId,
            userId: ctx!.userId,
            caption,
            linkUrl,
            media,
            whatsappConfig: body.whatsapp,
          });
        case 'x':
          return publishXTarget({
            projectId: ctx!.projectId,
            caption,
            linkUrl,
            media,
          });
      }
    });

    const settled = await Promise.all(tasks);
    const anySent = settled.some((r) => r.status === 'sent');

    return NextResponse.json(
      {
        success: anySent,
        results: settled,
      },
      { status: anySent ? 200 : 207 },
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
