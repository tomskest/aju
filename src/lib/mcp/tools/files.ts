/**
 * File-oriented MCP tools (files_list / files_read / files_upload /
 * files_delete).
 *
 * The streamable-HTTP MCP server does not currently expose any `aju_files_*`
 * tools — file handling today goes through the `mcp/aju-server.ts` stdio
 * wrapper, which hits the `/api/vault/files/*` HTTP endpoints. This module is
 * the landing pad for when we port those tools over so the split mirrors the
 * intended domain layout from day one.
 *
 * Keep the `registerFilesTools(server, ctx)` signature stable; adding a new
 * file tool should be a single `server.tool(...)` call here, nothing in the
 * top-level `tools.ts` index needs to change.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpToolContext } from "./shared";

export function registerFilesTools(
  _server: McpServer,
  _ctx: McpToolContext,
): void {
  // Intentionally empty — no file tools registered on this transport yet.
}
