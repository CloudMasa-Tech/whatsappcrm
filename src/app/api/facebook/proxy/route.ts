import { NextRequest, NextResponse } from "next/server";
import { rewriteNavigationUrls } from "@/lib/proxy/rewrite-html";

const ALLOWED_DOMAINS = [
  "facebook.com",
  "m.facebook.com",
  "web.facebook.com",
  "business.facebook.com",
  "messenger.com",
  "fbcdn.net",
  "fbsbx.com",
  "meta.com",
  "instagram.com",
  "cdninstagram.com",
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

  // 3. Helper to normalize and route Meta/Facebook URLs through local proxy
  function normalizeAndProxyUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return rawUrl;
    if (rawUrl.indexOf('/api/facebook/proxy') !== -1) return rawUrl;

    var target = rawUrl.trim();
    if (target.startsWith('//')) {
      target = 'https:' + target;
    } else if (!target.startsWith('http://') && !target.startsWith('https://')) {
      if (target.startsWith('/')) {
        target = 'https://www.facebook.com' + target;
      } else {
        target = 'https://www.facebook.com/' + target;
      }
    }

    var isMetaTarget = (
      target.indexOf('facebook.com') !== -1 ||
      target.indexOf('messenger.com') !== -1 ||
      target.indexOf('business.facebook.com') !== -1 ||
      target.indexOf('fbcdn.net') !== -1 ||
      target.indexOf('fbsbx.com') !== -1 ||
      target.indexOf('meta.com') !== -1 ||
      target.indexOf('instagram.com') !== -1
    );

    if (isMetaTarget) {
      var origin = window.location.origin || (window.location.protocol + '//' + window.location.host);
      return origin + '/api/facebook/proxy?url=' + encodeURIComponent(target);
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

  // 6b. Intercept programmatic navigation. Instagram/Facebook JS sets
  //     location directly after login and on SPA route changes; without
  //     this the frame leaves the proxy and Meta refuses to be framed.
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

/**
 * The origin allowed to frame proxied content — the CRM itself. Falls
 * back to 'self' only, which is correct when the proxy is same-origin.
 */
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
  const targetUrl = searchParams.get("url") || "https://www.facebook.com/";

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
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      Accept: request.headers.get("accept") || "*/*",
      "Accept-Language": "en-US,en;q=0.9",
      "Sec-Fetch-Dest": request.headers.get("sec-fetch-dest") || "empty",
      "Sec-Fetch-Mode": request.headers.get("sec-fetch-mode") || "cors",
      "Sec-Fetch-Site": "same-origin",
      Origin: "https://www.facebook.com",
      Referer: targetUrl.includes("facebook.com") || targetUrl.includes("messenger.com") ? targetUrl : "https://www.facebook.com/",
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    };

    const customHeaderKeys = [
      "x-csrftoken",
      "x-fb-lsd",
      "x-requested-with",
      "x-fb-friendly-name",
      "x-fb-rla-fr",
      "x-asbd-id",
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
    });

    const contentType = response.headers.get("content-type") || "";

    const resHeaders = new Headers();
    resHeaders.set("Access-Control-Allow-Origin", "*");
    resHeaders.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS");
    resHeaders.set("Access-Control-Allow-Headers", "*");
    resHeaders.set("Access-Control-Allow-Credentials", "true");
    // NOT X-Frame-Options: SAMEORIGIN. When the proxy is served from an
    // isolation origin (NEXT_PUBLIC_SANDBOX_ORIGIN) the app framing it is
    // a *different* origin, which SAMEORIGIN would block outright.
    // frame-ancestors expresses the same intent but names the app origin,
    // and still refuses framing by anyone else.
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
      // 1. Strip Domain and Secure flags so the browser on localhost / HTTP saves the session cookie
      // 2. Enforce Path=/api/facebook so Facebook cookies stay completely isolated from Instagram
      let sanitized = cookie
        .replace(/Domain=[^;]+;?\s*/gi, "")
        .replace(/Secure;?\s*/gi, "")
        .replace(/Path=[^;]+;?\s*/gi, "")
        .replace(/SameSite=None;?\s*/gi, "SameSite=Lax; ");
      sanitized = sanitized.trim().replace(/;$/, "") + "; Path=/api/facebook";
      resHeaders.append("Set-Cookie", sanitized);
    }

    const locationHeader = response.headers.get("location");
    if (locationHeader) {
      const origin = request.nextUrl.origin;
      let fullLoc = locationHeader;
      if (fullLoc.startsWith("/")) {
        fullLoc = `https://www.facebook.com${fullLoc}`;
      }
      resHeaders.set("Location", `${origin}/api/facebook/proxy?url=${encodeURIComponent(fullLoc)}`);
    }

    if (contentType.includes("text/html")) {
      let html = await response.text();

      // Rewrite <a href> / <form action> that point back at Meta BEFORE
      // the browser sees them. Otherwise a click navigates the iframe to
      // instagram.com/facebook.com directly, which answers with
      // X-Frame-Options and renders "refused to connect".
      html = rewriteNavigationUrls(html, "/api/facebook/proxy", request.nextUrl.origin);

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
    return NextResponse.json(
      { error: "Facebook proxy request failed", details: errorMsg },
      {
        status: 502,
        headers: {
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }
}
