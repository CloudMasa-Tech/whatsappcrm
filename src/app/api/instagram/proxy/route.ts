import { NextRequest, NextResponse } from "next/server";
import { rewriteNavigationUrls } from "@/lib/proxy/rewrite-html";

const ALLOWED_DOMAINS = [
  "instagram.com",
  "cdninstagram.com",
  "facebook.com",
  "fbcdn.net",
  "fbsbx.com",
  "meta.com",
];

const CLIENT_INJECTION_SCRIPT = `
<script>
(function() {
  // 1. Anti-Framebusting
  try {
    Object.defineProperty(window, 'top', { get: function() { return window.self; }, configurable: true });
    Object.defineProperty(window, 'parent', { get: function() { return window.self; }, configurable: true });
    Object.defineProperty(window, 'frameElement', { get: function() { return null; }, configurable: true });
  } catch(e) {}

  // 2. Disable WebAuthn in frame to prevent Passkey error logging
  try {
    try { Object.defineProperty(window, 'PublicKeyCredential', { value: undefined, configurable: true, writable: true }); } catch(e) {}
    try { Object.defineProperty(navigator, 'credentials', { value: undefined, configurable: true, writable: true }); } catch(e) {}
  } catch(e) {}

  // 3. Suppress 'unload' listener violation in Chrome iframes
  try {
    var origAddEventListener = window.addEventListener;
    window.addEventListener = function(type, listener, options) {
      if (type === 'unload') {
        try { return origAddEventListener.call(this, 'pagehide', listener, options); } catch(err) { return; }
      }
      return origAddEventListener.apply(this, arguments);
    };
    Object.defineProperty(window, 'onunload', {
      get: function() { return null; },
      set: function(fn) {
        if (typeof fn === 'function') {
          try { window.addEventListener('pagehide', fn); } catch(err) {}
        }
      },
      configurable: true
    });
  } catch(e) {}

  // 3. Helper to normalize and route Meta/Instagram URLs through local proxy
  function normalizeAndProxyUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return rawUrl;
    if (rawUrl.indexOf('/api/instagram/proxy') !== -1) return rawUrl;

    var target = rawUrl.trim();
    if (target.startsWith('//')) {
      target = 'https:' + target;
    } else if (!target.startsWith('http://') && !target.startsWith('https://')) {
      if (target.startsWith('/')) {
        target = 'https://www.instagram.com' + target;
      } else {
        target = 'https://www.instagram.com/' + target;
      }
    }

    var isMetaTarget = (
      target.indexOf('instagram.com') !== -1 ||
      target.indexOf('cdninstagram.com') !== -1 ||
      target.indexOf('facebook.com') !== -1 ||
      target.indexOf('fbcdn.net') !== -1 ||
      target.indexOf('fbsbx.com') !== -1 ||
      target.indexOf('meta.com') !== -1
    );

    if (isMetaTarget) {
      var origin = window.location.origin || (window.location.protocol + '//' + window.location.host);
      return origin + '/api/instagram/proxy?url=' + encodeURIComponent(target);
    }

    return target;
  }

  // 4. Intercept window.fetch
  var originalFetch = window.fetch;
  window.fetch = function(input, init) {
    try {
      if (typeof input === 'string') {
        input = normalizeAndProxyUrl(input);
      } else if (input && input.url) {
        var proxiedUrl = normalizeAndProxyUrl(input.url);
        if (proxiedUrl !== input.url && input instanceof Request) {
          input = new Request(proxiedUrl, init);
        }
      }
    } catch(err) {}
    return originalFetch.apply(this, [input, init]);
  };

  // 5. Intercept XMLHttpRequest (XHR)
  var originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, async, user, password) {
    try {
      if (url) {
        url = normalizeAndProxyUrl(String(url));
      }
    } catch(err) {}
    return originalOpen.call(this, method, url, async !== false, user, password);
  };

  // 6. Intercept navigator.sendBeacon
  if (navigator.sendBeacon) {
    var originalSendBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function(url, data) {
      try {
        if (url) {
          url = normalizeAndProxyUrl(String(url));
        }
      } catch(e) {}
      return originalSendBeacon(url, data);
    };
  }

  // 7. Intercept Link Clicks and Form Submissions so iframe stays within proxy
  window.addEventListener('click', function(e) {
    try {
      var el = e.target;
      while (el && el.tagName !== 'A') {
        el = el.parentElement;
      }
      if (el && el.tagName === 'A' && el.href) {
        var rawHref = el.getAttribute('href') || el.href;
        if (rawHref && !rawHref.startsWith('javascript:') && !rawHref.startsWith('#')) {
          var proxied = normalizeAndProxyUrl(el.href || rawHref);
          if (proxied !== el.href) {
            e.preventDefault();
            e.stopPropagation();
            window.location.href = proxied;
          }
        }
      }
    } catch(err) {}
  }, true);

  window.addEventListener('submit', function(e) {
    try {
      var form = e.target;
      if (form && form.tagName === 'FORM' && form.action) {
        form.action = normalizeAndProxyUrl(form.action);
      }
    } catch(err) {}
  }, true);

  // 8. Intercept programmatic navigation
  try {
    var LocProto = window.Location && window.Location.prototype;
    if (LocProto) {
      ['assign', 'replace'].forEach(function (fn) {
        var orig = LocProto[fn];
        if (typeof orig !== 'function') return;
        LocProto[fn] = function (url) {
          try { return orig.call(this, normalizeAndProxyUrl(String(url))); }
          catch (e) { return orig.call(this, url); }
        };
      });
    }
  } catch (e) {}

  try {
    var origOpen = window.open;
    window.open = function (url) {
      var args = Array.prototype.slice.call(arguments);
      if (typeof url === 'string') { args[0] = normalizeAndProxyUrl(url); }
      return origOpen.apply(window, args);
    };
  } catch (e) {}

})();
</script>
`;

