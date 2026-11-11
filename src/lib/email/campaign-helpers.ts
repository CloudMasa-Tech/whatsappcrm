/**
 * Client- and server-safe helpers for email campaign templates, recipient parsing,
 * plain-text-to-HTML formatting, and safe merge-field fallbacks.
 */

export interface ParsedRecipient {
  email: string;
  name: string | null;
}

export interface StarterEmailTemplate {
  id: string;
  name: string;
  category: string;
  description: string;
  defaultCampaignName: string;
  subject: string;
  bodyHtml: string;
}

export interface SavedCustomEmailTemplate {
  id: string;
  name: string;
  subject: string;
  bodyHtml: string;
  updatedAt: string;
}

export const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

/**
 * Starter templates ready to load in the Email Campaigns composer.
 */
export const STARTER_EMAIL_TEMPLATES: StarterEmailTemplate[] = [
  {
    id: 'regibiz-first-outreach',
    name: 'RegiBIZ — First Customer Outreach',
    category: 'Outreach',
    description:
      'Founder/team cold outreach for startups & SMBs needing GST, incorporation, or licenses.',
    defaultCampaignName: 'RegiBIZ First Customer Outreach',
    subject: 'Quick question — simplify GST & company registration with RegiBIZ',
    bodyHtml: `<p>Hi {{name}},</p>

<p>I'm [Your Name] from <strong>CloudMaSa</strong>, and we've built <strong>RegiBIZ</strong> to help startups and growing businesses handle GST, company incorporation (Pvt Ltd / LLP), MSME/Udyam, FSSAI, trademark, and ROC compliance without paperwork delays.</p>

<p>I thought this might be relevant for you because many founders spend too much time chasing agents and scattered documents instead of tracking filings and CA consultations in one place.</p>

<p>Would you be open to a quick 10–15 minute call to see if RegiBIZ could be useful for your team? I'd be happy to share a short walkthrough and get your thoughts.</p>

<p>
  Best,<br />
  [Your Name]<br />
  CloudMaSa / RegiBIZ<br />
  <a href="https://regibiz.in">regibiz.in</a> | +91 63645 62818
</p>`,
  },
  {
    id: 'regibiz-offer-launch',
    name: 'RegiBIZ — Launch Offer',
    category: 'Promotion',
    description: 'Promotional outreach highlighting GST, Udyam, FSSAI & startup registration services.',
    defaultCampaignName: 'RegiBIZ Launch Offer',
    subject: 'Special offer on GST & business registrations — RegiBIZ by CloudMaSa',
    bodyHtml: `<p>Hi {{name}},</p>

<p>We're helping founders and SMEs across India launch and stay compliant faster with <strong>RegiBIZ</strong> — backed by verified Chartered Accountants and a digital Document Vault.</p>

<p>Popular services available online right now:</p>
<ul>
  <li>Private Limited / LLP / Startup India (DPIIT) Incorporation</li>
  <li>GST Registration &amp; Monthly Return Filing</li>
  <li>MSME (Udyam), FSSAI Food License, Trademark &amp; DSC</li>
  <li>ROC / MCA Annual Compliance Filings</li>
</ul>

<p>Reply directly to this email or visit <a href="https://regibiz.in">regibiz.in</a> to claim your launch offer and book a free 10-minute consultation.</p>

<p>
  Warm regards,<br />
  [Your Name]<br />
  Team RegiBIZ (CloudMaSa)<br />
  info@cloudmasa.com | +91 63645 62818
</p>`,
  },
  {
    id: 'regibiz-followup',
    name: 'RegiBIZ — Quick Follow-Up',
    category: 'Follow-Up',
    description: 'Short bump email for prospects who did not reply to your first RegiBIZ outreach.',
    defaultCampaignName: 'RegiBIZ Follow-Up',
    subject: 'Re: GST & compliance support for your business (RegiBIZ)',
    bodyHtml: `<p>Hi {{name}},</p>

<p>Just floating this back up in case my earlier note got buried.</p>

<p>If you're planning any GST setup, Private Limited/LLP registration, Udyam/FSSAI licensing, or annual ROC filings soon, we'd love to show how <strong>RegiBIZ</strong> keeps every document and status update in one dashboard.</p>

<p>Happy to jump on a brief call whenever convenient — just reply with a good time.</p>

<p>
  Best,<br />
  [Your Name]<br />
  RegiBIZ — <a href="https://regibiz.in">regibiz.in</a>
</p>`,
  },
];

/**
 * Parses comma-, semicolon-, or newline-separated recipient input.
 * Supports plain emails (`user@domain.com`) and `"Display Name <user@domain.com>"`.
 */
export function parseRecipientInput(raw: string | string[]): ParsedRecipient[] {
  const tokens = Array.isArray(raw)
    ? raw
    : raw
        .split(/[\r\n,;]+/)
        .map((part) => part.trim())
        .filter(Boolean);

  const byEmail = new Map<string, string | null>();

  for (const item of tokens) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed) continue;

    let parsedName: string | null = null;
    let candidateEmail = trimmed;

    const angleMatch = trimmed.match(/^(.*?)<\s*([^<>\s]+)\s*>$/);
    if (angleMatch) {
      const rawName = angleMatch[1].trim().replace(/^["']+|["']+$/g, '').trim();
      parsedName = rawName || null;
      candidateEmail = angleMatch[2].trim();
    }

    const normalizedEmail = candidateEmail.toLowerCase();
    if (!EMAIL_REGEX.test(normalizedEmail)) continue;

    if (!byEmail.has(normalizedEmail)) {
      byEmail.set(normalizedEmail, parsedName);
    } else if (!byEmail.get(normalizedEmail) && parsedName) {
      byEmail.set(normalizedEmail, parsedName);
    }
  }

  return Array.from(byEmail.entries()).map(([email, name]) => ({ email, name }));
}

function escapeHtmlText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const HTML_TAG_RE =
  /<\/?(?:p|br|div|span|a|strong|b|em|i|u|ul|ol|li|h[1-6]|table|thead|tbody|tr|td|th|img|html|body|head|style|blockquote|pre|code|hr)\b[^>]*>/i;

/**
 * Converts plain text (no HTML tags) into `<p>` / `<br />` HTML so line breaks
 * entered in the campaign editor survive email client rendering.
 * Existing HTML strings are returned untouched.
 */
export function ensureEmailHtml(body: string): string {
  if (!body) return '';
  if (HTML_TAG_RE.test(body)) {
    return body;
  }

  const normalized = body.replace(/\r\n/g, '\n').trim();
  if (!normalized) return '';

  return normalized
    .split(/\n{2,}/)
    .map((paragraph) => {
      const lines = escapeHtmlText(paragraph).replace(/\n/g, '<br />');
      return `<p>${lines}</p>`;
    })
    .join('\n\n');
}

/**
 * Generates a readable plain-text version from HTML for email `text` fallback
 * and CRM inbox message previews.
 */
export function htmlToPlainText(html: string): string {
  if (!html) return '';
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|div|li|h[1-6]|tr)\s*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Returns merge-field objects for subject and body, falling back cleanly
 * when a pasted/imported recipient has no contact name (`Hi there,` instead of `Hi {{name}},`).
 */
export function resolveSendMergeValues(recipient: {
  email: string;
  name?: string | null;
}): {
  subjectFields: { name: string; email: string };
  bodyFields: { name: string; email: string };
} {
  const cleanName = recipient.name?.trim();
  return {
    subjectFields: {
      name: cleanName || 'you',
      email: recipient.email,
    },
    bodyFields: {
      name: cleanName || 'there',
      email: recipient.email,
    },
  };
}
