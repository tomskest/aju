import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ─── HTTP Client ────────────────────────────────────────

const BASE_URL = process.env.MCP_BASE_URL;
const API_KEY = process.env.MCP_API_KEY;
const MCP_BRAIN = process.env.MCP_BRAIN; // optional: target a specific brain

if (!BASE_URL) throw new Error("MCP_BASE_URL is required");
if (!API_KEY) throw new Error("MCP_API_KEY is required");

async function fetchGet(
  path: string,
  params?: Record<string, string>
): Promise<string> {
  const url = new URL(`/api/vault/${path}`, BASE_URL);
  if (MCP_BRAIN) url.searchParams.set("brain", MCP_BRAIN);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") {
        url.searchParams.set(k, v);
      }
    }
  }

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
  } catch (err) {
    throw new Error(`Network error fetching ${path}: ${err}`);
  }

  const body = await res.text();

  if (!res.ok) {
    if (
      body.trimStart().startsWith("<!") ||
      body.trimStart().startsWith("<html")
    ) {
      throw new Error(
        `API returned HTML instead of JSON (status ${res.status}). The app may be down or returning an error page.`
      );
    }
    throw new Error(`API error ${res.status}: ${body}`);
  }

  try {
    const data = JSON.parse(body);
    return typeof data === "string" ? data : JSON.stringify(data, null, 2);
  } catch {
    throw new Error(
      `API returned non-JSON response (status ${res.status}): ${body.slice(0, 200)}`
    );
  }
}

async function fetchPost(
  path: string,
  payload: Record<string, unknown>
): Promise<string> {
  const url = new URL(`/api/vault/${path}`, BASE_URL);
  if (MCP_BRAIN) url.searchParams.set("brain", MCP_BRAIN);

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    throw new Error(`Network error posting ${path}: ${err}`);
  }

  const body = await res.text();

  if (!res.ok) {
    if (
      body.trimStart().startsWith("<!") ||
      body.trimStart().startsWith("<html")
    ) {
      throw new Error(
        `API returned HTML instead of JSON (status ${res.status}). The app may be down or returning an error page.`
      );
    }
    throw new Error(`API error ${res.status}: ${body}`);
  }

  try {
    const data = JSON.parse(body);
    return typeof data === "string" ? data : JSON.stringify(data, null, 2);
  } catch {
    throw new Error(
      `API returned non-JSON response (status ${res.status}): ${body.slice(0, 200)}`
    );
  }
}

async function fetchPostAbsolute(
  absolutePath: string,
  payload: Record<string, unknown>
): Promise<string> {
  const url = new URL(absolutePath, BASE_URL);
  if (MCP_BRAIN) url.searchParams.set("brain", MCP_BRAIN);

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    throw new Error(`Network error posting ${absolutePath}: ${err}`);
  }

  const body = await res.text();

  if (!res.ok) {
    if (
      body.trimStart().startsWith("<!") ||
      body.trimStart().startsWith("<html")
    ) {
      throw new Error(
        `API returned HTML instead of JSON (status ${res.status}). The app may be down or returning an error page.`
      );
    }
    throw new Error(`API error ${res.status}: ${body}`);
  }

  try {
    const data = JSON.parse(body);
    return typeof data === "string" ? data : JSON.stringify(data, null, 2);
  } catch {
    throw new Error(
      `API returned non-JSON response (status ${res.status}): ${body.slice(0, 200)}`
    );
  }
}


// ─── MCP Server ─────────────────────────────────────────

const server = new McpServer({
  name: "aju",
  version: "1.0.0",
});

// ─── Tool 1: vault-search ───────────────────────────────

