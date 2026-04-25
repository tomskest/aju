/**
 * Smoke test for one aju MCP tool handler — aju_browse.
 *
 * Strategy: don't boot a real McpServer. Stub `server.tool(name, desc, schema,
 * handler)` with a capture so we can pull out the registered handler and call
 * it directly. Mock @/lib/tenant.withTenant so the handler runs against
 * a fake transaction object. Access-resolution inside the handler is tested
 * end-to-end because we wire the brainAccess fake to return what the handler
 * expects.
 *
 * Assertions:
 *   1. Valid params + granted brain → text result with matching doc list.
 *   2. Unknown brain name → handler returns an errorResult (isError: true),
 *      not a thrown exception.
 *   3. Non-string `directory` param → zod schema rejects it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

// ── Mocks ───────────────────────────────────────────────

const tenantContextMock = vi.hoisted(() => ({
  withTenant: vi.fn(),
}));

vi.mock("@/lib/tenant", () => tenantContextMock);

// The handler imports these but aju_browse never reaches them. Mock with
// harmless stubs so module init doesn't pull in the real network / DB code.
vi.mock("@/lib/embeddings", () => ({
  generateEmbedding: vi.fn(),
  toVectorLiteral: vi.fn(),
}));
vi.mock("@/lib/vault", () => ({
  parseDocument: vi.fn(),
}));
vi.mock("@/lib/vault", () => ({
  rebuildLinks: vi.fn(),
  scheduleRebuildLinks: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/lib/embeddings", () => ({
  updateDocumentEmbedding: vi.fn(),
}));

// ── Helpers ─────────────────────────────────────────────

type ToolRecord = {
  name: string;
  description: string;
  schema: Record<string, z.ZodTypeAny>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
};

function fakeServer(): {
  server: { tool: ReturnType<typeof vi.fn> };
  tools: Map<string, ToolRecord>;
} {
  const tools = new Map<string, ToolRecord>();
  const tool = vi.fn((...args: unknown[]) => {
    // The codebase uses the four-arg form: (name, description, schema, handler).
    const [name, description, schema, handler] = args as [
      string,
      string,
      Record<string, z.ZodTypeAny>,
      (a: Record<string, unknown>) => Promise<unknown>,
    ];
    tools.set(name, { name, description, schema, handler });
  });
  return { server: { tool }, tools };
}

async function callTool(
  tool: ToolRecord,
  rawArgs: Record<string, unknown>,
): Promise<unknown> {
  // Emulate the SDK's input validation: zod parse first, then call handler.
  const obj = z.object(tool.schema);
  const parsed = obj.parse(rawArgs);
  return tool.handler(parsed);
}

// ── Tests ───────────────────────────────────────────────

describe("registerAjuTools → aju_browse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("valid params list the brain's documents", async () => {
    const docs = [
      {
        path: "journal/2026-04-16.md",
        title: "Standup notes",
        section: "journal",
        directory: "journal",
        docType: "note",
        docStatus: "draft",
        tags: [],
        wordCount: 42,
        updatedAt: new Date("2026-04-16T10:00:00Z"),
      },
    ];

    const fakeTx = {
      brainAccess: {
        findFirst: vi.fn().mockResolvedValue({
          brain: { id: "b1", name: "Personal", type: "personal" },
          role: "owner",
        }),
      },
      vaultDocument: {
        findMany: vi.fn().mockResolvedValue(docs),
      },
    };

    tenantContextMock.withTenant.mockImplementationOnce(
      async (
        _params: unknown,
        fn: (ctx: {
          tenant: unknown;
          tx: typeof fakeTx;
          brainIds: readonly string[];
        }) => Promise<unknown>,
      ) => fn({ tenant: {}, tx: fakeTx, brainIds: ["b1"] }),
    );

    const { server, tools } = fakeServer();
    const { registerAjuTools } = await import("../tools");
    registerAjuTools(server as never, {
      organizationId: "org1",
      userId: "u1",
      identity: "u@example.com",
    });

    const browse = tools.get("aju_browse");
    expect(browse).toBeDefined();

    const result = (await callTool(browse!, {
      directory: "journal",
      brain: "Personal",
    })) as {
      content: Array<{ type: "text"; text: string }>;
      isError?: boolean;
    };

    expect(result.isError).toBeFalsy();
    expect(result.content[0].type).toBe("text");
    const payload = JSON.parse(result.content[0].text) as {
      brain: string;
      directory: string | null;
      count: number;
      documents: Array<{ path: string }>;
    };
    expect(payload.brain).toBe("Personal");
    expect(payload.directory).toBe("journal");
    expect(payload.count).toBe(1);
    expect(payload.documents[0].path).toBe("journal/2026-04-16.md");

    expect(fakeTx.vaultDocument.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ brainId: "b1", directory: "journal" }),
      }),
    );
  });

  it("returns a friendly error (not a throw) when the brain isn't found", async () => {
    const fakeTx = {
      brainAccess: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      vaultDocument: { findMany: vi.fn() },
    };

    tenantContextMock.withTenant.mockImplementationOnce(
      async (
        _params: unknown,
        fn: (ctx: {
          tenant: unknown;
          tx: typeof fakeTx;
          brainIds: readonly string[];
        }) => Promise<unknown>,
      ) => fn({ tenant: {}, tx: fakeTx, brainIds: [] }),
    );

    const { server, tools } = fakeServer();
    const { registerAjuTools } = await import("../tools");
    registerAjuTools(server as never, {
      organizationId: "org1",
      userId: "u1",
      identity: "u@example.com",
    });

    const browse = tools.get("aju_browse")!;
    const result = (await callTool(browse, { brain: "NopeNonexistent" })) as {
      content: Array<{ type: "text"; text: string }>;
      isError?: boolean;
    };
    expect(result.isError).toBe(true);
    const body = JSON.parse(result.content[0].text) as { error: string };
    expect(body.error.toLowerCase()).toMatch(/not found|access denied/);
    expect(fakeTx.vaultDocument.findMany).not.toHaveBeenCalled();
  });

  it("zod rejects when a required param shape is violated", async () => {
    // aju_browse params are all optional, so exercise aju_read — its `path`
    // is required — to prove the zod validation wired into callTool fires.
    const { server, tools } = fakeServer();
    const { registerAjuTools } = await import("../tools");
    registerAjuTools(server as never, {
      organizationId: "org1",
      userId: "u1",
      identity: "u@example.com",
    });

    const read = tools.get("aju_read");
    expect(read).toBeDefined();

    await expect(callTool(read!, {})).rejects.toThrow();
  });
});
