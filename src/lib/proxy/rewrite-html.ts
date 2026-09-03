/**
 * Server-side URL rewriting for the Meta in-frame proxies.
 *
 * WHY THIS EXISTS
 * The proxies inject a client script that patches fetch/XHR/anchor
 * clicks, but a proxied page still ships absolute `https://www.
 * instagram.com/...` or `https://www.fbsbx.com/...` URLs in its markup. Any of those that causes a
 * *navigation* — a link, a form post, an iframe embed, a meta refresh — takes the iframe straight to
 * Meta, which answers with X-Frame-Options and the browser renders
 * "www.instagram.com refused to connect" or 404.
 */

/** Hosts whose pages navigate or embed in the frame and must stay proxied. */
const NAVIGABLE_HOSTS = [
  'instagram.com',
  'facebook.com',
  'business.facebook.com',
  'm.facebook.com',
  'messenger.com',
  'fbsbx.com',
];

export type ProxyPath = '/api/facebook/proxy' | '/api/instagram/proxy';

function isNavigableMetaUrl(url: string): boolean {
  try {
    const { hostname, protocol } = new URL(url);
    if (protocol !== 'http:' && protocol !== 'https:') return false;
    return NAVIGABLE_HOSTS.some(
      (host) => hostname === host || hostname.endsWith(`.${host}`),
    );
  } catch {
    return false;
  }
}

function toProxied(url: string, proxyPath: ProxyPath, origin: string): string {
  // Normalize referer query parameters inside the URL to prevent Meta 404s
  let cleanUrl = url;
  if (cleanUrl.includes('referer=http')) {
    cleanUrl = cleanUrl.replace(/referer=http[^&]+/gi, 'referer=https%3A%2F%2Fwww.instagram.com%2F');
  }
  return `${origin}${proxyPath}?url=${encodeURIComponent(cleanUrl)}`;
}

/**
 * Rewrite navigational URLs in `html` so they stay inside the proxy.
 *
 * `origin` should be the origin the frame is being served from, so the
 * rewritten URLs stay on the isolation origin when one is configured.
 */
export function rewriteNavigationUrls(
  html: string,
  proxyPath: ProxyPath,
  origin: string,
): string {
  const base = origin.replace(/\/+$/, '');

  const rewriteAttr = (
    input: string,
    tag: 'a' | 'form' | 'iframe',
    attr: 'href' | 'action' | 'src',
  ): string => {
    const pattern = new RegExp(
      `(<${tag}\\b[^>]*?\\s${attr}=)(["'])(.*?)\\2`,
      'gi',
    );

    return input.replace(pattern, (match, prefix: string, quote: string, url: string) => {
      const target = url.trim();

      if (target.includes('/api/facebook/proxy') || target.includes('/api/instagram/proxy')) {
        return match;
      }
      const absolute = target.startsWith('//') ? `https:${target}` : target;

      if (!isNavigableMetaUrl(absolute)) return match;

      return `${prefix}${quote}${toProxied(absolute, proxyPath, base)}${quote}`;
    });
  };

  let out = html;
  out = rewriteAttr(out, 'a', 'href');
  out = rewriteAttr(out, 'form', 'action');
  out = rewriteAttr(out, 'iframe', 'src');

  // Rewrite meta refresh: <meta http-equiv="refresh" content="0; url=https://www.instagram.com/...">
  out = out.replace(
    /(<meta\b[^>]*?http-equiv=["']refresh["'][^>]*?content=["']\d+;\s*url=)(https?:\/\/[^"'\s>]+)(["'])/gi,
    (match, prefix, rawUrl, suffix) => {
      if (isNavigableMetaUrl(rawUrl)) {
        return `${prefix}${toProxied(rawUrl, proxyPath, base)}${suffix}`;
      }
      return match;
    }
  );

  return out;
}
