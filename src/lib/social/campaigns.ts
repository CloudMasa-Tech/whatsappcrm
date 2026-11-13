/**
 * Shared types, starter templates, media classification, and audience helpers
 * for cross-platform Social Campaigns (WhatsApp, Instagram, Facebook, LinkedIn).
 */

export type SocialPlatform = 'whatsapp' | 'instagram' | 'facebook' | 'linkedin' | 'x';

export type SocialMediaKind = 'image' | 'video' | 'document';

export interface SocialMediaItem {
  url: string;
  kind: SocialMediaKind;
  fileName?: string;
  mimeType?: string;
}

export type InstagramPublishMode = 'auto' | 'post' | 'reel' | 'story';

export interface SocialPlatformStatus {
  platform: SocialPlatform;
  connected: boolean;
  label: string;
  detail: string | null;
  mode?: 'qr' | 'cloud_api' | 'direct_login' | null;
  reason?: string | null;
  authorOptions?: Array<{ label: string; value: string }>;
}

export interface SocialStarterTemplate {
  id: string;
  name: string;
  category: string;
  description: string;
  caption: string;
  linkUrl?: string;
  suggestedPlatforms: SocialPlatform[];
}

export interface SavedSocialTemplate {
  id: string;
  name: string;
  caption: string;
  linkUrl?: string;
  media: SocialMediaItem[];
  platforms: SocialPlatform[];
  updatedAt: string;
}

export interface SocialPlatformPublishResult {
  platform: SocialPlatform;
  status: 'sent' | 'skipped' | 'failed';
  summary: string;
  externalId?: string | null;
  error?: string | null;
  stats?: {
    total: number;
    sent: number;
    failed: number;
  };
}

export interface SocialCampaignHistoryEntry {
  id: string;
  name: string;
  caption: string;
  linkUrl?: string;
  media: SocialMediaItem[];
  platforms: SocialPlatform[];
  results: SocialPlatformPublishResult[];
  createdAt: string;
}

export const SOCIAL_PLATFORM_LABELS: Record<SocialPlatform, string> = {
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  facebook: 'Facebook',
  linkedin: 'LinkedIn',
  x: 'X (Twitter)',
};

export const MAX_SOCIAL_MEDIA_BYTES = 50 * 1024 * 1024;
export const MAX_SOCIAL_WA_RECIPIENTS = 250;

export const STARTER_SOCIAL_TEMPLATES: SocialStarterTemplate[] = [
  {
    id: 'regibiz-launch-promo',
    name: 'RegiBIZ — Launch & Compliance Promo',
    category: 'RegiBIZ',
    description: 'Cross-channel post announcing GST, Pvt Ltd/LLP, Udyam & FSSAI filings.',
    linkUrl: 'https://regibiz.in',
    suggestedPlatforms: ['whatsapp', 'instagram', 'facebook', 'linkedin', 'x'],
    caption: `Launching or scaling your business in India?

Skip the paperwork delays with RegiBIZ by CloudMaSa:
• Private Limited, LLP & Startup India Incorporation
• GST Registration & Monthly Compliance
• MSME (Udyam), FSSAI, Trademark & ROC Filings

Track every step online with CA-backed support & a secure Document Vault.
Explore plans: https://regibiz.in`,
  },
  {
    id: 'product-announcement',
    name: 'Product / Feature Announcement',
    category: 'Launch',
    description: 'Share a new release, image/demo reel, and link across every channel.',
    linkUrl: '',
    suggestedPlatforms: ['whatsapp', 'instagram', 'facebook', 'linkedin', 'x'],
    caption: `Big update is live!

We just rolled out a faster, simpler experience for teams — built from your feedback.

Check it out and reply here if you'd like a quick walkthrough.`,
  },
  {
    id: 'limited-time-offer',
    name: 'Limited-Time Offer / Festive Campaign',
    category: 'Promotion',
    description: 'High-contrast promo post for WA contacts + IG/FB/LinkedIn feeds.',
    linkUrl: '',
    suggestedPlatforms: ['whatsapp', 'instagram', 'facebook', 'linkedin', 'x'],
    caption: `Special limited-time offer for this week!

Book your slot or reply to this message to claim early access before it closes.`,
  },
];

