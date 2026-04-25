/**
 * Unit tests for the API-key authentication layer.
 *
 * Covered paths:
 *   - No Authorization header → 401
 *   - DB-prefix key, no row    → 401
 *   - DB-prefix key, wrong hash → 401
 *   - DB-prefix key, revoked    → 401 (no existence leak)
 *   - DB-prefix key, expired    → 401
 *   - DB-prefix key, happy path → AuthSuccess with user/org context
 *   - Env-var legacy key, happy path → AuthSuccess
 *   - Env-var legacy key, wrong value → 401
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

// ── Mocks ───────────────────────────────────────────────

const dbMock = vi.hoisted(() => ({
  prisma: {
    apiKey: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
  },
}));

const apiKeyMock = vi.hoisted(() => ({
  verifyApiKey: vi.fn(),
}));

vi.mock("@/lib/db", () => dbMock);
vi.mock("./api-key", () => apiKeyMock);

// ── Helpers ─────────────────────────────────────────────

function makeReq(headers: Record<string, string> = {}): {
  headers: { get(name: string): string | null };
} {
  const lower = new Map(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return {
    headers: {
      get(name: string): string | null {
        return lower.get(name.toLowerCase()) ?? null;
      },
    },
  };
}

async function loadSubject(): Promise<typeof import("./bearer")> {
  vi.resetModules();
  return await import("./bearer");
}

const SAMPLE_DB_TOKEN = "aju_live_abc123xyz789_restoftoken";
const SAMPLE_DB_PREFIX = SAMPLE_DB_TOKEN.slice(0, 12);
const SAMPLE_USER = {
  id: "u1",
  email: "toomas@example.com",
};
const SAMPLE_ROW = {
  id: "k1",
  prefix: SAMPLE_DB_PREFIX,
  hash: "salt:hash",
  userId: SAMPLE_USER.id,
  organizationId: "org1",
  agentId: null,
  revokedAt: null,
  expiresAt: null,
};

// ── Tests ───────────────────────────────────────────────

describe("authenticate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clean env for each test — we don't want stray API_KEY_* values leaking in.
    for (const k of Object.keys(process.env)) {
      if (k === "API_KEY" || k.startsWith("API_KEY_")) {
        delete process.env[k];
      }
    }
    dbMock.prisma.apiKey.update.mockResolvedValue({});
  });

  afterEach(() => {
    for (const k of Object.keys(process.env)) {
      if (k === "API_KEY" || k.startsWith("API_KEY_")) {
        delete process.env[k];
      }
    }
  });

  it("returns 401 when no Authorization header is present", async () => {
    const { authenticate, isAuthError } = await loadSubject();
    const res = await authenticate(makeReq() as never);
    expect(isAuthError(res)).toBe(true);
    expect((res as NextResponse).status).toBe(401);
  });

  it("returns 401 for a DB-prefix token with no matching row", async () => {
    dbMock.prisma.apiKey.findUnique.mockResolvedValueOnce(null);

    const { authenticate, isAuthError } = await loadSubject();
    const res = await authenticate(
      makeReq({ authorization: `Bearer ${SAMPLE_DB_TOKEN}` }) as never,
    );
    expect(isAuthError(res)).toBe(true);
    expect((res as NextResponse).status).toBe(401);
  });

  it("returns 401 for a matching prefix with wrong hash", async () => {
    dbMock.prisma.apiKey.findUnique.mockResolvedValueOnce(SAMPLE_ROW);
    apiKeyMock.verifyApiKey.mockReturnValueOnce(false);

    const { authenticate, isAuthError } = await loadSubject();
    const res = await authenticate(
      makeReq({ authorization: `Bearer ${SAMPLE_DB_TOKEN}` }) as never,
    );
    expect(isAuthError(res)).toBe(true);
    expect((res as NextResponse).status).toBe(401);
  });

  it("returns 401 for a matching prefix that has been revoked (no existence leak)", async () => {
    dbMock.prisma.apiKey.findUnique.mockResolvedValueOnce({
      ...SAMPLE_ROW,
      revokedAt: new Date("2024-01-01"),
    });

    const { authenticate, isAuthError } = await loadSubject();
    const res = await authenticate(
      makeReq({ authorization: `Bearer ${SAMPLE_DB_TOKEN}` }) as never,
    );
    expect(isAuthError(res)).toBe(true);
    expect((res as NextResponse).status).toBe(401);
    // Hash check never runs for a revoked key.
    expect(apiKeyMock.verifyApiKey).not.toHaveBeenCalled();
  });

  it("returns 401 for a matching prefix whose expiresAt is in the past", async () => {
    dbMock.prisma.apiKey.findUnique.mockResolvedValueOnce({
      ...SAMPLE_ROW,
      expiresAt: new Date(Date.now() - 1000),
    });

    const { authenticate, isAuthError } = await loadSubject();
    const res = await authenticate(
      makeReq({ authorization: `Bearer ${SAMPLE_DB_TOKEN}` }) as never,
    );
    expect(isAuthError(res)).toBe(true);
    expect((res as NextResponse).status).toBe(401);
    expect(apiKeyMock.verifyApiKey).not.toHaveBeenCalled();
  });

  it("returns AuthSuccess for a valid, non-revoked, non-expired DB key", async () => {
    dbMock.prisma.apiKey.findUnique.mockResolvedValueOnce(SAMPLE_ROW);
    apiKeyMock.verifyApiKey.mockReturnValueOnce(true);
    dbMock.prisma.user.findUnique.mockResolvedValueOnce(SAMPLE_USER);

    const { authenticate, isAuthError } = await loadSubject();
    const res = await authenticate(
      makeReq({ authorization: `Bearer ${SAMPLE_DB_TOKEN}` }) as never,
    );
    expect(isAuthError(res)).toBe(false);
    if (isAuthError(res)) return;
    expect(res.userId).toBe(SAMPLE_USER.id);
    expect(res.email).toBe(SAMPLE_USER.email);
    expect(res.apiKeyId).toBe(SAMPLE_ROW.id);
    expect(res.organizationId).toBe(SAMPLE_ROW.organizationId);
    expect(res.role).toBe("member");
  });

  describe("env-var fallback", () => {
    it("accepts a valid legacy token via API_KEY", async () => {
      const token = "legacy-env-token-123";
      process.env.API_KEY = token;

      const { authenticate, isAuthError } = await loadSubject();
      const res = await authenticate(
        makeReq({ authorization: `Bearer ${token}` }) as never,
      );
      expect(isAuthError(res)).toBe(false);
      if (isAuthError(res)) return;
      expect(res.identity).toBe("admin");
      expect(res.role).toBe("admin");
    });

    it("rejects a wrong-value legacy token", async () => {
      process.env.API_KEY = "expected-token";

      const { authenticate, isAuthError } = await loadSubject();
      const res = await authenticate(
        makeReq({ authorization: "Bearer not-the-expected-token" }) as never,
      );
      expect(isAuthError(res)).toBe(true);
      expect((res as NextResponse).status).toBe(401);
    });
  });
});
