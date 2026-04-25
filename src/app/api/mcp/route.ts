/**
 * Remote MCP endpoint — Streamable HTTP transport.
 *
 * Lets any MCP-capable host (Claude Desktop, Claude.ai, Cursor, OpenCode, …)
 * connect directly to this app using an `aju_live_*` bearer token. No local
 * binary required.
 *
 * Wire-up:
 *   POST /api/mcp  — JSON-RPC messages (initialize, tools/list, tools/call, …)
 *   GET  /api/mcp  — SSE stream for server-initiated notifications
 *   DELETE /api/mcp — terminate session
 *
 * Auth: same bearer scheme as the vault routes. We resolve the user up front,
 * then construct an McpServer with tool handlers bound to that user. Each
 * request gets a fresh server + transport pair (stateless mode) so we don't
 * have to plumb any session storage here — the MCP spec allows this and
 * Claude-family clients tolerate it.
 */
import { NextRequest, NextResponse } from "next/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authenticate, isAuthError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { childLogger } from "@/lib/logger";
import { registerAjuTools } from "@/lib/mcp/tools";
import { resolveBaseUrl } from "@/lib/auth/oauth/base-url";

export const runtime = "nodejs";
// Streaming transports should not be cached or pre-rendered.
export const dynamic = "force-dynamic";

/**
 * Build a request-scoped MCP server bound to the authenticated user.
 *
 * `organizationId` is required post-split — every tool handler needs it to
 * route to the correct tenant DB.
 */
function buildServer(authCtx: {
  userId?: string;
  agentId?: string;
  organizationId: string;
  identity: string;
  defaultBrain?: string;
}): McpServer {
  const server = new McpServer(
    {
      name: "aju",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
      instructions:
        "aju is the user's personal memory / knowledge base (brain, vault, notes, journal, archive). Use aju_search or aju_semantic_search to recall things; aju_read to open a specific document; aju_create / aju_update to save new knowledge; aju_browse to explore a section.",
    },
  );
  registerAjuTools(server, authCtx);
  return server;
}

/**
 * Handle a single MCP request. We build a fresh transport + server for each
 * call and let the WebStandardStreamableHTTPServerTransport convert the
 * incoming `Request` into a `Response` (streaming SSE when appropriate).
 *
 * The `?brain=<name>` query param lets a client pin every tool call in this
 * request scope to a particular brain when the tool itself doesn't pass one.
 */
/**
 * Per RFC 9728 §5.3 + MCP Authorization spec, a protected resource MUST
 * respond to unauthorized requests with a `WWW-Authenticate` header pointing
 * at its protected-resource metadata URL. Claude's Custom Connectors read
 * this header during the OAuth bootstrap to discover the authorization
 * server; without it, the "Connect" button fails with start_error.
 */
function withWwwAuthenticate(req: NextRequest, res: NextResponse): NextResponse {
  const base = resolveBaseUrl(req);
  const metadataUrl = `${base}/.well-known/oauth-protected-resource/api/mcp`;
  res.headers.set(
    "WWW-Authenticate",
    `Bearer resource_metadata="${metadataUrl}"`,
  );
  return res;
}

async function handle(req: NextRequest): Promise<Response> {
  const log = childLogger({ area: "mcp", method: req.method });
  const authHeader = req.headers.get("authorization");
  log.debug(
    {
      has_auth: !!authHeader,
      token_prefix: authHeader?.split(" ")[1]?.slice(0, 12),
      content_type: req.headers.get("content-type"),
      accept: req.headers.get("accept"),
    },
    "incoming mcp request",
  );
  const auth = await authenticate(req);
  if (isAuthError(auth)) {
    log.warn(
      { reason: "authenticate_error", status: auth.status },
      "mcp request rejected",
    );
    return withWwwAuthenticate(req, auth);
  }
  log.debug(
    {
      identity: auth.identity,
      user_id: auth.userId,
      organization_id: auth.organizationId,
    },
    "authenticated",
  );

  const defaultBrain =
    req.nextUrl.searchParams.get("brain") || undefined;

  // Resolve the organization whose tenant DB this request routes to. API-key
  // callers usually have a pinned org; un-pinned keys fall back to the user's
  // personal org (every user has one). No fallback means no tenant DB, so we
  // reject with 400.
  let organizationId = auth.organizationId ?? null;
  if (!organizationId && auth.userId) {
    const user = await prisma.user.findUnique({
      where: { id: auth.userId },
      select: { personalOrgId: true },
    });
    organizationId = user?.personalOrgId ?? null;
  }
  if (!organizationId) {
    return NextResponse.json(
      { error: "No organization context for this MCP request" },
      { status: 400 },
    );
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    // Stateless: no session id. Each request is self-contained.
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  const server = buildServer({
    userId: auth.userId,
    agentId: auth.agentId,
    organizationId,
    identity: auth.identity,
    defaultBrain,
  });

  await server.connect(transport);

  try {
    return await transport.handleRequest(req);
  } catch (err) {
    log.error(
      { err, user_id: auth.userId, organization_id: organizationId },
      "mcp transport error",
    );
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error",
          data: String(err instanceof Error ? err.message : err),
        },
        id: null,
      },
      { status: 500 },
    );
  } finally {
    // Clean up: transport handles its own lifecycle per request, but we should
    // close the server so any resource handles get released.
    server.close().catch(() => {
      /* best-effort */
    });
  }
}

export async function POST(req: NextRequest) {
  return handle(req);
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function DELETE(req: NextRequest) {
  return handle(req);
}