export function detectMediaKindFromMimeOrUrl(input: string): SocialMediaKind {
  const lower = input.toLowerCase();
  if (
    lower.startsWith('video/') ||
    /\.(mp4|mov|webm|m4v|avi)(\?|#|$)/i.test(lower)
  ) {
    return 'video';
  }
  if (
    lower.startsWith('image/') ||
    /\.(png|jpe?g|gif|webp|bmp|svg)(\?|#|$)/i.test(lower)
  ) {
    return 'image';
  }
  return 'document';
}

export function validateSocialMediaFile(
  fileName: string,
  mimeType: string,
  size: number,
): string | null {
  if (size <= 0) {
    return `"${fileName}" is empty.`;
  }
  if (size > MAX_SOCIAL_MEDIA_BYTES) {
    return `"${fileName}" exceeds the 50 MB upload limit.`;
  }
  const cleanType = mimeType.toLowerCase();
  const allowed =
    cleanType.startsWith('image/') ||
    cleanType.startsWith('video/') ||
    cleanType === 'application/pdf' ||
    /\.(png|jpe?g|gif|webp|mp4|mov|webm|pdf)$/i.test(fileName);
  if (!allowed) {
    return `"${fileName}" is not a supported image, video, or PDF file.`;
  }
  return null;
}

/**
 * Parses comma-, semicolon-, or newline-separated phone lines (`+9198..., Name` or `Name, +9198...`).
 */
export function parseWhatsAppPhoneLines(
  raw: string,
): Array<{ phone: string; name: string | null }> {
  const lines = raw
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const seen = new Set<string>();
  const out: Array<{ phone: string; name: string | null }> = [];

  for (const line of lines) {
    const parts = line
      .split(/[,;\t]+/)
      .map((p) => p.trim().replace(/^["']+|["']+$/g, '').trim())
      .filter(Boolean);

    if (parts.length === 0) continue;

    if (parts.length >= 2) {
      const phoneCandidate = parts.find((p) => /\d{7,}/.test(p.replace(/[^\d]/g, '')));
      if (!phoneCandidate) continue;
      const digits = phoneCandidate.replace(/[^\d+]/g, '');
      if (!digits || seen.has(digits)) continue;
      seen.add(digits);
      const nameCandidate = parts.find((p) => p !== phoneCandidate) ?? null;
      out.push({ phone: digits, name: nameCandidate || null });
      continue;
    }

    const single = parts[0].replace(/[^\d+]/g, '');
    if (single.replace(/\D/g, '').length >= 7 && !seen.has(single)) {
      seen.add(single);
      out.push({ phone: single, name: null });
    }
  }

  return out;
}

export function applySocialCaptionMergeFields(
  text: string,
  vars: { name?: string | null; phone?: string },
): string {
  const cleanName = vars.name?.trim() || 'there';
  const cleanPhone = vars.phone?.trim() || '';
  return text
    .replace(/\{\{\s*name\s*\}\}/gi, cleanName)
    .replace(/\{\{\s*phone\s*\}\}/gi, cleanPhone);
}

/**
 * Produces user-facing compatibility hints before broadcasting across heterogeneous channels.
 */
export function getPlatformCompatibilityWarnings(params: {
  platforms: SocialPlatform[];
  media: SocialMediaItem[];
  caption: string;
  whatsappMode?: 'qr' | 'cloud_api' | null;
  whatsappTemplateName?: string | null;
}): Array<{ platform: SocialPlatform; level: 'error' | 'info'; message: string }> {
  const warnings: Array<{
    platform: SocialPlatform;
    level: 'error' | 'info';
    message: string;
  }> = [];
  const { platforms, media, caption, whatsappMode, whatsappTemplateName } = params;
  const hasImage = media.some((m) => m.kind === 'image');
  const hasVideo = media.some((m) => m.kind === 'video');
  const hasDocument = media.some((m) => m.kind === 'document');

  if (platforms.includes('instagram')) {
    if (!hasImage && !hasVideo) {
      warnings.push({
        platform: 'instagram',
        level: 'error',
        message: 'Instagram requires at least 1 photo or video (Meta Graph API does not allow text-only feed posts).',
      });
    } else if (hasDocument) {
      warnings.push({
        platform: 'instagram',
        level: 'info',
        message: 'Instagram ignores PDF/document attachments and publishes only your photos/videos.',
      });
    }
  }

  if (platforms.includes('facebook') && hasDocument && !hasImage && !hasVideo) {
    warnings.push({
      platform: 'facebook',
      level: 'info',
      message: 'Facebook Page feed will post your message text (attach a photo/video or link URL for rich media).',
    });
  }

  if (platforms.includes('linkedin')) {
    if (!caption.trim()) {
      warnings.push({
        platform: 'linkedin',
        level: 'error',
        message: 'LinkedIn requires post text / caption.',
      });
    } else if (!hasImage && hasVideo) {
      warnings.push({
        platform: 'linkedin',
        level: 'info',
        message: 'LinkedIn currently uploads images directly — video-only posts publish your text & link.',
      });
    }
  }

  if (platforms.includes('whatsapp') && whatsappMode === 'cloud_api' && !whatsappTemplateName) {
    warnings.push({
      platform: 'whatsapp',
      level: 'error',
      message: 'WhatsApp is in Cloud API mode — select an approved Meta Template to broadcast.',
    });
  }

  if (platforms.includes('x')) {
    if (!caption.trim() && !hasImage && !hasVideo) {
      warnings.push({
        platform: 'x',
        level: 'error',
        message: 'X requires post text or an attached image/video.',
      });
    } else if (caption.trim().length > 280) {
      warnings.push({
        platform: 'x',
        level: 'info',
        message: `Caption is ${caption.trim().length} characters — standard X accounts enforce a 280-character limit (Premium accounts allow longer posts).`,
      });
    }
    if (hasDocument) {
      warnings.push({
        platform: 'x',
        level: 'info',
        message: 'X ignores PDF/document attachments and publishes your text and images/video.',
      });
    }
  }

  return warnings;
}

