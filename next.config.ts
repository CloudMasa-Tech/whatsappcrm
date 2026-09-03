import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

/**
 * Origin that serves the Facebook/Instagram in-frame proxies. Empty
 * string when unset, which collapses to the previous same-origin CSP.
 * See src/lib/sandbox-origin.ts for why isolating it matters.
 */
const SANDBOX_ORIGIN = (process.env.NEXT_PUBLIC_SANDBOX_ORIGIN ?? "")
  .trim()
  .replace(/\/+$/, "");

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/**
 * Baseline security headers applied to every response.
 *
 * CSP ships as `Content-Security-Policy-Report-Only` so the browser
 * surfaces violations in the console without blocking anything — once
 * we have confidence nothing legit trips it (two deploys, a pass on
 * every route), flip the key to `Content-Security-Policy` to enforce.
 *
 * The rest of the headers are straight blocks, safe to enforce today:
 *   - HSTS: only meaningful on HTTPS (no-op on http://localhost).
 *   - X-Content-Type-Options / X-Frame-Options / Referrer-Policy:
 *     baseline OWASP hardening, no behavioural cost.
 *   - Permissions-Policy: we don't use camera / microphone / etc, so
 *     deny them. A supply-chain compromise or a forgotten plugin
 *     can't silently opt back in.
 */
const SECURITY_HEADERS = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    // Microphone is allowed for same-origin (`self`) so the inbox
    // composer can record voice notes via MediaRecorder. Everything
    // else stays denied — a compromised dependency can't silently grab
    // the camera / geolocation / etc.
    key: "Permissions-Policy",
    value: "camera=*, microphone=(self), geolocation=(), payment=(), usb=(), unload=*",
  },
  {
    key: "Content-Security-Policy-Report-Only",
    value: [
      "default-src 'self'",
      // Next.js needs 'unsafe-inline' for its inline hydration script
      // and 'unsafe-eval' in dev + some production optimisations.
      // Nonce-based CSP is a later project.
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://instagram.com https://*.instagram.com https://*.cdninstagram.com https://facebook.com https://*.facebook.com https://*.fbcdn.net https://*.meta.com https://*.fbsbx.com",
      // Tailwind + inline style attributes on lots of components.
      "style-src 'self' 'unsafe-inline' https://instagram.com https://*.instagram.com https://facebook.com https://*.facebook.com https://*.fbsbx.com",
      // Supabase public-bucket avatars, contact avatars (arbitrary
      // https URLs paste-able from the UI), OG images, data URLs for
      // tiny inline assets.
      "img-src 'self' data: blob: https:",
      // Outbound media previews (blob: from MediaRecorder + file picker)
      // and Supabase public-bucket audio/video the inbox renders.
      "media-src 'self' blob: https://*.supabase.co https://instagram.com https://*.instagram.com https://*.cdninstagram.com https://facebook.com https://*.facebook.com https://*.fbcdn.net https://*.fbsbx.com",
      "font-src 'self' data: https://instagram.com https://*.instagram.com https://*.cdninstagram.com https://facebook.com https://*.facebook.com https://*.fbcdn.net",
      // Supabase REST + realtime (WSS). All Meta API calls happen
      // server-side, so graph.facebook.com does not belong here.
      `connect-src 'self' ${SANDBOX_ORIGIN} https://*.supabase.co wss://*.supabase.co https://instagram.com https://*.instagram.com https://*.cdninstagram.com https://facebook.com https://*.facebook.com https://*.fbcdn.net https://*.meta.com https://*.fbsbx.com`,
      // The isolation origin serving the in-frame proxies must be
      // frameable by the app; without it CSP blocks the isolated setup
      // and the hubs render an empty frame.
      `frame-src 'self' ${SANDBOX_ORIGIN} http://instagram.com https://instagram.com https://*.instagram.com https://*.cdninstagram.com http://facebook.com https://facebook.com https://*.facebook.com https://*.fbcdn.net https://*.fbsbx.com blob: data:`,
      "frame-ancestors 'self'",
      "base-uri 'self' https://instagram.com https://*.instagram.com https://facebook.com https://*.facebook.com https://*.fbsbx.com",
      "form-action 'self' https://instagram.com https://*.instagram.com https://facebook.com https://*.facebook.com https://*.fbsbx.com",
    ].join("; "),
  },
] as const;

