import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// ============================================================
// Route authorization guards — regression tests.
//
// These read the route sources rather than asserting on constants,
// because the bugs they exist to catch are *deletions*: an endpoint
// that quietly stops checking the caller's role still compiles, still
// passes every other test, and still returns 200.
//
// Three real gaps prompted this. Each let an `agent` perform a
// project-admin action, because the handler only proved the caller was
// signed in with a project:
//
//   1. POST   /api/whatsapp/config — write channel credentials
//   2. DELETE /api/whatsapp/config — disconnect the project's number
//   3. POST   /api/email/config    — write SMTP credentials
//
// The UI hid all three from agents, but hiding a nav item is not
// enforcement: a direct API call bypassed it entirely.
// ============================================================

const API_ROOT = join(process.cwd(), "src", "app", "api");

function routeSource(...segments: string[]): string {
  return readFileSync(join(API_ROOT, ...segments, "route.ts"), "utf8");
}

/** Body of one exported handler, so per-method guards can be asserted. */
function handlerBody(source: string, method: "GET" | "POST" | "DELETE" | "PATCH"): string {
  const start = source.indexOf(`export async function ${method}(`);
  if (start === -1) return "";

  // Ends at the next exported handler, or the end of file.
  const rest = source.slice(start + 1);
  const nextExport = rest.indexOf("\nexport async function ");
  return nextExport === -1 ? rest : rest.slice(0, nextExport);
}

describe("whatsapp/config authorization", () => {
  const source = routeSource("whatsapp", "config");

  it("POST requires the project admin role", () => {
    // Storing credentials grants send capability for the whole project.
    expect(handlerBody(source, "POST")).toContain("requireProjectRole('admin')");
  });

  it("DELETE requires the project admin role", () => {
    // Disconnecting takes the project's WhatsApp offline for everyone.
    expect(handlerBody(source, "DELETE")).toContain("requireProjectRole('admin')");
  });

  it("no write handler falls back to a bare authenticated-user check", () => {
    // The original bug: `supabase.auth.getUser()` plus a project scope
    // lookup, with no role comparison anywhere.
    for (const method of ["POST", "DELETE"] as const) {
      const body = handlerBody(source, method);
      expect(body).not.toContain("await resolveScope(");
    }
  });

  it("GET stays readable by any project member", () => {
    // Read only reports whether the channel is healthy; gating it would
    // break the inbox status strip for agents.
    expect(handlerBody(source, "GET")).not.toContain("requireProjectRole('admin')");
  });
});

describe("email/config authorization", () => {
  const source = routeSource("email", "config");

  it("POST requires the admin role", () => {
    // SMTP credentials decide where every outbound email originates.
    const body = handlerBody(source, "POST");
    expect(body.includes("requireProjectRole('admin')") || body.includes("requireRole('admin')")).toBe(true);
  });

  it("GET stays readable by any account member", () => {
    expect(handlerBody(source, "GET")).not.toContain("requireRole('admin')");
  });

  it("GET never returns the stored password", () => {
    const body = handlerBody(source, "GET");
    expect(body).toContain("hasPassword");
    // A boolean flag, never the secret itself.
    expect(body).not.toMatch(/\bpass:\s*config\.pass\b/);
  });
});

describe("project-admin endpoints all carry a role gate", () => {
  // Every endpoint that writes channel credentials or project-wide
  // configuration. A new one added without a gate fails here.
  const ADMIN_WRITE_ROUTES: { path: string[]; methods: ("POST" | "DELETE" | "PATCH")[] }[] = [
    { path: ["whatsapp", "config"], methods: ["POST", "DELETE"] },
    { path: ["email", "config"], methods: ["POST"] },
    { path: ["facebook", "config"], methods: ["POST", "DELETE"] },
    { path: ["ai", "config"], methods: ["POST"] },
    { path: ["pipelines"], methods: ["POST"] },
  ];

  const GATE = /require(ProjectRole|Role|SuperAdmin)\s*\(/;

  for (const route of ADMIN_WRITE_ROUTES) {
    const label = `/api/${route.path.join("/")}`;

    for (const method of route.methods) {
      it(`${method} ${label} checks a role`, () => {
        const body = handlerBody(routeSource(...route.path), method);
        // Handler must exist, and must gate on a role.
        expect(body.length).toBeGreaterThan(0);
        expect(body).toMatch(GATE);
      });
    }
  }
});

describe("platform-admin endpoints require super_admin", () => {
  const SUPER_ADMIN_ROUTES = [
    ["admin", "users"],
    ["admin", "stats"],
    ["admin", "templates"],
    ["projects"],
  ];

  for (const path of SUPER_ADMIN_ROUTES) {
    it(`/api/${path.join("/")} calls requireSuperAdmin`, () => {
      // Project onboarding and platform administration are reserved to
      // the platform operator, not project admins.
      expect(routeSource(...path)).toContain("requireSuperAdmin");
    });
  }
});
