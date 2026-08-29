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
 * Merge fields, shared by subject and body. Supports `{{name}}` and
 * `{{email}}` with optional surrounding whitespace.
 */
export function applyMergeFields(
  input: string,
  fields: Record<string, string | null | undefined>,
): string {
  return input.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) => {
    const value = fields[key];
    return value == null || value === '' ? match : value;
  });
}