server.tool(
  "vault-search",
  "Full-text search across the aju vault. Returns ranked results with snippets. Use this to find documents about specific topics, companies, strategies, etc.",
  {
    q: z.string().describe("Search query (supports natural language)"),
    section: z
      .string()
      .optional()
      .describe(
        "Filter by vault section (e.g. '06-Sales', '07-GTM-Strategy')"
      ),
    type: z
      .string()
      .optional()
      .describe("Filter by document type (e.g. 'company-profile')"),
    status: z
      .string()
      .optional()
      .describe("Filter by document status (e.g. 'sdr-ready')"),
    limit: z
      .number()
      .optional()
      .describe("Max results to return (default 20, max 100)"),
  },
  async ({ q, section, type, status, limit }) => {
    const params: Record<string, string> = { q };
    if (section) params.section = section;
    if (type) params.type = type;
    if (status) params.status = status;
    if (limit) params.limit = String(limit);
    const text = await fetchGet("search", params);
    return { content: [{ type: "text" as const, text }] };
  }
);

// ─── Tool 2: vault-read ─────────────────────────────────

server.tool(
  "vault-read",
  "Read the full content of a specific vault document by its path. Returns the complete markdown including frontmatter.",
  {
    path: z
      .string()
      .describe(
        "Relative vault path (e.g. '06-Sales/00-Sales-Dashboard.md')"
      ),
  },
  async ({ path }) => {
    const text = await fetchGet("document", { path });
    return { content: [{ type: "text" as const, text }] };
  }
);

// ─── Tool 3: vault-browse ───────────────────────────────

server.tool(
  "vault-browse",
  "List documents in a vault directory or section. Returns metadata without full content — use vault-read to get content.",
  {
    directory: z
      .string()
      .optional()
      .describe("Filter by directory path (e.g. '06-Sales/Prospects/All-Companies')"),
    section: z
      .string()
      .optional()
      .describe("Filter by top-level section (e.g. '06-Sales')"),
  },
  async ({ directory, section }) => {
    const params: Record<string, string> = {};
    if (directory) params.directory = directory;
    if (section) params.section = section;
    const text = await fetchGet("browse", params);
    return { content: [{ type: "text" as const, text }] };
  }
);

// ─── Tool 4: vault-update ───────────────────────────────

server.tool(
  "vault-update",
  "Update an existing vault document. Replaces the full content and re-parses frontmatter, tags, wikilinks, etc.",
  {
    path: z.string().describe("Path of the document to update"),
    content: z.string().describe("New full markdown content (including frontmatter)"),
  },
  async ({ path, content }) => {
    const text = await fetchPost("update", {
      path,
      content,
      source: "mcp",
    });
    return { content: [{ type: "text" as const, text }] };
  }
);

// ─── Tool 5: vault-create ───────────────────────────────

server.tool(
  "vault-create",
  "Create a new document in the vault. Provide the full path and markdown content.",
  {
    path: z
      .string()
      .describe("Vault path for the new document (e.g. '06-Sales/Prospects/All-Companies/New-Company.md')"),
    content: z.string().describe("Full markdown content (including frontmatter)"),
  },
  async ({ path, content }) => {
    const text = await fetchPost("create", {
      path,
      content,
      source: "mcp",
    });
    return { content: [{ type: "text" as const, text }] };
  }
);

// ─── Tool 6: vault-delete ───────────────────────────────

server.tool(
  "vault-delete",
  "Delete a document from the vault. The deletion is logged in the changelog.",
  {
    path: z.string().describe("Path of the document to delete"),
  },
  async ({ path }) => {
    const text = await fetchPost("delete", {
      path,
      source: "mcp",
    });
    return { content: [{ type: "text" as const, text }] };
  }
);

// ─── Tool 7: vault-upload-file ──────────────────────────

server.tool(
  "vault-upload-file",
  "Upload a file (PDF, image, etc.) to the aju vault. PDFs are automatically text-extracted for full-text search. Use base64-encoded content.",
  {
    filename: z.string().describe("Filename (e.g., 'annual-report-2025.pdf')"),
    base64Content: z.string().describe("Base64-encoded file content"),
    contentType: z
      .string()
      .describe("MIME type (e.g., 'application/pdf', 'image/png')"),
    category: z
      .string()
      .optional()
      .describe(
        "Optional category folder (e.g., 'annual-reports', 'delegate-lists')"
      ),
    tags: z
      .array(z.string())
      .optional()
      .describe("Optional tags for search and filtering"),
  },
  async ({ filename, base64Content, contentType, category, tags }) => {
    const payload: Record<string, unknown> = {
      filename,
      base64Content,
      contentType,
      source: "mcp",
    };
    if (category) payload.category = category;
    if (tags) payload.tags = tags;
    const text = await fetchPost("files/upload", payload);
    return { content: [{ type: "text" as const, text }] };
  }
);

