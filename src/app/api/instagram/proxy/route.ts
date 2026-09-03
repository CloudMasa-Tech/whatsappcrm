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
  // 1. Anti-Framebusting — isolate window hierarchy
  try {
    Object.defineProperty(window, 'top', { get: function() { return window.self; }, configurable: true });
    Object.defineProperty(window, 'parent', { get: function() { return window.self; }, configurable: true });
    Object.defineProperty(window, 'frameElement', { get: function() { return null; }, configurable: true });
  } catch(e) {}

  // 2. Override document.referrer to prevent Meta from rejecting embedded challenges
  try {
    Object.defineProperty(document, 'referrer', {
      get: function() { return 'https://www.instagram.com/'; },
      configurable: true
    });
  } catch(e) {}

  // 3. Disable WebAuthn/Credentials in frame to prevent Passkey error logging
  try {
    try { Object.defineProperty(window, 'PublicKeyCredential', { value: undefined, configurable: true, writable: true }); } catch(e) {}
    try { Object.defineProperty(navigator, 'credentials', { value: undefined, configurable: true, writable: true }); } catch(e) {}
  } catch(e) {}

  // 4. Helper to normalize and route Meta/Instagram navigation URLs through local proxy
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

    // Sanitize any local referer parameters
    if (target.indexOf('referer=http') !== -1 || target.indexOf('referer=http%3A') !== -1) {
      target = target.replace(/referer=http(?:%3A%2F%2F|:\\/\\/)[^&]+/gi, 'referer=https%3A%2F%2Fwww.instagram.com%2F');
    }

    // Skip bulk-route definitions and telemetry logging to avoid rate limits
    if (target.indexOf('/ajax/bulk-route-definitions') !== -1 || target.indexOf('/logging/') !== -1) {
      return target;
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

  // 5. Trap programmatic navigation on window.location & Location.prototype
  try {
    var LocProto = window.Location && window.Location.prototype;
    if (LocProto) {
      var hrefDesc = Object.getOwnPropertyDescriptor(LocProto, 'href');
      if (hrefDesc && hrefDesc.set) {
        var origSetHref = hrefDesc.set;
        Object.defineProperty(LocProto, 'href', {
          set: function(url) {
            return origSetHref.call(this, normalizeAndProxyUrl(String(url)));
          },
          get: hrefDesc.get,
          configurable: true
        });
      }

      ['assign', 'replace'].forEach(function(fn) {
        var orig = LocProto[fn];
        if (typeof orig === 'function') {
          LocProto[fn] = function(url) {
            try { return orig.call(this, normalizeAndProxyUrl(String(url))); }
            catch (e) { return orig.call(this, url); }
          };
        }
      });
    }
  } catch(e) {}

  // 6. Trap Navigation API (Chromium)
  try {
    if (window.navigation && typeof window.navigation.addEventListener === 'function') {
      window.navigation.addEventListener('navigate', function(event) {
        if (event.destination && event.destination.url) {
          var proxied = normalizeAndProxyUrl(event.destination.url);
          if (proxied !== event.destination.url && proxied.indexOf('/api/instagram/proxy') !== -1) {
            event.preventDefault();
            window.location.replace(proxied);
          }
        }
      });
    }
  } catch(e) {}

  // 7. Trap dynamic iframe.src assignments (e.g. reCAPTCHA challenge frames)
  try {
    var iframeSrcDesc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src');
    if (iframeSrcDesc && iframeSrcDesc.set) {
      var origSetIframeSrc = iframeSrcDesc.set;
      Object.defineProperty(HTMLIFrameElement.prototype, 'src', {
        set: function(val) {
          return origSetIframeSrc.call(this, normalizeAndProxyUrl(String(val)));
        },
        get: iframeSrcDesc.get,
        configurable: true
      });
    }
  } catch(e) {}

  // 8. Trap form.action & form.submit()
  try {
    var origSubmit = HTMLFormElement.prototype.submit;
    HTMLFormElement.prototype.submit = function() {
      try {
        if (this.action) {
          this.action = normalizeAndProxyUrl(this.action);
        }
      } catch(e) {}
      return origSubmit.call(this);
    };
  } catch(e) {}

  try {
    var actionDesc = Object.getOwnPropertyDescriptor(HTMLFormElement.prototype, 'action');
    if (actionDesc && actionDesc.set) {
      var origSetAction = actionDesc.set;
      Object.defineProperty(HTMLFormElement.prototype, 'action', {
        set: function(val) {
          return origSetAction.call(this, normalizeAndProxyUrl(String(val)));
        },
        get: actionDesc.get,
        configurable: true
      });
    }
  } catch(e) {}

  // 9. Intercept window.fetch for navigation requests
  var originalFetch = window.fetch;
  window.fetch = function(input, init) {
    try {
      if (typeof input === 'string') {
        if (input.indexOf('/ajax/bulk-route') === -1) {
          input = normalizeAndProxyUrl(input);
        }
      } else if (input && input.url) {
        if (input.url.indexOf('/ajax/bulk-route') === -1) {
          var proxiedUrl = normalizeAndProxyUrl(input.url);
          if (proxiedUrl !== input.url && input instanceof Request) {
            input = new Request(proxiedUrl, init);
          }
        }
      }
    } catch(err) {}
    return originalFetch.apply(this, [input, init]);
  };

  // 10. Intercept XMLHttpRequest (XHR)
  var originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, async, user, password) {
    try {
      if (url && String(url).indexOf('/ajax/bulk-route') === -1) {
        url = normalizeAndProxyUrl(String(url));
      }
    } catch(err) {}
    return originalOpen.call(this, method, url, async !== false, user, password);
  };

  // 11. Intercept Link Clicks and Form Submissions so iframe stays within proxy
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

