/**
 * Server-side URL rewriting for the Meta in-frame proxies.
 *
 * WHY THIS EXISTS
 * The proxies inject a client script that patches fetch/XHR/anchor
 * clicks, but a proxied page still ships absolute `https://www.
 * instagram.com/...` URLs in its markup. Any of those that causes a
 * *navigation* — a link, a form post — takes the iframe straight to
 * Meta, which answers with X-Frame-Options and the browser renders
 * "www.instagram.com refused to connect".
 *
 * Rewriting them before the HTML reaches the browser closes that hole
 * ahead of any script running, so a click cannot escape the proxy even
 * if the injected script failed to load.
 *
 * DELIBERATELY NARROW
 * Only `<a href>` and `<form action>` are rewritten — the two things
 * that navigate the frame. Static assets on CDN hosts (fbcdn.net,
 * cdninstagram.com) are left pointing at Meta: they load fine
 * cross-origin, the app's CSP already allows them, and funnelling
 * megabytes of images and bundles through the server would make the
 * frame far slower without making it any more contained.
 */

/** Hosts whose pages navigate the frame and must stay proxied. */
const NAVIGABLE_HOSTS = [
  'instagram.com',
  'facebook.com',
  'business.facebook.com',
  'm.facebook.com',
  'messenger.com',
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
  return `${origin}${proxyPath}?url=${encodeURIComponent(url)}`;
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
    tag: 'a' | 'form',
    attr: 'href' | 'action',
  ): string => {
    // Matches the opening tag, then that attribute anywhere within it.
    const pattern = new RegExp(
      `(<${tag}\\b[^>]*?\\s${attr}=)(["'])(.*?)\\2`,
      'gi',
    );

    return input.replace(pattern, (match, prefix: string, quote: string, url: string) => {
      const target = url.trim();

      // Already ours — never double-wrap.
      if (target.includes('/api/facebook/proxy') || target.includes('/api/instagram/proxy')) {
        return match;
      }
      // Protocol-relative URLs resolve against our origin once served,
      // so normalise before deciding.
      const absolute = target.startsWith('//') ? `https:${target}` : target;

      if (!isNavigableMetaUrl(absolute)) return match;

      return `${prefix}${quote}${toProxied(absolute, proxyPath, base)}${quote}`;
    });
  };

  let out = html;
  out = rewriteAttr(out, 'a', 'href');
  out = rewriteAttr(out, 'form', 'action');
  return out;
}
