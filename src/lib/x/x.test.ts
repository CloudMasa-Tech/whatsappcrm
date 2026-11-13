import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildXAuthUrl,
  buildXCodeChallenge,
  normalizeXHandle,
  sanitizeXToken,
  X_DEFAULT_SCOPES,
} from "./client";
import { toSafeXConfig } from "./config-store";

describe("X client helpers", () => {
  it("sanitizes Bearer prefix and whitespace from tokens", () => {
    expect(sanitizeXToken("  Bearer abc123\nxyz \t")).toBe("abc123xyz");
    expect(sanitizeXToken("tok_999")).toBe("tok_999");
  });

  it("normalizes handles, stripping @ symbols and parsing profile URLs", () => {
    expect(normalizeXHandle("@hari")).toBe("hari");
    expect(normalizeXHandle("  @@hari_dev  ")).toBe("hari_dev");
    expect(normalizeXHandle("https://x.com/cloudmasa")).toBe("cloudmasa");
    expect(normalizeXHandle("https://twitter.com/elonmusk?s=20")).toBe("elonmusk");
    expect(normalizeXHandle("")).toBe("");
  });

  it("includes dm.read and dm.write in default OAuth scopes", () => {
    expect(X_DEFAULT_SCOPES).toContain("dm.read");
    expect(X_DEFAULT_SCOPES).toContain("dm.write");
  });

  it("builds PKCE S256 code challenge and OAuth authorize URL", () => {
    const challenge = buildXCodeChallenge("test-verifier-string");
    expect(challenge.length).toBeGreaterThan(20);
    expect(challenge).not.toContain("=");

    const url = buildXAuthUrl({
      clientId: "x-client-123",
      redirectUri: "https://crm.example.com/api/x/oauth",
      state: "nonce-xyz",
      codeChallenge: challenge,
    });

    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://twitter.com");
    expect(parsed.pathname).toBe("/i/oauth2/authorize");
    expect(parsed.searchParams.get("client_id")).toBe("x-client-123");
    expect(parsed.searchParams.get("code_challenge")).toBe(challenge);
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    expect(parsed.searchParams.get("scope")).toBe(X_DEFAULT_SCOPES.join(" "));
  });

  it("masks secrets cleanly in toSafeXConfig", () => {
    expect(toSafeXConfig(null)).toMatchObject({
      status: "disconnected",
      has_access_token: false,
      has_refresh_token: false,
      has_client_secret: false,
    });

    const safe = toSafeXConfig({
      id: "row-1",
      connection_method: "oauth",
      x_user_id: "12345",
      username: "cloudmasa",
      display_name: "CloudMaSa",
      access_token: "enc:secret",
      refresh_token: "enc:ref",
      client_secret: "enc:cs",
      followers_count: 140,
      status: "connected",
    });

    expect(safe.has_access_token).toBe(true);
    expect(safe.has_refresh_token).toBe(true);
    expect(safe.has_client_secret).toBe(true);
    expect(safe.username).toBe("cloudmasa");
    expect("access_token" in safe).toBe(false);
    expect("refresh_token" in safe).toBe(false);
    expect("client_secret" in safe).toBe(false);
  });
});

describe("X API route authorization contracts", () => {
  it("enforces agent role on posts, mentions POST, upload, DM, and sync-inbox", () => {
    for (const rel of [
      "src/app/api/x/posts/route.ts",
      "src/app/api/x/mentions/route.ts",
      "src/app/api/x/upload/route.ts",
      "src/app/api/x/dm/route.ts",
      "src/app/api/x/sync-inbox/route.ts",
    ]) {
      const src = readFileSync(join(process.cwd(), rel), "utf8");
      expect(src).toContain("requireProjectRole('agent')");
    }
  });

  it("enforces rate limiting on X posts, media uploads, and DMs", () => {
    for (const rel of [
      "src/app/api/x/posts/route.ts",
      "src/app/api/x/upload/route.ts",
      "src/app/api/x/dm/route.ts",
      "src/app/api/x/sync-inbox/route.ts",
    ]) {
      const src = readFileSync(join(process.cwd(), rel), "utf8");
      expect(src).toContain("checkRateLimit(");
      expect(src).toContain("rateLimitResponse(");
    }
  });
});

