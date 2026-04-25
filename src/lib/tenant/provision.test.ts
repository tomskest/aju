/**
 * Unit tests for tenant-provision.
 *
 * provisionTenant orchestrates Neon API calls + the control Prisma client +
 * a spawnSync (`prisma db push`) + `pg.Client`. We mock every external
 * boundary so the test stays hermetic:
 *
 *   - `./neon-api`      → hoisted vi.mock with stubbed callables
 *   - `./db`            → hoisted vi.mock with a fake prisma control client
 *   - `node:child_process` → spawnSync returns a clean exit
 *   - `pg`              → fake Client that tolerates any query we run
 *
 * The goal is not to reproduce Neon's HTTP behaviour; it's to pin down the
 * orchestration contract:
 *   1. createRole before createDatabase
 *   2. idempotence when tenant is already active
 *   3. if a Neon call fails, the tenant row stays in "provisioning"
 *   4. persisted DSNs are AES-GCM ciphertext (v1: prefix)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";

// ── Mock surface ────────────────────────────────────────

const neonMock = vi.hoisted(() => ({
  getDefaultBranchId: vi.fn(),
  getReadWriteEndpoint: vi.fn(),
  createRole: vi.fn(),
  createDatabase: vi.fn(),
  revealRolePassword: vi.fn(),
  deleteRole: vi.fn(),
  deleteDatabase: vi.fn(),
  buildDirectDsn: vi.fn(),
  buildPooledDsn: vi.fn(),
  NeonApiError: class NeonApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.name = "NeonApiError";
      this.status = status;
    }
  },
}));

const dbMock = vi.hoisted(() => ({
  prisma: {
    organization: { findUnique: vi.fn() },
    tenant: {
      upsert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
  CURRENT_TENANT_SCHEMA_VERSION: 1,
}));

vi.mock("./neon-api", () => neonMock);
vi.mock("@/lib/db", () => dbMock);

vi.mock("node:child_process", () => ({
  // `prisma db push` would spawn a real process; force a clean exit.
  spawnSync: vi.fn(() => ({ status: 0, stdout: "", stderr: "" })),
}));

vi.mock("pg", () => {
  // Minimal Client stand-in: every query resolves; the brain-count probe
  // returns 0 so seedDefaultBrain treats the tenant as empty.
  class Client {
    constructor(_args?: unknown) {}
    async connect(): Promise<void> {}
    async end(): Promise<void> {}
    async query(sql: string): Promise<{ rows: Array<{ count: string }> }> {
      if (/SELECT COUNT\(\*\)/i.test(sql)) {
        return { rows: [{ count: "0" }] };
      }
      return { rows: [] };
    }
  }
  return { Client };
});

// fs reads of the tenant-setup SQL files — we don't actually care what's
// inside, just that the orchestration reaches them.
vi.mock("node:fs", () => ({
  readFileSync: vi.fn(() => "-- noop sql --"),
}));

// ── Helpers ─────────────────────────────────────────────

function setEncKey(): void {
  process.env.TENANT_DSN_ENC_KEY = randomBytes(32).toString("base64");
}

async function loadSubject(): Promise<typeof import("./provision")> {
  vi.resetModules();
  // Re-hoist the real tenant-crypto (not mocked) so we can assert v1: output.
  return await import("./provision");
}

const orgId = "orgabc";
const baseOrg = {
  id: orgId,
  name: "Acme",
  slug: "acme",
  ownerUserId: "u1",
  isPersonal: false,
};

function wireHappyPath(): void {
  neonMock.getDefaultBranchId.mockResolvedValue("br_123");
  neonMock.getReadWriteEndpoint.mockResolvedValue({
    id: "ep_1",
    host: "ep-foo.eu.aws.neon.tech",
    type: "read_write",
    branch_id: "br_123",
  });
  neonMock.createRole.mockResolvedValue({ name: "org_orgabc_app" });
  neonMock.createDatabase.mockResolvedValue({ name: "org_orgabc" });
  neonMock.revealRolePassword.mockResolvedValue("pw");
  neonMock.buildDirectDsn.mockReturnValue("postgresql://direct/dsn");
  neonMock.buildPooledDsn.mockReturnValue("postgresql://pooled/dsn");
}

// ── Tests ───────────────────────────────────────────────

describe("provisionTenant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setEncKey();
    dbMock.prisma.organization.findUnique.mockResolvedValue(baseOrg);
    dbMock.prisma.tenant.upsert.mockResolvedValue({});
    dbMock.prisma.tenant.update.mockResolvedValue({});
  });

  afterEach(() => {
    delete process.env.TENANT_DSN_ENC_KEY;
  });

  it("calls createRole before createDatabase for a new org", async () => {
    wireHappyPath();
    const order: string[] = [];
    neonMock.createRole.mockImplementationOnce(async () => {
      order.push("createRole");
      return { name: "org_orgabc_app" };
    });
    neonMock.createDatabase.mockImplementationOnce(async () => {
      order.push("createDatabase");
      return { name: "org_orgabc" };
    });

    const { provisionTenant } = await loadSubject();
    await provisionTenant(orgId);

    expect(order).toEqual(["createRole", "createDatabase"]);
    expect(neonMock.createRole).toHaveBeenCalledWith({
      branchId: "br_123",
      name: "org_orgabc_app",
    });
    expect(neonMock.createDatabase).toHaveBeenCalledWith({
      branchId: "br_123",
      name: "org_orgabc",
      ownerRole: "org_orgabc_app",
    });
  });

  it("persists DSNs as v1:-prefixed ciphertext", async () => {
    wireHappyPath();
    const { provisionTenant } = await loadSubject();
    await provisionTenant(orgId);

    // The FINAL tenant.update (step 5+6) carries the encrypted DSNs.
    const calls = dbMock.prisma.tenant.update.mock.calls;
    const finalCall = calls[calls.length - 1];
    const data = finalCall?.[0]?.data ?? {};
    expect(typeof data.dsnDirectEnc).toBe("string");
    expect(typeof data.dsnPooledEnc).toBe("string");
    expect(data.dsnDirectEnc.startsWith("v1:")).toBe(true);
    expect(data.dsnPooledEnc.startsWith("v1:")).toBe(true);
    expect(data.status).toBe("active");
  });

  it("swallows already-exists errors from createRole and createDatabase (idempotent resume)", async () => {
    wireHappyPath();
    neonMock.createRole.mockRejectedValueOnce(
      new neonMock.NeonApiError(409, "role already exists"),
    );
    neonMock.createDatabase.mockRejectedValueOnce(
      new neonMock.NeonApiError(409, "database already exists"),
    );

    const { provisionTenant } = await loadSubject();
    await expect(provisionTenant(orgId)).resolves.toBeUndefined();
    // Happy-path still flips the row to active at the end.
    const lastUpdate = dbMock.prisma.tenant.update.mock.calls.at(-1);
    expect(lastUpdate?.[0]?.data?.status).toBe("active");
  });

  it("leaves tenant row at status=provisioning when createRole fails mid-flight", async () => {
    wireHappyPath();
    const boom = new neonMock.NeonApiError(500, "neon exploded");
    neonMock.createRole.mockRejectedValueOnce(boom);

    const { provisionTenant } = await loadSubject();
    await expect(provisionTenant(orgId)).rejects.toThrow(/neon exploded/);

    // Step 1 upserted status=provisioning; no later update promoted it.
    const upsertCall = dbMock.prisma.tenant.upsert.mock.calls[0]?.[0];
    expect(upsertCall?.create?.status).toBe("provisioning");
    const activeUpdate = dbMock.prisma.tenant.update.mock.calls.find(
      (c) => c[0]?.data?.status === "active",
    );
    expect(activeUpdate).toBeUndefined();
  });

  it("throws when the organization does not exist", async () => {
    dbMock.prisma.organization.findUnique.mockResolvedValueOnce(null);
    const { provisionTenant } = await loadSubject();
    await expect(provisionTenant("ghost")).rejects.toThrow(
      /does not exist/,
    );
    expect(neonMock.createRole).not.toHaveBeenCalled();
  });
});
