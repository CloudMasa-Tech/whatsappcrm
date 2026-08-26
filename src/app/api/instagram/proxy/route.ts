import { NextRequest, NextResponse } from "next/server";

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
})();
</script>
`;

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
  const targetUrl = searchParams.get("url") || "https://www.instagram.com/";

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

    // Extract CSRF token from cookies if present
    let csrfTokenFromCookie = "";
    if (cookieHeader) {
      const match = cookieHeader.match(/csrftoken=([^;]+)/);
      if (match) csrfTokenFromCookie = match[1];
    }

    const reqHeaders: Record<string, string> = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      Accept: request.headers.get("accept") || "*/*",
      "Accept-Language": "en-US,en;q=0.9",
      "Sec-Fetch-Dest": request.headers.get("sec-fetch-dest") || "empty",
      "Sec-Fetch-Mode": request.headers.get("sec-fetch-mode") || "cors",
      "Sec-Fetch-Site": "same-origin",
      Origin: "https://www.instagram.com",
      Referer: targetUrl.includes("instagram.com") ? targetUrl : "https://www.instagram.com/",
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    };

    // Forward Meta/Instagram specific request headers
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

    // Ensure x-csrftoken is present if we have it in cookies
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
    });

    const contentType = response.headers.get("content-type") || "";

    const resHeaders = new Headers();
    resHeaders.set("Access-Control-Allow-Origin", "*");
    resHeaders.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS");
    resHeaders.set("Access-Control-Allow-Headers", "*");
    resHeaders.set("Access-Control-Allow-Credentials", "true");
    resHeaders.set("X-Frame-Options", "SAMEORIGIN");
    resHeaders.set("Permissions-Policy", "unload=*");

    // Forward and sanitize Set-Cookie headers so localhost stores session & csrf cookies properly
    const rawSetCookies =
      typeof response.headers.getSetCookie === "function"
        ? response.headers.getSetCookie()
        : response.headers.get("set-cookie")
        ? [response.headers.get("set-cookie")!]
        : [];

    for (const cookie of rawSetCookies) {
      // Strip Domain and Secure flags so the browser on localhost / HTTP saves the session cookie
      const sanitized = cookie
        .replace(/Domain=[^;]+;?\s*/gi, "")
        .replace(/Secure;?\s*/gi, "")
        .replace(/SameSite=None;?\s*/gi, "SameSite=Lax; ");
      resHeaders.append("Set-Cookie", sanitized.trim());
    }

    // If Instagram responded with a redirect Location header, rewrite to stay in proxy
    const locationHeader = response.headers.get("location");
    if (locationHeader) {
      const origin = request.nextUrl.origin;
      let fullLoc = locationHeader;
      if (fullLoc.startsWith("/")) {
        fullLoc = `https://www.instagram.com${fullLoc}`;
      }
      resHeaders.set("Location", `${origin}/api/instagram/proxy?url=${encodeURIComponent(fullLoc)}`);
    }

    // If HTML, inject client monkey-patch before DOCTYPE so DOM tree inside <html> is untouched
    if (contentType.includes("text/html")) {
      let html = await response.text();
      html = CLIENT_INJECTION_SCRIPT + html;

      resHeaders.set("Content-Type", "text/html; charset=utf-8");
      resHeaders.set("Referrer-Policy", "no-referrer");
      resHeaders.set("Cache-Control", "no-store, max-age=0");

      return new NextResponse(html, {
        status: response.status,
        headers: resHeaders,
      });
    }

    // Binary / JSON / JS / CSS pass-through
    const buffer = await response.arrayBuffer();
    resHeaders.set("Content-Type", contentType || "application/octet-stream");
    resHeaders.set("Cache-Control", "public, max-age=3600");

    return new NextResponse(buffer, {
      status: response.status,
      headers: resHeaders,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Proxy request failed", details: errorMsg },
      {
        status: 502,
        headers: {
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }
}
