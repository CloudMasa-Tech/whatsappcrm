/**
 * Origin isolation for the in-frame Facebook / Instagram proxies.
 *
 * THE PROBLEM
 * The proxy serves Meta's HTML and JavaScript from our own path
 * (`/api/*​/proxy`). The hubs frame it with
 * `sandbox="allow-scripts allow-same-origin"` — and those two tokens
 * together void the sandbox: the framed third-party script runs on our
 * origin, so it can read `document.cookie` and `localStorage`. The
 * Supabase browser client stores its session in non-HttpOnly cookies,
 * so a hostile payload in that HTML could lift a logged-in CRM session.
 *
 * THE FIX
 * Serve the proxy from a *different* origin. Cookies are host-scoped
 * (Supabase sets no `Domain`) and storage is partitioned per origin, so
 * a sibling host such as `sandbox.crm.example.com` cannot reach the
 * app's session even with `allow-same-origin`.
 *
 * Set NEXT_PUBLIC_SANDBOX_ORIGIN to that host. It must resolve to this
 * same deployment — it is the same Next.js app, just addressed by
 * another name.
 *
 * When it is unset the hubs still work, but same-origin: the UI shows a
 * warning rather than silently leaving the exposure in place.
 */

/**
 * The configured isolation origin, or null when unset.
 *
 * Read from a literal `process.env.NEXT_PUBLIC_*` reference so Next can
 * inline it into the client bundle at build time.
 */
export function getSandboxOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_SANDBOX_ORIGIN?.trim();
  if (!raw) return null;

  const origin = raw.replace(/\/+$/, '');

  // A misconfigured value must not silently fall back to same-origin
  // behaviour that looks isolated but is not.
  try {
    const parsed = new URL(origin);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    console.warn(
      '[sandbox-origin] NEXT_PUBLIC_SANDBOX_ORIGIN is not a valid absolute URL, ignoring:',
      raw,
    );
    return null;
  }
}

/** True when the proxy is served from an origin separate from the app. */
export function isOriginIsolated(): boolean {
  const sandbox = getSandboxOrigin();
  if (!sandbox) return false;

  // On the client, compare against where the app is actually running:
  // pointing the variable at our own origin isolates nothing.
  if (typeof window !== 'undefined') {
    return sandbox !== window.location.origin;
  }
  return true;
}

/**
 * Absolute src for a proxy iframe.
 *
 * Falls back to a relative path when no sandbox origin is configured,
 * preserving today's behaviour.
 */
export function buildProxySrc(
  proxyPath: '/api/facebook/proxy' | '/api/instagram/proxy',
  targetUrl: string,
): string {
  const query = `${proxyPath}?url=${encodeURIComponent(targetUrl)}`;
  const sandbox = getSandboxOrigin();
  return sandbox ? `${sandbox}${query}` : query;
}