const nextConfig: NextConfig = {
  /**
   * Cross-origin dev access (Next.js 16).
   *
   * Next 16 blocks requests to dev-only resources (`/_next/*` internals,
   * the HMR websocket, the dev overlay) unless the browser's Origin is
   * the host the dev server booted on — `localhost` by default. Tunnels
   * like ngrok serve the app from a public HTTPS host, so without
   * allow-listing that host those dev requests come back 403: HMR stops
   * working and the dev session degrades over the tunnel (issue #365).
   *
   * Wildcards match subdomains only (Next's CSRF matcher), so the
   * randomised tunnel subdomain is covered. Add any other host via
   * `ALLOWED_DEV_ORIGINS` (comma-separated). This key is dev-only and
   * has no effect on a production build.
   */
  allowedDevOrigins: [
    "*.ngrok-free.app",
    "*.ngrok.app",
    "*.ngrok.io",
    "*.trycloudflare.com",
    "*.loca.lt",
    ...(process.env.ALLOWED_DEV_ORIGINS
      ? process.env.ALLOWED_DEV_ORIGINS.split(",")
          .map((origin) => origin.trim())
          .filter(Boolean)
      : []),
  ],

  /**
   * Cache-Control policy.
   *
   * Why this exists:
   *   Hostinger's CDN was applying `s-maxage=31536000` (1 year) to
   *   prerendered HTML pages by default. When a new deploy shipped
   *   fresh Turbopack chunk hashes, the edge kept serving year-old
   *   HTML referencing chunk filenames that no longer existed on
   *   disk — result: HTML 200, every /_next/static/*.js and .css
   *   came back 404, the page rendered unstyled. Private/incognito
   *   did nothing because the cache is server-side.
   *
   * Strategy:
   *   - /_next/static/* — leave to Next. Turbopack dev chunks can go
   *     stale if we force immutable caching here; Next already emits
   *     the correct production headers for hashed assets.
   *   - /api/*          — no-store. API responses are per-user and
   *     must never be shared across requests at the edge.
   *   - Everything else — public, brief s-maxage + generous
   *     stale-while-revalidate. The edge serves instantly from cache
   *     for the first 5 min, then returns cached content while
   *     refreshing in the background for up to 24 h. A deploy's
   *     chunk-hash drift self-heals within ~5 min with no user-
   *     visible latency.
   *
   *   Note: dynamic dashboard routes (/inbox, /contacts, /pipelines,
   *   /broadcasts, etc.) are server-rendered per request — Next.js
   *   and Supabase auth already prevent them from being served
   *   from a shared cache. The s-maxage here is a ceiling; Next.js
   *   and auth middleware still set `private` / `no-store` for
   *   per-user responses.
   *
   * Security headers are appended via a separate catch-all rule
   * below — Next.js merges headers from every matching rule, so
   * they apply to every response regardless of which cache rule
   * matched.
   */
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
      {
        source: "/:path((?!_next/static|_next/image|api).*)",
        headers: [
          {
            key: "Cache-Control",
            value:
              "public, max-age=0, s-maxage=300, stale-while-revalidate=86400",
          },
        ],
      },
      {
        // The in-frame proxies are framed BY the app, and when
        // NEXT_PUBLIC_SANDBOX_ORIGIN is set that framing is cross-origin.
        // The global X-Frame-Options: SAMEORIGIN below would block it, so
        // these routes get every security header EXCEPT that one; each
        // proxy response sets its own `frame-ancestors` naming the app
        // origin, which is stricter than SAMEORIGIN would have been.
        source: "/api/:provider(facebook|instagram)/proxy",
        headers: SECURITY_HEADERS.filter((h) => h.key !== "X-Frame-Options"),
      },
      {
        // Security headers on every response, including /_next/static
        // assets (nosniff matters there) and /api/* (HSTS + referrer-
        // policy don't hurt).
        // Excludes the in-frame proxy routes, which are handled by the
        // entry above — a later matching rule would otherwise re-add the
        // X-Frame-Options that exception exists to drop.
        source: "/:path((?!api/facebook/proxy|api/instagram/proxy).*)",
        headers: [...SECURITY_HEADERS],
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: "/ajax/:path*",
        destination: "https://www.instagram.com/ajax/:path*",
      },
      {
        source: "/logging_client_events",
        destination: "https://www.instagram.com/logging_client_events",
      },
      {
        source: "/browser_push_events",
        destination: "https://www.instagram.com/browser_push_events",
      },
    ];
  },
  turbopack: {
    root: __dirname,
  },
};

export default withNextIntl(nextConfig);