// ─── Tool 8: vault-list-files ───────────────────────────

server.tool(
  "vault-list-files",
  "List files stored in the aju vault. Returns metadata (no content). Filter by category or MIME type.",
  {
    category: z
      .string()
      .optional()
      .describe("Filter by category (e.g., 'annual-reports')"),
    mimeType: z
      .string()
      .optional()
      .describe("Filter by MIME type (e.g., 'application/pdf')"),
  },
  async ({ category, mimeType }) => {
    const params: Record<string, string> = {};
    if (category) params.category = category;
    if (mimeType) params.mimeType = mimeType;
    const text = await fetchGet("files/list", params);
    return { content: [{ type: "text" as const, text }] };
  }
);

// ─── Tool 9: vault-read-file ────────────────────────────

server.tool(
  "vault-read-file",
  "Read a file from the aju vault. Mode: 'metadata' (default, includes extracted text), 'url' (presigned download URL), 'content' (base64 file content).",
  {
    key: z
      .string()
      .describe("S3 key of the file (from vault-list-files or vault-upload-file)"),
    mode: z
      .enum(["metadata", "url", "content"])
      .optional()
      .describe("Response mode: metadata (default), url, or content"),
  },
  async ({ key, mode }) => {
    const params: Record<string, string> = { key };
    if (mode) params.mode = mode;
    const text = await fetchGet("files/read", params);
    return { content: [{ type: "text" as const, text }] };
  }
);

// ─── Tool 10: vault-delete-file ─────────────────────────

server.tool(
  "vault-delete-file",
  "Delete a file from the aju vault. Removes from both S3 storage and database.",
  {
    key: z
      .string()
      .describe("S3 key of the file to delete"),
  },
  async ({ key }) => {
    const text = await fetchPost("files/delete", {
      key,
      source: "mcp",
    });
    return { content: [{ type: "text" as const, text }] };
  }
);

// ─── Tool 11: vault-backlinks ───────────────────────────

server.tool(
  "vault-backlinks",
  "Get all documents that link TO a given document (backlinks). Returns source documents with metadata.",
  {
    path: z
      .string()
      .describe("Vault path of the document to find backlinks for"),
  },
  async ({ path }) => {
    const text = await fetchGet("backlinks", { path });
    return { content: [{ type: "text" as const, text }] };
  }
);

// ─── Tool 14: vault-related ────────────────────────────

server.tool(
  "vault-related",
  "Get documents related to a given document via outgoing links, incoming links (backlinks), and shared tags. Deduplicates across all three sources.",
  {
    path: z
      .string()
      .describe("Vault path of the document to find related documents for"),
  },
  async ({ path }) => {
    const text = await fetchGet("related", { path });
    return { content: [{ type: "text" as const, text }] };
  }
);

// ─── Tool 15: vault-graph ──────────────────────────────

server.tool(
  "vault-graph",
  "Query the vault knowledge graph. mode='stats': total docs, links, orphans, top 20 most-linked. mode='neighbors': 2-hop ego-network around a document (requires path).",
  {
    mode: z
      .enum(["stats", "neighbors"])
      .describe("Graph query mode: 'stats' for overview, 'neighbors' for ego-network"),
    path: z
      .string()
      .optional()
      .describe("Vault path (required for mode='neighbors')"),
  },
  async ({ mode, path }) => {
    const params: Record<string, string> = { mode };
    if (path) params.path = path;
    const text = await fetchGet("graph", params);
    return { content: [{ type: "text" as const, text }] };
  }
);