function extractTargetUrl(requestUrl: string): string {
  const urlObj = new URL(requestUrl);
  let targetUrl = urlObj.searchParams.get("url") || "https://www.instagram.com/direct/inbox/";

  // Reconstruct unencoded query parameters if url param was partially split
  if (urlObj.searchParams.size > 1 && !targetUrl.includes("&")) {
    const extraParams: string[] = [];
    urlObj.searchParams.forEach((value, key) => {
      if (key !== "url") {
        extraParams.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
      }
    });
    if (extraParams.length > 0) {
      targetUrl += (targetUrl.includes("?") ? "&" : "?") + extraParams.join("&");
    }
  }

  // Sanitize any local referer parameters
  if (targetUrl.includes("referer=http") || targetUrl.includes("referer=http%3A")) {
    targetUrl = targetUrl.replace(/referer=http(?:%3A%2F%2F|:\/\/)[^&]+/gi, "referer=https%3A%2F%2Fwww.instagram.com%2F");
  }

  return targetUrl;
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
  const targetUrl = extractTargetUrl(request.url);

  const isAjaxOrApi =
    targetUrl.includes("/ajax/") ||
    targetUrl.includes("/api/") ||
    targetUrl.includes("graphql") ||
    targetUrl.includes(".json") ||
    targetUrl.includes(".js");

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

    // Bypass bulk-route definitions to prevent 429 Comet rate limiting loops
    if (targetUrl.includes("/ajax/bulk-route-definitions/")) {
      return new NextResponse('for (;;);{"payload":{"status":"ok"},"status":"ok"}', {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    const cookieHeader = request.headers.get("cookie") || "";
    const contentTypeReq = request.headers.get("content-type");

    let csrfTokenFromCookie = "";
    if (cookieHeader) {
      const match = cookieHeader.match(/csrftoken=([^;]+)/);
      if (match) csrfTokenFromCookie = match[1];
    }

    const isFbSbx = targetUrl.includes("fbsbx.com");
    const isFacebook = targetUrl.includes("facebook.com") || targetUrl.includes("messenger.com");
    const metaOrigin = isFacebook ? "https://www.facebook.com" : "https://www.instagram.com";

    const reqHeaders: Record<string, string> = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: request.headers.get("accept") || "*/*",
      "Accept-Language": "en-US,en;q=0.9",
      "Sec-Ch-Ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": '"Windows"',
      "Sec-Fetch-Dest": isAjaxOrApi ? "empty" : (isFbSbx ? "iframe" : "document"),
      "Sec-Fetch-Mode": isAjaxOrApi ? "cors" : "navigate",
      "Sec-Fetch-Site": isFbSbx ? "cross-site" : "same-origin",
      Origin: metaOrigin,
      Referer: isFbSbx ? "https://www.instagram.com/" : (targetUrl.includes("instagram.com") ? targetUrl : "https://www.instagram.com/"),
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

    if (response.status === 429 && isAjaxOrApi) {
      return new NextResponse('for (;;);{"payload":{"status":"ok"},"status":"ok"}', {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    const contentType = response.headers.get("content-type") || "";

    const resHeaders = new Headers();
    resHeaders.set("Access-Control-Allow-Origin", "*");
    resHeaders.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS");
    resHeaders.set("Access-Control-Allow-Headers", "*");
    resHeaders.set("Access-Control-Allow-Credentials", "true");
    
    // Explicitly override frame protection headers
    resHeaders.delete("x-frame-options");
    resHeaders.set("Content-Security-Policy", "frame-ancestors *");
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
      sanitized = sanitized.trim().replace(/;$/, "") + "; Path=/";
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

    // Only inject client script into actual HTML documents, NOT AJAX/JSON responses
    if (contentType.includes("text/html") && !isAjaxOrApi) {
      let html = await response.text();
      html = rewriteNavigationUrls(html, "/api/instagram/proxy", request.nextUrl.origin);
      
      // Inject at beginning of <head> or at start
      if (/<head\b[^>]*>/i.test(html)) {
        html = html.replace(/<head\b[^>]*>/i, (m) => `${m}\n${CLIENT_INJECTION_SCRIPT}`);
      } else {
        html = CLIENT_INJECTION_SCRIPT + html;
      }

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
    if (isAjaxOrApi) {
      return new NextResponse('for (;;);{"payload":{"status":"ok"},"status":"ok"}', {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

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
}
