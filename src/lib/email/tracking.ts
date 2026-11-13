/**
 * Open/click tracking for campaign email bodies.
 *
 * Both mechanisms hang off the recipient's `tracking_token`, never its
 * row id, so a tracking URL leaking (forwarded email, proxy log) cannot
 * be used to enumerate recipients.
 */

/** 1x1 transparent GIF — the smallest thing a mail client will fetch. */
export const TRACKING_PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);

function siteOrigin(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000')
    .trim()
    .replace(/\/+$/, '');
}

export function openTrackingUrl(token: string): string {
  return `${siteOrigin()}/api/email/track/open/${token}`;
}

export function clickTrackingUrl(token: string, target: string): string {
  return `${siteOrigin()}/api/email/track/click/${token}?u=${encodeURIComponent(target)}`;
}

/**
 * Rewrite every http(s) link in `html` to route through the click
 * tracker.
 *
 * Deliberately skipped:
 *   - `mailto:`, `tel:`, and anchor (`#`) links — nothing to track, and
 *     rewriting them breaks the client's handling.
 *   - URLs already pointing at our own tracking endpoint, so calling
 *     this twice cannot double-wrap.
 *   - Unsubscribe links, which must stay direct so that one-click
 *     unsubscribe keeps working even if tracking is disabled.
 */
export function rewriteLinksForTracking(html: string, token: string): string {
  const origin = siteOrigin();

  return html.replace(
    /(<a\b[^>]*?\shref=)(["'])(.*?)\2/gi,
    (match, prefix: string, quote: string, url: string) => {
      const trimmed = url.trim();

      if (!/^https?:\/\//i.test(trimmed)) return match;
      if (trimmed.startsWith(`${origin}/api/email/track/`)) return match;
      if (/unsubscribe/i.test(trimmed)) return match;

      return `${prefix}${quote}${clickTrackingUrl(token, trimmed)}${quote}`;
    },
  );
}

/**
 * Append the open-tracking pixel. Placed immediately before `</body>`
 * when present so the markup stays valid; otherwise appended, which
 * still renders because clients tolerate trailing content.
 */
export function injectOpenPixel(html: string, token: string): string {
  const pixel =
    `<img src="${openTrackingUrl(token)}" width="1" height="1" ` +
    `alt="" style="display:block;width:1px;height:1px;border:0;" />`;

  if (/<\/body\s*>/i.test(html)) {
    return html.replace(/<\/body\s*>/i, `${pixel}</body>`);
  }
  return html + pixel;
}

export interface PrepareBodyOptions {
  html: string;
  token: string;
  trackOpens: boolean;
  trackClicks: boolean;
}

/** Apply whichever tracking the campaign has enabled. */
export function prepareTrackedBody({
  html,
  token,
  trackOpens,
  trackClicks,
}: PrepareBodyOptions): string {
  let out = html;
  if (trackClicks) out = rewriteLinksForTracking(out, token);
  if (trackOpens) out = injectOpenPixel(out, token);
  return out;
}

/**
 * Merge fields, shared by subject and body. Supports `{{name}}`, `{{email}}`,
 * `{{company_name}}`, `{{Company Name}}`, and any arbitrary column headers from
 * imported spreadsheets with flexible case, spacing, and snake_case matching.
 */
export function applyMergeFields(
  input: string,
  fields: Record<string, string | null | undefined>,
): string {
  if (!input) return '';
  return input.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (match, rawKey: string) => {
    const key = rawKey.trim();
    if (!key) return match;

    // 1. Exact match (e.g. fields["company_name"] or fields["Company Name"])
    if (fields[key] != null && fields[key] !== '') {
      return String(fields[key]);
    }

    // 2. Lowercase match (e.g. fields["company name"])
    const lower = key.toLowerCase();
    if (fields[lower] != null && fields[lower] !== '') {
      return String(fields[lower]);
    }

    // 3. Snake case match (e.g. "Company Name" or "Company-Name" -> "company_name")
    const snake = lower.replace(/[\s-]+/g, '_');
    if (fields[snake] != null && fields[snake] !== '') {
      return String(fields[snake]);
    }

    // 4. Stripped non-alphanumeric match (e.g. "company_name" -> "companyname")
    const stripped = lower.replace(/[^a-z0-9]/g, '');
    if (fields[stripped] != null && fields[stripped] !== '') {
      return String(fields[stripped]);
    }

    // 5. Special aliases: company <-> company_name
    if (lower === 'company' && fields.company_name) {
      return String(fields.company_name);
    }
    if (lower === 'company_name' && fields.company) {
      return String(fields.company);
    }

    // 6. email <-> mail interchangeability on any prefix (e.g. login_email <-> login_mail, registered_email <-> registered_mail)
    const asMail = snake.replace(/_?email/g, '_mail').replace(/^_/, '');
    if (fields[asMail] != null && fields[asMail] !== '') {
      return String(fields[asMail]);
    }
    const asEmail = snake.replace(/_?mail/g, '_email').replace(/^_/, '');
    if (fields[asEmail] != null && fields[asEmail] !== '') {
      return String(fields[asEmail]);
    }

    // 7. Username / login email resolution:
    // If template has {{login_email}}, {{login_mail}}, {{username}}, {{user_name}}, {{login}}
    if (['login_email', 'login_mail', 'loginemail', 'loginmail', 'username', 'user_name', 'login', 'user'].includes(snake)) {
      if (fields.login_email) return String(fields.login_email);
      if (fields.login_mail) return String(fields.login_mail);
      if (fields['Login Email']) return String(fields['Login Email']);
      if (fields['Login Mail']) return String(fields['Login Mail']);
      if (fields.username) return String(fields.username);
      if (fields.email) return String(fields.email);
    }

    // 8. General email resolution:
    // If template has {{email}}, {{mail}}, {{email_address}}, {{registered_email}}, {{registered_mail}}
    if (['email', 'mail', 'email_address', 'mail_id', 'email_id', 'registered_email', 'registered_mail'].includes(snake)) {
      if (fields.email) return String(fields.email);
      if (fields.registered_email) return String(fields.registered_email);
      if (fields.registered_mail) return String(fields.registered_mail);
      if (fields['Registered Mail']) return String(fields['Registered Mail']);
      if (fields['Registered Email']) return String(fields['Registered Email']);
    }

    return match;
  });
}
