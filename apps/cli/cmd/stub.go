package cmd

import "fmt"

// stubMsg is the placeholder printed by every unimplemented command.
const stubMsg = "not implemented yet — see aju.sh/docs"

func stub(_ []string) error {
	fmt.Println(stubMsg)
	return nil
}

// MCPServe previously launched a local stdio MCP bridge. The hosted app now
// exposes a remote MCP endpoint at https://mcp.aju.sh/mcp that any MCP-capable
// client (Claude Desktop, Claude.ai, Cursor, OpenCode, …) can connect to
// directly using an `aju_live_*` API key. That makes the local bridge
// redundant for the common case, so we point users at the docs instead of
// shipping a second transport.
func StubMCPServe(_ []string) error {
	fmt.Println("aju MCP runs as a remote HTTP endpoint:")
	fmt.Println()
	fmt.Println("  https://mcp.aju.sh/mcp")
	fmt.Println()
	fmt.Println("Add it to your MCP-capable client (Claude Desktop, Claude.ai,")
	fmt.Println("Cursor, OpenCode, …) using an API key from `aju keys list`.")
	fmt.Println()
	fmt.Println("Full setup snippets: https://aju.sh/docs/mcp")
	return nil
}