function appOrigin(): string {
  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "");
  if (!site) return "";
  try {
    const parsed = new URL(site);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return "";
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Max-Age": "86400",
    },
  });
}

export async function GET(request: NextRequest) {
  return handleProxyRequest(request, "GET");
}

export async function POST(request: NextRequest) {
  return handleProxyRequest(request, "POST");
}

export async function PUT(request: NextRequest) {
  return handleProxyRequest(request, "PUT");
}

export async function DELETE(request: NextRequest) {
  return handleProxyRequest(request, "DELETE");
}

async function handleProxyRequest(request: NextRequest, method: string) {
  const { searchParams } = new URL(request.url);
  const targetUrl = searchParams.get("url") || "https://www.instagram.com/direct/inbox/";

  try {
    const parsed = new URL(targetUrl);
    const isDomainAllowed = ALLOWED_DOMAINS.some(
      (d) => parsed.hostname === d || parsed.hostname.endsWith("." + d)
    );

    if (!isDomainAllowed) {
      return NextResponse.json(
        { error: "Domain not allowed in proxy" },
        { status: 400 }
      );
    }

    const cookieHeader = request.headers.get("cookie") || "";
    const contentTypeReq = request.headers.get("content-type");

    let csrfTokenFromCookie = "";
    if (cookieHeader) {
      const match = cookieHeader.match(/csrftoken=([^;]+)/);
      if (match) csrfTokenFromCookie = match[1];
    }

    const reqHeaders: Record<string, string> = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: request.headers.get("accept") || "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Sec-Ch-Ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": '"Windows"',
      "Sec-Fetch-Dest": request.headers.get("sec-fetch-dest") || "document",
      "Sec-Fetch-Mode": request.headers.get("sec-fetch-mode") || "navigate",
      "Sec-Fetch-Site": "same-origin",
      Origin: "https://www.instagram.com",
      Referer: targetUrl.includes("instagram.com") ? targetUrl : "https://www.instagram.com/",
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    };

    const customHeaderKeys = [
      "x-csrftoken",
      "x-ig-app-id",
      "x-asbd-id",
      "x-fb-lsd",
      "x-requested-with",
      "x-ig-www-claim",
      "x-fb-friendly-name",
      "x-fb-rla-fr",
      "x-instagram-ajax",
      "x-ig-connection-type",
      "x-ig-capabilities",
    ];
    for (const key of customHeaderKeys) {
      const val = request.headers.get(key);
      if (val) reqHeaders[key] = val;
    }

    if (!reqHeaders["x-csrftoken"] && csrfTokenFromCookie) {
      reqHeaders["x-csrftoken"] = csrfTokenFromCookie;
    }

    if (contentTypeReq) {
      reqHeaders["Content-Type"] = contentTypeReq;
    }

    let body: BodyInit | null = null;
    if (method === "POST" || method === "PUT" || method === "PATCH") {
      body = await request.arrayBuffer();
    }

    const response = await fetch(targetUrl, {
      method,
      headers: reqHeaders,
      body,
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
    });

    const contentType = response.headers.get("content-type") || "";

    const resHeaders = new Headers();
    resHeaders.set("Access-Control-Allow-Origin", "*");
    resHeaders.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS");
    resHeaders.set("Access-Control-Allow-Headers", "*");
    resHeaders.set("Access-Control-Allow-Credentials", "true");
    resHeaders.set(
      "Content-Security-Policy",
      `frame-ancestors 'self' ${appOrigin()}`,
    );
    resHeaders.set("Permissions-Policy", "unload=*");

    const rawSetCookies =
      typeof response.headers.getSetCookie === "function"
        ? response.headers.getSetCookie()
        : response.headers.get("set-cookie")
        ? [response.headers.get("set-cookie")!]
        : [];

    for (const cookie of rawSetCookies) {
      let sanitized = cookie
        .replace(/Domain=[^;]+;?\s*/gi, "")
        .replace(/Secure;?\s*/gi, "")
        .replace(/Path=[^;]+;?\s*/gi, "")
        .replace(/SameSite=None;?\s*/gi, "SameSite=Lax; ");
      sanitized = sanitized.trim().replace(/;$/, "") + "; Path=/api/instagram";
      resHeaders.append("Set-Cookie", sanitized);
    }

    const locationHeader = response.headers.get("location");
    if (locationHeader) {
      const origin = request.nextUrl.origin;
      let fullLoc = locationHeader;
      if (fullLoc.startsWith("/")) {
        fullLoc = `https://www.instagram.com${fullLoc}`;
      }
      resHeaders.set("Location", `${origin}/api/instagram/proxy?url=${encodeURIComponent(fullLoc)}`);
    }

    if (contentType.includes("text/html")) {
      let html = await response.text();
      html = rewriteNavigationUrls(html, "/api/instagram/proxy", request.nextUrl.origin);
      html = CLIENT_INJECTION_SCRIPT + html;

      resHeaders.set("Content-Type", "text/html; charset=utf-8");
      resHeaders.set("Referrer-Policy", "no-referrer");
      resHeaders.set("Cache-Control", "no-store, max-age=0");

      return new NextResponse(html, {
        status: response.status,
        headers: resHeaders,
      });
    }

    const buffer = await response.arrayBuffer();
    resHeaders.set("Content-Type", contentType || "application/octet-stream");
    resHeaders.set("Cache-Control", "public, max-age=3600");

    return new NextResponse(buffer, {
      status: response.status,
      headers: resHeaders,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const accept = request.headers.get("accept") || "";

    // If client requested an HTML frame, return a styled fallback rather than breaking with 502
    if (accept.includes("text/html")) {
      const fallbackHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0b1329; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 24px; box-sizing: border-box; text-align: center; }
    .card { max-width: 480px; background: rgba(30, 41, 59, 0.85); border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 16px; padding: 32px; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5); backdrop-filter: blur(12px); }
    .icon { width: 56px; height: 56px; margin: 0 auto 16px; border-radius: 14px; display: flex; align-items: center; justify-content: center; background: linear-gradient(45deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888); color: white; font-size: 28px; }
    h2 { font-size: 20px; margin: 0 0 8px; font-weight: 700; color: #fff; }
    p { font-size: 13px; color: #94a3b8; line-height: 1.6; margin: 0 0 24px; }
    .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; background: #ec4899; color: #fff; font-weight: 600; font-size: 13px; padding: 11px 20px; border-radius: 8px; text-decoration: none; border: none; cursor: pointer; transition: all 0.2s; }
    .btn:hover { background: #db2777; transform: translateY(-1px); }
    .note { font-size: 11px; color: #64748b; margin-top: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">📸</div>
    <h2>Direct Instagram Session</h2>
    <p>Meta security policies require Instagram web sessions to run directly in your browser. Launch in a companion window or connect via the official Meta Graph API.</p>
    <a href="${targetUrl}" target="_blank" rel="noopener noreferrer" class="btn">🚀 Open Direct Instagram Window</a>
    <div class="note">Messages synced automatically via official Meta Webhooks</div>
  </div>
</body>
</html>`;

      return new NextResponse(fallbackHtml, {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    return NextResponse.json(
      { error: "Proxy request failed", details: errorMsg },
      {
        status: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }
}
