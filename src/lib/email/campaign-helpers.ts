/**
 * Client- and server-safe helpers for email campaign templates, recipient parsing,
 * plain-text-to-HTML formatting, and safe merge-field fallbacks.
 */

export interface ParsedRecipient {
  email: string;
  name: string | null;
  metadata?: Record<string, string>;
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
 * Parses a single string containing one or more emails, with support for
 * JSON-stringified recipient objects, "Name <email>" syntax, and commas/newlines.
 */
function parseSingleStringRecipient(text: string): ParsedRecipient[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  // Check if string is a JSON object or array of objects
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed.email === 'string') {
        const norm = parsed.email.trim().toLowerCase();
        if (EMAIL_REGEX.test(norm)) {
          return [
            {
              email: norm,
              name: typeof parsed.name === 'string' ? parsed.name.trim() || null : null,
              metadata:
                parsed.metadata && typeof parsed.metadata === 'object'
                  ? (parsed.metadata as Record<string, string>)
                  : {},
            },
          ];
        }
      }
    } catch {}
  }

  const tokens = trimmed
    .split(/[\r\n,;]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  const byEmail = new Map<string, ParsedRecipient>();

  for (const item of tokens) {
    if (typeof item !== 'string') continue;
    const itemTrim = item.trim();
    if (!itemTrim) continue;

    let parsedName: string | null = null;
    let candidateEmail = itemTrim;

    const angleMatch = itemTrim.match(/^(.*?)<\s*([^<>\s]+)\s*>$/);
    if (angleMatch) {
      const rawName = angleMatch[1].trim().replace(/^["']+|["']+$/g, '').trim();
      parsedName = rawName || null;
      candidateEmail = angleMatch[2].trim();
    }

    const normalizedEmail = candidateEmail.toLowerCase();
    if (!EMAIL_REGEX.test(normalizedEmail)) continue;

    if (!byEmail.has(normalizedEmail)) {
      byEmail.set(normalizedEmail, { email: normalizedEmail, name: parsedName });
    } else if (!byEmail.get(normalizedEmail)?.name && parsedName) {
      byEmail.get(normalizedEmail)!.name = parsedName;
    }
  }

  return Array.from(byEmail.values());
}

/**
 * Parses recipient input from strings, string arrays, or structured ParsedRecipient arrays.
 * Preserves custom metadata columns across all formats.
 */
export function parseRecipientInput(raw: unknown): ParsedRecipient[] {
  if (!raw) return [];

  if (Array.isArray(raw)) {
    const byEmail = new Map<string, ParsedRecipient>();
    for (const item of raw) {
      if (!item) continue;
      if (typeof item === 'object' && 'email' in item) {
        const obj = item as { email: unknown; name?: unknown; metadata?: unknown };
        if (typeof obj.email !== 'string') continue;
        const norm = obj.email.trim().toLowerCase();
        if (!EMAIL_REGEX.test(norm)) continue;
        const name = typeof obj.name === 'string' ? obj.name.trim() || null : null;
        const meta =
          obj.metadata && typeof obj.metadata === 'object'
            ? { ...(obj.metadata as Record<string, string>) }
            : {};

        if (!byEmail.has(norm)) {
          byEmail.set(norm, { email: norm, name, metadata: meta });
        } else {
          const existing = byEmail.get(norm)!;
          if (!existing.name && name) existing.name = name;
          existing.metadata = { ...(existing.metadata || {}), ...meta };
        }
      } else if (typeof item === 'string') {
        const parsed = parseSingleStringRecipient(item);
        for (const p of parsed) {
          if (!byEmail.has(p.email)) {
            byEmail.set(p.email, p);
          } else {
            const existing = byEmail.get(p.email)!;
            if (!existing.name && p.name) existing.name = p.name;
            existing.metadata = { ...(existing.metadata || {}), ...(p.metadata || {}) };
          }
        }
      }
    }
    return Array.from(byEmail.values());
  }

  if (typeof raw === 'string') {
    const text = raw.trim();
    if (!text) return [];

    // If input looks like CSV with headers and lines, use parseEmailImportText
    if (text.includes('\n') && (text.includes(',') || text.includes('\t') || text.includes(';'))) {
      const csvResult = parseEmailImportText(text);
      if (csvResult.recipients.length > 0) {
        return csvResult.recipients;
      }
    }

    return parseSingleStringRecipient(text);
  }

  return [];
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
 * Returns merge-field objects for subject and body.
 * Supports:
 *   - Any column extracted from CSV / spreadsheets (e.g. `company_name`, `incorporation_date`, `login_mail`)
 *   - JSON-encoded fallback metadata inside `recipient.name`
 *   - Automatic company name fallback for `name` / `Hi {{name}},` when individual name is not present
 */
export function resolveSendMergeValues(recipient: {
  email: string;
  name?: string | null;
  metadata?: Record<string, string> | null;
}): {
  subjectFields: Record<string, string>;
  bodyFields: Record<string, string>;
} {
  let resolvedName = recipient.name?.trim() || null;
  let mergedMeta: Record<string, string> = {};

  if (recipient.metadata && typeof recipient.metadata === 'object') {
    mergedMeta = { ...recipient.metadata };
  }

  // Dual-layer fallback: check if name is serialized JSON containing metadata
  if (resolvedName && resolvedName.startsWith('{') && resolvedName.endsWith('}')) {
    try {
      const parsed = JSON.parse(resolvedName);
      if (parsed && typeof parsed === 'object') {
        if (typeof parsed.name === 'string' && parsed.name.trim()) {
          resolvedName = parsed.name.trim();
        } else if (typeof parsed.company_name === 'string' && parsed.company_name.trim()) {
          resolvedName = parsed.company_name.trim();
        } else if (typeof parsed['Company Name'] === 'string' && parsed['Company Name'].trim()) {
          resolvedName = parsed['Company Name'].trim();
        } else {
          resolvedName = null;
        }
        mergedMeta = { ...parsed, ...mergedMeta };
      }
    } catch {
      // not valid JSON, treat as raw name string
    }
  }

  // If no personal name, fall back to company name from metadata
  if (!resolvedName) {
    if (mergedMeta.company_name) {
      resolvedName = mergedMeta.company_name;
    } else if (mergedMeta.company) {
      resolvedName = mergedMeta.company;
    } else if (mergedMeta['Company Name']) {
      resolvedName = mergedMeta['Company Name'];
    }
  }

  const baseFields: Record<string, string> = {
    email: recipient.email,
    name: resolvedName || '',
    ...mergedMeta,
  };

  // Ensure standard aliases exist in baseFields
  if (mergedMeta.company_name && !baseFields.company) {
    baseFields.company = mergedMeta.company_name;
  }
  if (mergedMeta.company && !baseFields.company_name) {
    baseFields.company_name = mergedMeta.company;
  }
  if (mergedMeta['Company Name'] && !baseFields.company_name) {
    baseFields.company_name = mergedMeta['Company Name'];
  }

  // Login email / username aliases (if provided in metadata)
  const metaLogin =
    mergedMeta.login_email ||
    mergedMeta.login_mail ||
    mergedMeta['Login Mail'] ||
    mergedMeta['Login Email'];

  if (metaLogin) {
    baseFields.login_email = metaLogin;
    baseFields.login_mail = metaLogin;
    baseFields['Login Email'] = metaLogin;
    baseFields['Login Mail'] = metaLogin;
    baseFields.loginemail = metaLogin;
    baseFields.loginmail = metaLogin;
    if (!baseFields.username) baseFields.username = metaLogin;
    if (!baseFields.user_name) baseFields.user_name = metaLogin;
    if (!baseFields.login) baseFields.login = metaLogin;
  }

  // Registered email aliases (if provided in metadata)
  const metaRegistered =
    mergedMeta.registered_email ||
    mergedMeta.registered_mail ||
    mergedMeta['Registered Mail'] ||
    mergedMeta['Registered Email'];

  if (metaRegistered) {
    baseFields.registered_email = metaRegistered;
    baseFields.registered_mail = metaRegistered;
    baseFields['Registered Email'] = metaRegistered;
    baseFields['Registered Mail'] = metaRegistered;
    baseFields.registeredemail = metaRegistered;
    baseFields.registeredmail = metaRegistered;
  }

  return {
    subjectFields: {
      ...baseFields,
      name: resolvedName || 'you',
      email: recipient.email,
    },
    bodyFields: {
      ...baseFields,
      name: resolvedName || (mergedMeta.company_name || mergedMeta.company || 'there'),
      email: recipient.email,
    },
  };
}

export const SAMPLE_EMAIL_IMPORT_CSV =
  'name,email,company_name\nPriya Sharma,priya@company.com,Acme Corp\nRahul Nair,rahul@startup.in,NextGen AI\n';

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

const PRIORITY_EMAIL_PATTERNS = [
  /^registered[_ ]*(?:e?mail|id)$/i,
  /^primary[_ ]*(?:e?mail|id)$/i,
  /^official[_ ]*(?:e?mail|id)$/i,
  /^contact[_ ]*(?:e?mail|id)$/i,
  /^work[_ ]*(?:e?mail|id)$/i,
  /^business[_ ]*(?:e?mail|id)$/i,
  /^(?:email|e_mail|email_address|emailaddress|mail_id|email_id)$/i,
  /^mail$/i,
  /^login[_ ]*(?:e?mail|id)$/i,
  /^user[_ ]*(?:e?mail|id)$/i,
  /e?mail/i,
];

const COMPANY_HEADER_PATTERNS = [
  /^(?:company_name|company|business_name|firm_name|organization|organisation|org_name|account_name|legal_entity_name|entity_name)$/i,
];

/**
 * Parses bulk email recipients from uploaded CSV, TSV, or plain-text files.
 * Supports:
 *   - Flexible headered spreadsheets with custom columns (e.g. Registered Mail, Company Name, Incorporation Date)
 *   - Captures ALL spreadsheet columns into recipient metadata for {{tag}} template replacements
 *   - Headerless two-column rows (`Priya Sharma, priya@company.com` or `priya@company.com, Priya Sharma`)
 *   - Plain lists with one or more emails per line
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

  const firstLineCells = parseDelimitedLine(firstLine, delimiter).map(cleanCell);
  const firstLineHasEmail = firstLineCells.some((c) => EMAIL_REGEX.test(c.toLowerCase()));

  let emailIdx = -1;
  let nameIdx = -1;
  let firstIdx = -1;
  let lastIdx = -1;
  let companyIdx = -1;
  let rawHeaderCells: string[] = [];
  let normalizedHeaders: string[] = [];

  if (!firstLineHasEmail) {
    rawHeaderCells = firstLineCells;
    normalizedHeaders = rawHeaderCells.map((h) =>
      h.toLowerCase().replace(/[\s-]+/g, '_'),
    );

    for (const pattern of PRIORITY_EMAIL_PATTERNS) {
      const idx = normalizedHeaders.findIndex((h) => pattern.test(h));
      if (idx >= 0) {
        emailIdx = idx;
        break;
      }
    }

    // Name header detection
    nameIdx = normalizedHeaders.findIndex((h) =>
      [
        'name',
        'full_name',
        'fullname',
        'contact_name',
        'recipient_name',
        'customer_name',
        'client_name',
        'person_name',
      ].includes(h),
    );
    firstIdx = normalizedHeaders.findIndex((h) =>
      ['first_name', 'firstname', 'fname', 'given_name'].includes(h),
    );
    lastIdx = normalizedHeaders.findIndex((h) =>
      ['last_name', 'lastname', 'lname', 'surname', 'family_name'].includes(h),
    );

    // Company header detection
    for (const pattern of COMPANY_HEADER_PATTERNS) {
      const idx = normalizedHeaders.findIndex((h) => pattern.test(h));
      if (idx >= 0) {
        companyIdx = idx;
        break;
      }
    }
  }

  const byEmail = new Map<
    string,
    { name: string | null; metadata: Record<string, string> }
  >();
  let totalRows = 0;
  let skippedCount = 0;

  const recordCandidate = (
    rawEmail: string,
    rawName?: string | null,
    metadata?: Record<string, string>,
  ) => {
    totalRows += 1;
    const normalized = rawEmail.trim().toLowerCase();
    if (!EMAIL_REGEX.test(normalized)) {
      skippedCount += 1;
      return;
    }
    const cleanName = rawName?.trim() || null;
    const cleanMeta = metadata ? { ...metadata } : {};

    if (!byEmail.has(normalized)) {
      byEmail.set(normalized, { name: cleanName, metadata: cleanMeta });
    } else {
      skippedCount += 1;
      const existing = byEmail.get(normalized)!;
      if (!existing.name && cleanName) {
        existing.name = cleanName;
      }
      existing.metadata = { ...existing.metadata, ...cleanMeta };
    }
  };

  if (emailIdx >= 0) {
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

      const companyVal = companyIdx >= 0 ? cleanCell(cells[companyIdx]) : '';
      // If no person name, fall back to company name
      if (!fullName && companyVal) {
        fullName = companyVal;
      }

      // Collect all row columns into metadata with multiple key representations
      const rowMetadata: Record<string, string> = {};
      for (let c = 0; c < rawHeaderCells.length; c++) {
        const val = cleanCell(cells[c]);
        if (!val) continue;
        const rawH = rawHeaderCells[c];
        const normH = normalizedHeaders[c];

        rowMetadata[rawH] = val;
        rowMetadata[normH] = val;
        rowMetadata[rawH.toLowerCase()] = val;
        rowMetadata[rawH.toLowerCase().replace(/[^a-z0-9]/g, '')] = val;
      }

      if (companyVal) {
        rowMetadata.company_name = companyVal;
        rowMetadata.company = companyVal;
        rowMetadata['Company Name'] = companyVal;
      }
      if (fullName) {
        rowMetadata.name = fullName;
      }

      // Alias login_mail <-> login_email
      if (rowMetadata.login_mail && !rowMetadata.login_email) {
        rowMetadata.login_email = rowMetadata.login_mail;
        rowMetadata['Login Email'] = rowMetadata.login_mail;
      }
      if (rowMetadata.login_email && !rowMetadata.login_mail) {
        rowMetadata.login_mail = rowMetadata.login_email;
        rowMetadata['Login Mail'] = rowMetadata.login_email;
      }

      // Alias registered_mail <-> registered_email
      if (rowMetadata.registered_mail && !rowMetadata.registered_email) {
        rowMetadata.registered_email = rowMetadata.registered_mail;
        rowMetadata['Registered Email'] = rowMetadata.registered_mail;
      }
      if (rowMetadata.registered_email && !rowMetadata.registered_mail) {
        rowMetadata.registered_mail = rowMetadata.registered_email;
        rowMetadata['Registered Mail'] = rowMetadata.registered_email;
      }

      if (!rawEmail && !fullName) continue;
      recordCandidate(rawEmail, fullName || null, rowMetadata);
    }
  } else {
    // Headerless fallback
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
    recipients: Array.from(byEmail.entries()).map(([email, info]) => ({
      email,
      name: info.name,
      metadata: Object.keys(info.metadata).length > 0 ? info.metadata : undefined,
    })),
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
 * Reconciles text entered in the recipients textarea with any imported recipient metadata.
 * Ensures that if a user imported a CSV or TSV, the custom columns (company_name, etc.)
 * remain attached to the matching email when creating or appending to the campaign.
 */
export function reconcileRecipientsWithMetadata(
  rawInput: unknown,
  importedList: ParsedRecipient[] = [],
): ParsedRecipient[] {
  const parsed = parseRecipientInput(rawInput);
  const byEmail = new Map<string, ParsedRecipient>();

  for (const imp of importedList) {
    if (imp && imp.email) {
      byEmail.set(imp.email.trim().toLowerCase(), imp);
    }
  }

  return parsed.map((item) => {
    const norm = item.email.trim().toLowerCase();
    const imp = byEmail.get(norm);
    const mergedMetadata = {
      ...(imp?.metadata || {}),
      ...(item.metadata || {}),
    };
    return {
      email: norm,
      name: item.name || imp?.name || null,
      metadata: Object.keys(mergedMetadata).length > 0 ? mergedMetadata : undefined,
    };
  });
}

/**
 * Merges newly imported recipients with existing Recipients textarea content,
 * deduplicating case-insensitively by email and preserving display names and metadata.
 */
export function mergeImportedRecipientsText(
  existingText: string,
  imported: ParsedRecipient[],
): string {
  const merged = new Map<string, ParsedRecipient>();
  for (const item of [...parseRecipientInput(existingText), ...imported]) {
    if (!merged.has(item.email)) {
      merged.set(item.email, item);
    } else {
      const current = merged.get(item.email)!;
      if (!current.name && item.name) current.name = item.name;
      if (item.metadata) {
        current.metadata = { ...(current.metadata || {}), ...item.metadata };
      }
    }
  }

  return Array.from(merged.values())
    .map((rec) => formatRecipientLine(rec))
    .join('\n');
}