// ─── Tool 16: vault-rebuild-links ───────────────────────

server.tool(
  "vault-rebuild-links",
  "Rebuild the document link graph from wikilinks stored in the database. Resolves all wikilinks to document-to-document relationships. Run after bulk document changes.",
  {},
  async () => {
    const text = await fetchPostAbsolute("/api/cron/rebuild-links", {});
    return { content: [{ type: "text" as const, text }] };
  }
);

// ─── Tool 17: vault-backfill-embeddings ─────────────────

server.tool(
  "vault-backfill-embeddings",
  "Generate vector embeddings for all vault documents and files that don't have them yet. Run this after bulk imports or to initialize embeddings for semantic search.",
  {},
  async () => {
    const text = await fetchPostAbsolute("/api/cron/backfill-embeddings", {});
    return { content: [{ type: "text" as const, text }] };
  }
);

// ─── Tool 18: vault-semantic-search ─────────────────────

server.tool(
  "vault-semantic-search",
  "Semantic search across the aju vault using AI embeddings. Finds conceptually related documents even when exact keywords don't match. Use mode='hybrid' (default) for best results combining keyword + semantic, or mode='vector' for pure semantic similarity.",
  {
    q: z.string().describe("Search query (natural language works best)"),
    section: z
      .string()
      .optional()
      .describe(
        "Filter by vault section (e.g. '06-Sales', '07-GTM-Strategy')"
      ),
    type: z
      .string()
      .optional()
      .describe("Filter by document type (e.g. 'company-profile')"),
    mode: z
      .enum(["hybrid", "vector"])
      .optional()
      .describe("Search mode: 'hybrid' (FTS + vector, default) or 'vector' (pure semantic)"),
    limit: z
      .number()
      .optional()
      .describe("Max results to return (default 20, max 100)"),
  },
  async ({ q, section, type, mode, limit }) => {
    const params: Record<string, string> = { q };
    if (section) params.section = section;
    if (type) params.type = type;
    if (mode) params.mode = mode;
    if (limit) params.limit = String(limit);
    const text = await fetchGet("semantic-search", params);
    return { content: [{ type: "text" as const, text }] };
  }
);

// ─── Tool 19: vault-deep-search ─────────────────────────

server.tool(
  "vault-deep-search",
  "GraphRAG deep search: hybrid (FTS + vector) seed retrieval followed by 1-hop (or 2-hop) graph expansion across document links, then re-ranked by a blend of relevance, graph proximity, and link-density. Best for multi-document questions where context is spread across linked notes (e.g. 'what do we know about X and how does it connect to Y'). Returns seeds plus graph neighbors, each tagged with source ('seed' or 'graph') and hop distance.",
  {
    q: z.string().describe("Search query (natural language works best)"),
    section: z
      .string()
      .optional()
      .describe(
        "Filter seed documents by vault section (e.g. '06-Sales', '07-GTM-Strategy')"
      ),
    type: z
      .string()
      .optional()
      .describe("Filter seed documents by document type (e.g. 'company-profile')"),
    seeds: z
      .number()
      .optional()
      .describe("Number of hybrid-search seed documents to expand from (default 5, max 20)"),
    limit: z
      .number()
      .optional()
      .describe("Max results to return after re-ranking (default 20, max 100)"),
    depth: z
      .number()
      .optional()
      .describe("Graph expansion depth: 1 (direct neighbors, default) or 2 (friends-of-friends)"),
  },
  async ({ q, section, type, seeds, limit, depth }) => {
    const params: Record<string, string> = { q };
    if (section) params.section = section;
    if (type) params.type = type;
    if (seeds !== undefined) params.seeds = String(seeds);
    if (limit !== undefined) params.limit = String(limit);
    if (depth !== undefined) params.depth = String(depth);
    const text = await fetchGet("deep-search", params);
    return { content: [{ type: "text" as const, text }] };
  }
);

// ─── Start ──────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("MCP server error:", err);
  process.exit(1);
});
