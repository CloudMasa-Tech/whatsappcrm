import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  applySocialCaptionMergeFields,
  detectMediaKindFromMimeOrUrl,
  getPlatformCompatibilityWarnings,
  MAX_SOCIAL_MEDIA_BYTES,
  parseWhatsAppPhoneLines,
  STARTER_SOCIAL_TEMPLATES,
  validateSocialMediaFile,
} from "./campaigns";

describe("social campaigns helpers", () => {
  it("exposes starter multi-platform templates including RegiBIZ", () => {
    expect(STARTER_SOCIAL_TEMPLATES.length).toBeGreaterThanOrEqual(3);
    expect(STARTER_SOCIAL_TEMPLATES[0].suggestedPlatforms).toEqual([
      "whatsapp",
      "instagram",
      "facebook",
      "linkedin",
      "x",
    ]);
  });

  it("detects image, video, and document media kinds from MIME or URL", () => {
    expect(detectMediaKindFromMimeOrUrl("image/png")).toBe("image");
    expect(detectMediaKindFromMimeOrUrl("https://cdn.example.com/banner.JPG?v=1")).toBe("image");
    expect(detectMediaKindFromMimeOrUrl("video/mp4")).toBe("video");
    expect(detectMediaKindFromMimeOrUrl("https://cdn.example.com/demo.mov")).toBe("video");
    expect(detectMediaKindFromMimeOrUrl("application/pdf")).toBe("document");
    expect(detectMediaKindFromMimeOrUrl("https://cdn.example.com/brochure.pdf")).toBe("document");
  });

  it("validates social media file size and MIME/extension", () => {
    expect(validateSocialMediaFile("empty.png", "image/png", 0)).toMatch(/empty/i);
    expect(
      validateSocialMediaFile("huge.mp4", "video/mp4", MAX_SOCIAL_MEDIA_BYTES + 1),
    ).toMatch(/50 MB/i);
    expect(validateSocialMediaFile("script.exe", "application/octet-stream", 1024)).toMatch(
      /not a supported/i,
    );
    expect(validateSocialMediaFile("promo.webp", "image/webp", 2048)).toBeNull();
    expect(validateSocialMediaFile("deck.pdf", "application/pdf", 2048)).toBeNull();
  });

  it("parses CSV/newline phone lists cleanly and deduplicates", () => {
    const parsed = parseWhatsAppPhoneLines(
      "\uFEFFphone,name\n+919876543210, Priya\nArjun, +91 99887 76655\n+919876543210, Duplicate\n9123456789\ninvalid",
    );
    expect(parsed).toEqual([
      { phone: "+919876543210", name: "Priya" },
      { phone: "+919988776655", name: "Arjun" },
      { phone: "9123456789", name: null },
    ]);
  });

  it("replaces {{name}} and {{phone}} merge fields with sensible defaults", () => {
    expect(
      applySocialCaptionMergeFields("Hi {{name}}, call {{ phone }}", {
        name: "Priya",
        phone: "+919876543210",
      }),
    ).toBe("Hi Priya, call +919876543210");

    expect(applySocialCaptionMergeFields("Hello {{ name }}!", {})).toBe(
      "Hello there!",
    );
  });

  it("reports channel compatibility errors and informational hints accurately", () => {
    const igMissingMedia = getPlatformCompatibilityWarnings({
      platforms: ["instagram", "linkedin", "x"],
      media: [],
      caption: "",
    });
    expect(igMissingMedia).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ platform: "instagram", level: "error" }),
        expect.objectContaining({ platform: "linkedin", level: "error" }),
        expect.objectContaining({ platform: "x", level: "error" }),
      ]),
    );

    const longXPost = getPlatformCompatibilityWarnings({
      platforms: ["x"],
      media: [],
      caption: "a".repeat(300),
    });
    expect(longXPost).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ platform: "x", level: "info" }),
      ]),
    );

    const cloudApiMissingTpl = getPlatformCompatibilityWarnings({
      platforms: ["whatsapp", "linkedin"],
      media: [{ url: "https://cdn.example.com/reel.mp4", kind: "video" }],
      caption: "Launch video",
      whatsappMode: "cloud_api",
      whatsappTemplateName: null,
    });
    expect(cloudApiMissingTpl).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ platform: "whatsapp", level: "error" }),
        expect.objectContaining({ platform: "linkedin", level: "info" }),
      ]),
    );
  });
});

describe("social campaigns API route security contracts", () => {
  const routes = [
    "src/app/api/social-campaigns/status/route.ts",
    "src/app/api/social-campaigns/upload/route.ts",
    "src/app/api/social-campaigns/publish/route.ts",
  ];

  it.each(routes)("%s enforces project agent authorization", (relPath) => {
    const src = readFileSync(join(process.cwd(), relPath), "utf8");
    expect(src).toContain("requireProjectRole('agent')");
    expect(src).toContain("requireProject(");
    expect(src).toContain("'all'");
  });

  it("upload and publish routes enforce rate limiting", () => {
    for (const relPath of [
      "src/app/api/social-campaigns/upload/route.ts",
      "src/app/api/social-campaigns/publish/route.ts",
    ]) {
      const src = readFileSync(join(process.cwd(), relPath), "utf8");
      expect(src).toContain("checkRateLimit(");
      expect(src).toContain("rateLimitResponse(");
    }
  });
});

