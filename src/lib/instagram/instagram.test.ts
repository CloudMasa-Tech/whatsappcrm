import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  detectTokenType,
  graphBaseFor,
  sanitizeAccessToken,
  validateMetaTokenShape,
  verifyMetaCredentials,
} from "./meta-client";
import { normalizeHandle, sendDirectTextMessage } from "./direct-client";
import { buildInstagramMediaProxyUrl } from "./inbound";
import { ephemeralMediaCache } from "../media/ephemeral-cache";
import { decrypt } from "../whatsapp/encryption";

const API_ROOT = join(process.cwd(), "src", "app", "api");

function routeSource(...segments: string[]): string {
  return readFileSync(join(API_ROOT, ...segments, "route.ts"), "utf8");
}

describe("Meta token auto-detection", () => {
  it("detects IGA* tokens as instagram_login", () => {
    expect(detectTokenType("IGA1234567890abcdef")).toBe("instagram_login");
    expect(graphBaseFor("instagram_login")).toBe("https://graph.instagram.com/v21.0");
  });

  it("detects EAAB* tokens as facebook_page", () => {
    expect(detectTokenType("EAABwzLixnjYBO...")).toBe("facebook_page");
    expect(graphBaseFor("facebook_page")).toBe("https://graph.facebook.com/v21.0");
  });

  it("honors explicit override when passed", () => {
    expect(detectTokenType("CUSTOM_TOKEN", "instagram_login")).toBe("instagram_login");
    expect(detectTokenType("IGA_TOKEN", "facebook_page")).toBe("facebook_page");
  });

  it("sanitizes Bearer prefix, quotes, internal wrapped spaces, and OAuth hash fragments", () => {
    expect(sanitizeAccessToken('  "Bearer IGAA1234567890 abcdef" \n ')).toBe(
      "IGAA1234567890abcdef",
    );
    expect(sanitizeAccessToken("EAAaR7tUPy udqh GCuia9F3yz 7CUO")).toBe(
      "EAAaR7tUPyudqhGCuia9F3yz7CUO",
    );
    expect(
      sanitizeAccessToken(
        "https://crm.example.com/callback#access_token=EAAB1234567890abcdef#_=_",
      ),
    ).toBe("EAAB1234567890abcdef");
  });

  it("rejects pasted App Secrets and App Tokens with clear guidance", () => {
    expect(() => validateMetaTokenShape("123456789012345|abcdef1234567890abcdef")).toThrow(
      /App\/Client Token/i,
    );
    expect(() => validateMetaTokenShape("0123456789abcdef0123456789abcdef")).toThrow(
      /App Secret/i,
    );
  });

  it("verifies an EAA User token via /me/accounts without requesting profile_picture_url on /me", async () => {
    const requestedUrls: string[] = [];
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      requestedUrls.push(url);
      if (url.includes("/me/permissions")) {
        return new Response(JSON.stringify({ data: [{ permission: "instagram_basic", status: "granted" }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/me/accounts")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "page_111",
                name: "CloudMasa Page",
                access_token: "EAAPageToken99999999999999999999",
                instagram_business_account: {
                  id: "178414000001",
                  username: "cloudmasa_ig",
                  name: "CloudMasa",
                  profile_picture_url: "https://cdninstagram.com/avatar.jpg",
                  followers_count: 1200,
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("/me?fields=id,name")) {
        return new Response(JSON.stringify({ id: "fb_user_1", name: "Admin User" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: { message: "Unexpected URL", code: 100 } }), { status: 400 });
    });

    try {
      const meta = await verifyMetaCredentials(
        "EAAUserToken123456789012345678901234567890",
        undefined,
        "instagram_login", // Even if dropdown picked instagram_login, EAA* routes cleanly to FB Graph
      );
      expect(meta.id).toBe("178414000001");
      expect(meta.username).toBe("cloudmasa_ig");
      expect(meta.pageId).toBe("page_111");
      expect(meta.pageAccessToken).toBe("EAAPageToken99999999999999999999");
      expect(requestedUrls.some((u) => u.includes("/me?fields=id,name,username,profile_picture_url"))).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("Direct client handle normalization & fail-honest DM send", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("strips Instagram URLs and leading @ symbols", () => {
    expect(normalizeHandle("@cloudmasa_innovation")).toBe("cloudmasa_innovation");
    expect(normalizeHandle("https://www.instagram.com/cloudmasa_innovation/reels/")).toBe(
      "cloudmasa_innovation",
    );
  });

  it("returns success: false when session cookie is missing (never fakes success)", async () => {
    const res = await sendDirectTextMessage(JSON.stringify({ username: "me" }), "target", "hi");
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/cookie is missing/i);
  });

  it("returns success: false when Instagram broadcast endpoint fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "fail", message: "checkpoint_required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const session = JSON.stringify({
      username: "me",
      csrftoken: "csrf123",
      cookies: { sessionid: "12345%3Aabc", csrftoken: "csrf123" },
    });

    const res = await sendDirectTextMessage(session, "987654321", "hello");
    expect(res.success).toBe(false);
    expect(res.error).toContain("checkpoint_required");
  });
});

describe("Instagram API route security contracts", () => {
  it("enforces admin role on credential config & auth endpoints", () => {
    expect(routeSource("instagram", "config")).toContain('requireProjectRole("admin")');
    expect(routeSource("instagram", "auth")).toContain('requireProjectRole("admin")');
    expect(routeSource("instagram", "validate")).toContain('requireProjectRole("admin")');
  });

  it("enforces agent role on operational studio, comment, reaction & sync endpoints", () => {
    expect(routeSource("instagram", "publish")).toContain('requireProjectRole("agent")');
    expect(routeSource("instagram", "upload")).toContain('requireProjectRole("agent")');
    expect(routeSource("instagram", "sync-profile")).toContain('requireProjectRole("agent")');
    expect(routeSource("instagram", "sync-inbox")).toContain('requireProjectRole("agent")');
    expect(routeSource("instagram", "comments")).toContain('requireProjectRole("agent")');
    expect(routeSource("instagram", "react")).toContain('requireProjectRole("agent")');
  });

  it("enforces user authentication on proxy endpoint and signature verification on webhook", () => {
    expect(routeSource("instagram", "proxy")).toContain("auth.getUser()");
    expect(routeSource("instagram", "webhook")).toContain("x-hub-signature-256");
    expect(routeSource("instagram", "webhook")).toContain("verifySignature");
    expect(routeSource("instagram", "webhook")).toContain("is_echo");
  });

  it("decrypts Meta access tokens before Graph calls in publish and sync-profile", () => {
    expect(routeSource("instagram", "publish")).toContain("decrypt(config.access_token)");
    expect(routeSource("instagram", "sync-profile")).toContain("decrypt(config.access_token)");
  });

  it("enforces auth and project scoping on the cached dm-media and whatsapp qr media routes", () => {
    const igMedia = routeSource("instagram", "dm-media");
    expect(igMedia).toContain("auth.getUser()");
    expect(igMedia).toContain("requireProject(desc.p)");
    const qrMedia = routeSource("whatsapp", "qr", "media");
    expect(qrMedia).toContain("auth.getUser()");
    expect(qrMedia).toContain("requireProject(projectId)");
  });
});

describe("Cached inbound media proxy & ephemeral cache", () => {
  it("seals inbound Instagram media into /api/instagram/dm-media without Storage upload", () => {
    const proxied = buildInstagramMediaProxyUrl(
      "proj-123",
      "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1",
      "mid.999",
      "image",
    );
    expect(proxied.startsWith("/api/instagram/dm-media?ref=")).toBe(true);
    const ref = proxied.split("ref=")[1];
    const parsed = JSON.parse(decrypt(Buffer.from(ref, "base64url").toString("utf8")));
    expect(parsed.p).toBe("proj-123");
    expect(parsed.mid).toBe("mid.999");
    expect(parsed.u).toContain("lookaside.fbsbx.com");
  });

  it("caches fetched media in ephemeralMediaCache without calling loader twice", async () => {
    let loads = 0;
    const key = ephemeralMediaCache.keyFor("test-suite", `item-${Date.now()}`);
    const loader = async () => {
      loads++;
      return { buffer: Buffer.from("hello-bytes"), contentType: "image/jpeg" };
    };
    const first = await ephemeralMediaCache.getOrLoad(key, loader);
    const second = await ephemeralMediaCache.getOrLoad(key, loader);
    expect(loads).toBe(1);
    expect(first.buffer.toString()).toBe("hello-bytes");
    expect(second.buffer.toString()).toBe("hello-bytes");
  });
});

