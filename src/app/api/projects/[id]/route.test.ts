import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
  isGatewayConfigured: vi.fn(() => false),
  disconnectSession: vi.fn(),
  tables: {} as Record<string, unknown>,
  deleteCalls: [] as string[],
}));

vi.mock("@/lib/auth/account", () => ({
  getCurrentAccount: mocks.getCurrentAccount,
  requireRole: vi.fn(),
  toErrorResponse: vi.fn((err: unknown) =>
    Response.json({ error: String(err) }, { status: 403 }),
  ),
}));

vi.mock("@/lib/auth/project", () => ({
  resolveProject: vi.fn(),
}));

vi.mock("@/lib/channels/gateway", () => ({
  isGatewayConfigured: mocks.isGatewayConfigured,
  disconnectSession: mocks.disconnectSession,
}));

function makeAdminMock(opts: {
  project: { id: string; name: string; account_id: string } | null;
  totalProjects: number;
  accountProjects: number;
  superAdminsOnAccount: number;
  remainingProfiles: number;
}) {
  return {
    from(table: string) {
      let selectMode = false;
      const filters: Record<string, unknown> = {};
      const chain: Record<string, unknown> = {
        select(_cols?: string, selectOpts?: { count?: string; head?: boolean }) {
          selectMode = true;
          if (selectOpts?.count === "exact" && selectOpts?.head) {
            return {
              eq(col: string, val: unknown) {
                filters[col] = val;
                return this;
              },
              then(resolve: (v: unknown) => void) {
                if (table === "projects" && !("account_id" in filters)) {
                  resolve({ count: opts.totalProjects, error: null });
                } else if (table === "projects" && "account_id" in filters) {
                  resolve({ count: opts.accountProjects, error: null });
                } else if (table === "profiles" && filters.platform_role === "super_admin") {
                  resolve({ count: opts.superAdminsOnAccount, error: null });
                } else if (table === "profiles") {
                  resolve({ count: opts.remainingProfiles, error: null });
                } else {
                  resolve({ count: 0, error: null });
                }
              },
            };
          }
          return chain;
        },
        delete() {
          mocks.deleteCalls.push(table);
          return chain;
        },
        eq(col: string, val: unknown) {
          filters[col] = val;
          return chain;
        },
        in() {
          return chain;
        },
        maybeSingle: async () => {
          if (table === "projects") {
            return { data: opts.project, error: null };
          }
          return { data: null, error: null };
        },
        then(resolve: (v: unknown) => void) {
          if (selectMode) {
            resolve({ data: [], error: null });
          } else {
            resolve({ error: null });
          }
        },
      };
      return chain;
    },
    auth: {
      admin: {
        deleteUser: vi.fn(async () => ({ error: null })),
      },
    },
  };
}

let currentAdminMock: ReturnType<typeof makeAdminMock>;

vi.mock("@/lib/flows/admin-client", () => ({
  supabaseAdmin: () => currentAdminMock,
}));

import { DELETE } from "./route";

const ctx = { params: Promise.resolve({ id: "proj-orphan" }) };

beforeEach(() => {
  mocks.deleteCalls = [];
  mocks.getCurrentAccount.mockReset();
  mocks.getCurrentAccount.mockResolvedValue({
    userId: "sa-1",
    accountId: "acc-home",
    platformRole: "super_admin",
  });
});

describe("DELETE /api/projects/[id]", () => {
  it("rejects non-super-admin callers with 403", async () => {
    mocks.getCurrentAccount.mockResolvedValue({
      userId: "cust-1",
      accountId: "acc-home",
      platformRole: "customer",
    });

    const res = await DELETE(new Request("http://localhost/api/projects/p1"), ctx);
    expect(res.status).toBe(403);
  });

  it("blocks deleting the last remaining project across the entire platform", async () => {
    currentAdminMock = makeAdminMock({
      project: { id: "proj-orphan", name: "Default", account_id: "acc-home" },
      totalProjects: 1,
      accountProjects: 1,
      superAdminsOnAccount: 1,
      remainingProfiles: 1,
    });

    const res = await DELETE(new Request("http://localhost/api/projects/p1"), ctx);
    expect(res.status).toBe(409);
  });

  it("allows deleting an orphan/external account's sole Default project and cleans empty account", async () => {
    currentAdminMock = makeAdminMock({
      project: { id: "proj-orphan", name: "Default", account_id: "acc-orphan" },
      totalProjects: 4,
      accountProjects: 1,
      superAdminsOnAccount: 0,
      remainingProfiles: 0,
    });

    const res = await DELETE(new Request("http://localhost/api/projects/proj-orphan"), ctx);
    expect(res.status).toBe(200);
    expect(mocks.deleteCalls).toContain("whatsapp_sessions");
    expect(mocks.deleteCalls).toContain("whatsapp_session_keys");
    expect(mocks.deleteCalls).not.toContain("qr_sessions");
    expect(mocks.deleteCalls).toContain("projects");
    expect(mocks.deleteCalls).toContain("accounts");
  });

  it("blocks deleting the Super Admin's own home account's last remaining project", async () => {
    currentAdminMock = makeAdminMock({
      project: { id: "proj-home", name: "Default", account_id: "acc-home" },
      totalProjects: 3,
      accountProjects: 1,
      superAdminsOnAccount: 1,
      remainingProfiles: 1,
    });

    const res = await DELETE(new Request("http://localhost/api/projects/proj-home"), ctx);
    expect(res.status).toBe(409);
  });
});
