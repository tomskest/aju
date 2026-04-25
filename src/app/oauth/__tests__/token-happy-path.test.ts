/**
 * Happy-path test for POST /oauth/token with grant_type=authorization_code.
 *
 * We mount the route handler directly, mock the control Prisma client, and
 * supply a fully-formed PKCE S256 pair so that the real verifyPkceS256 helper
 * passes against our fake stored codeChallenge.
 *
 * What this pins down:
 *   - status 200 on a well-formed code exchange
 *   - response body shape (access_token, refresh_token, token_type, etc.)
 *   - authorization code is atomically consumed
 *   - a new ApiKey row is minted with source="oauth"
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

// ── Mocks ───────────────────────────────────────────────

const dbMock = vi.hoisted(() => ({
  prisma: {
    oAuthClient: {
      findUnique: vi.fn(),
    },
    oAuthAuthorizationCode: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    apiKey: {
      create: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => dbMock);

// ── Test data ───────────────────────────────────────────

// Valid PKCE pair. challenge = BASE64URL(SHA256(verifier)).
const CODE_VERIFIER = "a".repeat(64);
const CODE_CHALLENGE = createHash("sha256")
  .update(CODE_VERIFIER)
  .digest("base64url");

const AUTH_CODE = "auth-code-xyz";
const AUTH_CODE_HASH = createHash("sha256").update(AUTH_CODE).digest("hex");

const CLIENT_ID_DB = "client_db_id";
const CLIENT_ID_PUBLIC = "my-public-client";
const REDIRECT_URI = "http://localhost:9000/callback";

function buildRequest(body: Record<string, string>): {
  headers: { get(name: string): string | null };
  text(): Promise<string>;
} {
  const form = new URLSearchParams(body).toString();
  return {
    headers: {
      get(name: string): string | null {
        if (name.toLowerCase() === "content-type") {
          return "application/x-www-form-urlencoded";
        }
        return null;
      },
    },
    async text() {
      return form;
    },
  };
}

// ── Tests ───────────────────────────────────────────────

describe("POST /oauth/token — authorization_code happy path", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    dbMock.prisma.oAuthClient.findUnique.mockResolvedValue({
      id: CLIENT_ID_DB,
      clientId: CLIENT_ID_PUBLIC,
      clientName: "Test Client",
      // Public client — no secret required; matches how CLI / Claude Desktop
      // register themselves against the OAuth 2.1 server.
      tokenEndpointAuthMethod: "none",
      clientSecretHash: null,
      grantTypes: ["authorization_code", "refresh_token"],
    });

    dbMock.prisma.oAuthAuthorizationCode.findUnique.mockResolvedValue({
      id: "code-row-id",
      codeHash: AUTH_CODE_HASH,
      clientId: CLIENT_ID_DB,
      userId: "u1",
      organizationId: "org1",
      redirectUri: REDIRECT_URI,
      scope: "read write",
      resource: null,
      codeChallenge: CODE_CHALLENGE,
      codeChallengeMethod: "S256",
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      consumedAt: null,
      createdAt: new Date(),
    });

    dbMock.prisma.oAuthAuthorizationCode.updateMany.mockResolvedValue({
      count: 1,
    });

    dbMock.prisma.apiKey.create.mockResolvedValue({ id: "new-key" });
  });

  it("returns 200 with a well-formed token payload and consumes the code", async () => {
    const { POST } = await import("@/app/oauth/token/route");

    const req = buildRequest({
      grant_type: "authorization_code",
      code: AUTH_CODE,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID_PUBLIC,
      code_verifier: CODE_VERIFIER,
    });

    const res = await POST(req as never);

    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      access_token: string;
      refresh_token: string;
      token_type: string;
      expires_in: number;
      scope: string;
    };
    expect(body.token_type).toBe("bearer");
    expect(typeof body.access_token).toBe("string");
    expect(body.access_token.length).toBeGreaterThan(10);
    expect(typeof body.refresh_token).toBe("string");
    expect(body.refresh_token.startsWith("aju_refresh_")).toBe(true);
    expect(typeof body.expires_in).toBe("number");
    expect(body.expires_in).toBeGreaterThan(0);
    expect(body.scope).toBe("read write");

    // Code was atomically consumed.
    expect(dbMock.prisma.oAuthAuthorizationCode.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "code-row-id",
          consumedAt: null,
        }),
        data: expect.objectContaining({ consumedAt: expect.any(Date) }),
      }),
    );

    // A new ApiKey row was minted with source="oauth".
    expect(dbMock.prisma.apiKey.create).toHaveBeenCalledTimes(1);
    const createArg = dbMock.prisma.apiKey.create.mock.calls[0][0];
    expect(createArg.data.source).toBe("oauth");
    expect(createArg.data.userId).toBe("u1");
    expect(createArg.data.organizationId).toBe("org1");
    expect(createArg.data.oauthClientId).toBe(CLIENT_ID_DB);
    expect(typeof createArg.data.prefix).toBe("string");
    expect(typeof createArg.data.hash).toBe("string");
    expect(typeof createArg.data.refreshTokenPrefix).toBe("string");
    expect(typeof createArg.data.refreshTokenHash).toBe("string");
  });
});
