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
  fromName?: string;
  updatedAt: string;
}

/**
 * Normalizes a campaign or project sender display name and strips characters
 * (`"`, `<`, `>`, CR, LF) that would break an RFC 5322 `"Name" <email>` header.
 */
export function sanitizeSenderName(raw?: string | null): string {
  if (!raw) return '';
  return raw
    .replace(/[\r\n"<>]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
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

export const SAMPLE_EMAIL_IMPORT_CSV =
  'name,email\nPriya Sharma,priya@company.com\nRahul Nair,rahul@startup.in\n';

function parseDelimitedLine(line: string, delimiters: string | string[]): string[] {
  const delimSet = new Set(Array.isArray(delimiters) ? delimiters : [delimiters]);
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (delimSet.has(ch) && !inQuotes) {
      cells.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

function cleanCell(raw: string | undefined): string {
  if (!raw) return '';
  return raw.trim().replace(/^["']+|["']+$/g, '').trim();
}

export interface EmailImportParseResult {
  recipients: ParsedRecipient[];
  totalRows: number;
  skippedCount: number;
}

/**
 * Parses bulk email recipients from uploaded CSV, TSV, or plain-text files.
 * Supports:
 *   - Headered CSV/TSV/semicolon files (`email`, `e-mail`, `email_address`, `name`, `first_name` + `last_name`)
 *   - Headerless two-column rows (`Priya Sharma, priya@company.com` or `priya@company.com, Priya Sharma`)
 *   - Plain lists with one or more emails per line (`"Priya <priya@company.com>"` or `priya@company.com`)
 */
export function parseEmailImportText(text: string): EmailImportParseResult {
  const cleanText = text.replace(/^\uFEFF/, '').trim();
  if (!cleanText) {
    return { recipients: [], totalRows: 0, skippedCount: 0 };
  }

  const lines = cleanText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return { recipients: [], totalRows: 0, skippedCount: 0 };
  }

  const firstLine = lines[0];
  const delimiter = firstLine.includes('\t')
    ? '\t'
    : firstLine.includes(';') && !firstLine.includes(',')
      ? ';'
      : ',';

  const headerCells = parseDelimitedLine(firstLine, delimiter).map((h) =>
    cleanCell(h).toLowerCase().replace(/\s+/g, '_'),
  );

  const emailIdx = headerCells.findIndex((h) =>
    ['email', 'e-mail', 'email_address', 'emailaddress', 'mail'].includes(h),
  );

  const byEmail = new Map<string, string | null>();
  let totalRows = 0;
  let skippedCount = 0;

  const recordCandidate = (rawEmail: string, rawName?: string | null) => {
    totalRows += 1;
    const normalized = rawEmail.trim().toLowerCase();
    if (!EMAIL_REGEX.test(normalized)) {
      skippedCount += 1;
      return;
    }
    const cleanName = rawName?.trim() || null;
    if (!byEmail.has(normalized)) {
      byEmail.set(normalized, cleanName);
    } else {
      skippedCount += 1;
      if (!byEmail.get(normalized) && cleanName) {
        byEmail.set(normalized, cleanName);
      }
    }
  };

  if (emailIdx >= 0) {
    const nameIdx = headerCells.findIndex((h) =>
      ['name', 'full_name', 'fullname', 'contact_name'].includes(h),
    );
    const firstIdx = headerCells.findIndex((h) =>
      ['first_name', 'firstname'].includes(h),
    );
    const lastIdx = headerCells.findIndex((h) =>
      ['last_name', 'lastname'].includes(h),
    );

    for (let i = 1; i < lines.length; i++) {
      const cells = parseDelimitedLine(lines[i], delimiter);
      const rawEmail = cleanCell(cells[emailIdx]);
      let fullName = nameIdx >= 0 ? cleanCell(cells[nameIdx]) : '';
      if (!fullName && (firstIdx >= 0 || lastIdx >= 0)) {
        fullName = [
          firstIdx >= 0 ? cleanCell(cells[firstIdx]) : '',
          lastIdx >= 0 ? cleanCell(cells[lastIdx]) : '',
        ]
          .filter(Boolean)
          .join(' ');
      }
      if (!rawEmail && !fullName) continue;
      recordCandidate(rawEmail, fullName || null);
    }
  } else {
    const angleRegex = /^([^<>]*)<([^<>\s@]+@[^<>\s@]+\.[^<>\s@]+)>\s*$/;
    for (const line of lines) {
      const cells = parseDelimitedLine(line, [',', ';', '\t'])
        .map(cleanCell)
        .filter(Boolean);
      const emailCells = cells.filter((c) => EMAIL_REGEX.test(c.toLowerCase()));

      if (emailCells.length === 1 && cells.length === 2) {
        const other = cells.find((c) => c !== emailCells[0]) ?? '';
        if (!angleRegex.test(other)) {
          recordCandidate(emailCells[0], other || null);
          continue;
        }
      }

      for (const cell of cells) {
        const angleMatch = cell.match(angleRegex);
        if (angleMatch) {
          recordCandidate(angleMatch[2], cleanCell(angleMatch[1]) || null);
        } else if (EMAIL_REGEX.test(cell.toLowerCase())) {
          recordCandidate(cell, null);
        } else {
          const tokens = cell
            .split(/\s+/)
            .map((t) => cleanCell(t))
            .filter(Boolean);
          for (const token of tokens) {
            recordCandidate(token, null);
          }
        }
      }
    }
  }

  return {
    recipients: Array.from(byEmail.entries()).map(([email, name]) => ({ email, name })),
    totalRows,
    skippedCount,
  };
}

export function formatRecipientLine(recipient: ParsedRecipient): string {
  const safeName = recipient.name
    ?.replace(/[\r\n,;<>]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return safeName ? `${safeName} <${recipient.email}>` : recipient.email;
}

/**
 * Merges newly imported recipients with existing Recipients textarea content,
 * deduplicating case-insensitively by email and preserving display names.
 */
export function mergeImportedRecipientsText(
  existingText: string,
  imported: ParsedRecipient[],
): string {
  const merged = new Map<string, string | null>();
  for (const item of [...parseRecipientInput(existingText), ...imported]) {
    if (!merged.has(item.email)) {
      merged.set(item.email, item.name);
    } else if (!merged.get(item.email) && item.name) {
      merged.set(item.email, item.name);
    }
  }

  return Array.from(merged.entries())
    .map(([email, name]) => formatRecipientLine({ email, name }))
    .join('\n');
}
