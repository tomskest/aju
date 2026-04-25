---
title: Per-client MCP config
description: Config JSON shapes for Claude Desktop, Claude.ai, Cursor, and OpenCode, and why each client wants something different.
order: 60
---

# Per-client MCP config

Every supported client points at the same endpoint:

```
https://mcp.aju.sh/mcp
```

…with the same auth scheme: `Authorization: Bearer aju_live_<your key>`.
What differs is the shape of the config JSON each client expects. The
canonical snippets live in `src/app/docs/mcp/page.tsx:3-51`; this page
explains the shape differences and the reason each host diverges.

Override the URL with `NEXT_PUBLIC_MCP_URL` when running the hosted app
against local or staging environments — the path is the same, only the
origin changes.

### One URL, many orgs

The URL is static. The **organization** a given connection operates
against is picked by which API key you authenticate with: every
`aju_live_*` key is pinned to a single org via `ApiKey.organizationId`
(control DB), and each request is routed to that org's tenant database
on arrival. To connect to a different org, register a second MCP server
entry in your client config — same URL, different bearer token. Clients
that can hold multiple MCP servers (Claude Desktop, Cursor, …) can
surface both orgs side-by-side.

Mint a key first: `aju keys create <name> --org <slug>` (CLI) or the
keys dashboard at `/app/keys`. The `--org` flag is required when your
user belongs to more than one org; `aju keys create` defaults to the
active org if you only have one membership.

## Claude Desktop

Config path:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

Snippet (`src/app/docs/mcp/page.tsx:3-12`):

```json
{
  "mcpServers": {
    "aju": {
      "url": "https://mcp.aju.sh/mcp",
      "headers": {
        "Authorization": "Bearer aju_live_<your key>"
      }
    }
  }
}
```

Restart Claude Desktop after saving. Test by asking "list my brains" — the
client should surface an `aju_brains_list` tool call.

**Shape notes:** Claude Desktop uses a top-level `mcpServers` object keyed
by server name. Each entry is either a URL-based remote server (as above)
or a command-based local server (`command` + `args`). The `headers` field
is where bearer tokens go.

## Claude.ai (web)

Settings → Integrations → Add custom integration. Snippet
(`src/app/docs/mcp/page.tsx:14-19`):

```json
{
  "type": "url",
  "url": "https://mcp.aju.sh/mcp",
  "name": "aju",
  "authorization_token": "aju_live_<your key>"
}
```

**Shape notes:** Claude.ai's integration payload is flat, not nested under
`mcpServers`. It uses `authorization_token` as a dedicated field rather
than an arbitrary `headers` map. The `type: "url"` discriminator
distinguishes remote integrations from the other integration types
Claude.ai supports (search engines, GDrive, …).

Why different: Claude.ai is a hosted product with a fixed integration
surface managed through UI. The field names come from the hosted
integration schema, not from an open MCP config file.

## Cursor

Config path: `~/.cursor/mcp.json`. Newer versions also expose an in-app MCP
panel — either works.

Snippet (`src/app/docs/mcp/page.tsx:32-41`):

```json
{
  "mcpServers": {
    "aju": {
      "url": "https://mcp.aju.sh/mcp",
      "headers": {
        "Authorization": "Bearer aju_live_<your key>"
      }
    }
  }
}
```

**Shape notes:** Identical to Claude Desktop. Cursor adopted the Claude
Desktop schema verbatim for remote MCP servers. No restart needed — Cursor
rescans the file when the MCP panel opens.

## OpenCode

Config path: `~/.config/opencode/config.json` (path varies by version).

Snippet (`src/app/docs/mcp/page.tsx:21-30`):

```json
{
  "mcp": {
    "aju": {
      "url": "https://mcp.aju.sh/mcp",
      "headers": {
        "Authorization": "Bearer aju_live_<your key>"
      }
    }
  }
}
```

**Shape notes:** Top-level key is `mcp` (not `mcpServers`). The entry
body matches Claude Desktop. Still a URL + headers, still bearer auth.

Why different: OpenCode's config is a full application config, with `mcp`
being one subsection among many (`provider`, `autoshare`, …). The
singular key avoids implying that MCP is the whole config.

## Summary of shape differences

| Client | Wrapper | Server keying | Auth field |
|---|---|---|---|
| Claude Desktop | `mcpServers` | object | `headers.Authorization` |
| Claude.ai | (root) | flat | `authorization_token` |
| Cursor | `mcpServers` | object | `headers.Authorization` |
| OpenCode | `mcp` | object | `headers.Authorization` |

Three of four clients converge on the same shape; Claude.ai is the
outlier because it's a hosted web product with its own UI-driven
integration schema.

## Multi-org configuration

Because each API key is pinned to one org, talking to multiple orgs from
one client just means listing multiple entries. Example for Claude
Desktop with both a personal and a work org:

```json
{
  "mcpServers": {
    "aju-personal": {
      "url": "https://mcp.aju.sh/mcp",
      "headers": {
        "Authorization": "Bearer aju_live_<personal-key>"
      }
    },
    "aju-work": {
      "url": "https://mcp.aju.sh/mcp",
      "headers": {
        "Authorization": "Bearer aju_live_<work-key>"
      }
    }
  }
}
```

The tools show up in Claude Desktop as `aju-personal__aju_search`,
`aju-work__aju_search`, etc. — prefixed with the server name so the LLM
can pick the right org explicitly. Inside each connection, the brains
the user sees are only those in that key's org; there's no cross-org
brain fan-out in a single call.

Cursor (same shape as Claude Desktop) and OpenCode (`mcp` wrapper) handle
multiple entries the same way. Claude.ai lets you add multiple custom
integrations through its Settings → Integrations UI; each becomes its
own listed connector.

## Optional `?brain=` scoping

Any client that lets you set a URL can pin the connection to a specific
brain **within the key's org**:

```json
{ "url": "https://mcp.aju.sh/mcp?brain=work", … }
```

Tools called over that connection default to the `work` brain if the tool
itself doesn't pass one. See the endpoint description at
[mcp-endpoint.md](./mcp-endpoint.md#brain-scoping-brainname) for the
resolution order. Without `?brain=`, the server falls back to the user's
first personal brain in that org's tenant DB.

Brain names resolve inside the single tenant DB picked by the bearer
token's org — they're not global. A brain called `work` in one org is a
different entity from a brain called `work` in another org.

## Troubleshooting

- **401 Unauthorized** — The bearer token is wrong, revoked, or expired.
  List your keys with `aju keys list` or the dashboard. Mint a new one with
  `aju keys create <name>`.
- **"No brain configured for this user"** — The account has zero brains.
  Create one at the dashboard or run `aju brains create <name>`.
- **Tools not showing up in the client** — The client didn't pick up the
  new config. Most clients re-read the file on startup; Claude Desktop
  needs a full restart, Cursor reopens the MCP panel, Claude.ai refreshes
  on the Integrations page.
- **"Brain not found or access denied"** — You passed a brain name (via
  `?brain=` or a tool call argument) that you don't have access to. Check
  `aju_brains_list` for the canonical names.

## Heads up

The public page closes with a disclaimer worth repeating
(`src/app/docs/mcp/page.tsx:215-225`):

> Client config shapes drift between versions. If a snippet above doesn't
> work, check your client's current docs and match the field names to
> theirs — the URL and bearer token stay the same.

The wire protocol (Streamable HTTP + bearer auth) is stable. The JSON
wrapper shape around it isn't, and updating docs on release cadence is
more fragile than reminding readers to check their client's current
reference.
