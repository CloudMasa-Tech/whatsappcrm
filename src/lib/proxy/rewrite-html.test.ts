import { describe, it, expect } from "vitest";

import { rewriteNavigationUrls } from "./rewrite-html";

const ORIGIN = "http://localhost:3000";
const IG = "/api/instagram/proxy" as const;
const FB = "/api/facebook/proxy" as const;

describe("rewriteNavigationUrls", () => {
  it("routes an anchor pointing at Meta back through the proxy", () => {
    const out = rewriteNavigationUrls(
      '<a href="https://www.instagram.com/direct/inbox/">Inbox</a>',
      IG,
      ORIGIN,
    );
    expect(out).toContain(
      `${ORIGIN}${IG}?url=${encodeURIComponent("https://www.instagram.com/direct/inbox/")}`,
    );
    expect(out).not.toContain('href="https://www.instagram.com');
  });

  it("routes a form action, which would otherwise POST straight to Meta", () => {
    const out = rewriteNavigationUrls(
      '<form method="post" action="https://www.facebook.com/login/">',
      FB,
      ORIGIN,
    );
    expect(out).toContain(`action="${ORIGIN}${FB}?url=`);
  });

  it("handles subdomains such as business.facebook.com", () => {
    const out = rewriteNavigationUrls(
      '<a href="https://business.facebook.com/latest/inbox/all">x</a>',
      FB,
      ORIGIN,
    );
    expect(out).toContain(`${ORIGIN}${FB}?url=`);
  });

  it("normalises protocol-relative URLs before proxying", () => {
    const out = rewriteNavigationUrls(
      '<a href="//www.instagram.com/explore/">x</a>',
      IG,
      ORIGIN,
    );
    expect(out).toContain(encodeURIComponent("https://www.instagram.com/explore/"));
  });

  it("never double-wraps a URL that is already proxied", () => {
    const already = `<a href="${ORIGIN}${IG}?url=https%3A%2F%2Fwww.instagram.com%2F">x</a>`;
    expect(rewriteNavigationUrls(already, IG, ORIGIN)).toBe(already);
  });

  it("leaves CDN assets alone — they load fine cross-origin", () => {
    // Proxying these would funnel megabytes through the server for no
    // containment benefit; they cannot navigate the frame.
    const html =
      '<img src="https://scontent.cdninstagram.com/a.jpg">' +
      '<script src="https://static.xx.fbcdn.net/rsrc.js"></script>';
    expect(rewriteNavigationUrls(html, IG, ORIGIN)).toBe(html);
  });

  it("leaves non-Meta links untouched", () => {
    const html = '<a href="https://example.com/help">Help</a>';
    expect(rewriteNavigationUrls(html, IG, ORIGIN)).toBe(html);
  });

  it("leaves relative and non-navigational schemes untouched", () => {
    const html =
      '<a href="/direct/inbox/">rel</a>' +
      '<a href="#top">hash</a>' +
      '<a href="mailto:a@b.com">mail</a>' +
      '<a href="javascript:void(0)">js</a>';
    expect(rewriteNavigationUrls(html, IG, ORIGIN)).toBe(html);
  });

  it("rewrites onto the isolation origin when one is in use", () => {
    // Keeps the frame on the sandbox host rather than bouncing it back
    // to the app origin, which would defeat the isolation.
    const sandbox = "https://sandbox.example.com";
    const out = rewriteNavigationUrls(
      '<a href="https://www.facebook.com/">x</a>',
      FB,
      sandbox,
    );
    expect(out).toContain(`href="${sandbox}${FB}?url=`);
  });

  it("handles multiple attributes and other attributes on the same tag", () => {
    const out = rewriteNavigationUrls(
      '<a class="x" data-y="1" href="https://www.facebook.com/a" target="_blank">a</a>' +
        '<a href="https://www.facebook.com/b">b</a>',
      FB,
      ORIGIN,
    );
    // Both anchors rewritten: two occurrences of the proxy prefix.
    expect(out.split(`${ORIGIN}${FB}?url=`).length - 1).toBe(2);
    expect(out).toContain('class="x"');
    expect(out).toContain('target="_blank"');
  });
});
