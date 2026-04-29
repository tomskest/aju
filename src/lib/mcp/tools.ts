/**
 * aju MCP tools — registration entry point.
 *
 * Public API: `registerAjuTools(server, ctx)`. Keeps `McpToolContext` re-
 * exported for callers (the HTTP route) that need to type the context they
 * pass in. All actual `server.tool(...)` calls live in the per-domain modules
 * under `./tools/*` so this file stays small and the domains can evolve
 * independently.
 *
 * Tool naming: `aju_<verb>` so that the LLM on the other side doesn't confuse
 * these with any other "search" / "read" tools on a host with multiple MCP
 * servers attached.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerFilesTools } from "./tools/files";
import { registerSearchTools } from "./tools/search";
import { registerVaultTools } from "./tools/vault";
import { registerValidationTools } from "./tools/validation";
import type { McpToolContext } from "./tools/shared";

export type { McpToolContext };

/**
 * Registers the full aju tool surface against an McpServer instance.
 * Descriptions lean on common memory/recall keywords so LLM hosts route to
 * the right tool without extra priming.
 */
export function registerAjuTools(server: McpServer, ctx: McpToolContext): void {
  registerSearchTools(server, ctx);
  registerVaultTools(server, ctx);
  registerFilesTools(server, ctx);
  registerValidationTools(server, ctx);
}

/** Tool count — exported for diagnostics / logs. */
export const AJU_TOOL_COUNT = 15;
