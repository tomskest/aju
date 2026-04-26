---
title: Agent surface — MCP, CLI, and the Claude Code skill
description: How agents talk to aju — the remote MCP endpoint, the Go CLI, the Claude Code skill, and when to fall back to stdio.
order: 10
---

# Agent surface — MCP, CLI, and the Claude Code skill

aju exists to be the memory layer of an AI agent. Everything in this section
describes the three surfaces an agent actually touches:

1. **Remote MCP endpoint** at `https://mcp.aju.sh/mcp` (internally
   `POST /api/mcp`). Any MCP-capable host speaks Streamable HTTP to this URL
   with a bearer token. The token picks the organization — each `aju_live_*`
   key is pinned to exactly one org, and every request routes to that org's
   tenant database.
2. **Go CLI** (`aju`) installed at `~/bin/aju` on an operator's machine. The
   CLI is a thin HTTP client over the same REST surface (`/api/vault/*`,
   `/api/brains`, `/api/me/export`, …) plus a device-code login flow. A
   **profiles** system in `~/.aju/config.json` lets one machine hold multiple
   (user, org) pairs and flip between them with `aju profiles use <name>` or
   per-invocation `-p <name>` / `--profile <name>` / `AJU_PROFILE`.
3. **Claude Code skill** — a single `SKILL.md` the CLI drops into
   `~/.claude/skills/aju/` via `aju skill install claude`. The skill teaches
   Claude Code to shell out to the `aju` CLI for memory operations, which
   dodges MCP config entirely.

## Two paths, one tool catalog

There are two ways an LLM reaches into an aju brain:

| Path | How it gets in | Who it's for |
|---|---|---|
| **Remote MCP** | `POST https://mcp.aju.sh/mcp` with a `Bearer aju_live_*` token | Any MCP client — Claude Desktop, Claude.ai, Cursor, OpenCode, a custom agent |
| **CLI via skill** | `aju` subprocess invoked from a shell tool | Claude Code, terminal operators, scripts |

Both paths ultimately execute the same queries against the same per-tenant
Postgres database (the one belonging to the authenticating key's pinned
org). The MCP tool names are deliberately chosen to avoid collisions with
the CLI namespace: tools are `aju_search`, `aju_read`, etc., while the CLI
commands are `aju search`, `aju read`, etc. The intent is the same; the
transport differs.

### One key = one org

Each `aju_live_*` API key stores an `organizationId` at creation time
(`ApiKey.organizationId` in the control DB). The server uses that field to
pick a tenant database via `tenantDbFor(orgId)` on every request — there
is no cross-org fallback path. Multi-org operators hold one key per org
and flip between them (different bearer tokens on the MCP side; different
CLI profiles on the shell side).

### Why two paths?

- **MCP** is the right answer when the LLM host has native tool-calling
  plumbing (Claude Desktop, Claude.ai). No local install, works from
  anywhere, the server enforces auth and brain scoping.
- **The CLI + skill** covers the case where the host is already a shell
  (Claude Code, a terminal session). Shelling out is cheaper, the CLI
  formats results for human eyes as well as agent eyes, and it works when
  the machine is offline for MCP setup but has already logged in.

A third option — local stdio via `aju mcp serve` — existed, but has been
retired as redundant with the remote endpoint. See [stdio-bridge.md](./stdio-bridge.md)
for what's left of it.

## What's in this section

1. [mcp-endpoint.md](./mcp-endpoint.md) — The remote `/api/mcp` route:
   transport, auth, `?brain=<name>` scoping, error shapes.
2. [mcp-tools.md](./mcp-tools.md) — Every registered MCP tool, its
   parameters, its Prisma queries, and what it returns.
3. [cli.md](./cli.md) — The Go CLI: layout, command dispatch, device
   login, config file, and the note-oriented commands.
4. [remote-agent-provisioning.md](./remote-agent-provisioning.md) — How
   `aju agent-provision` puts an agent-scoped key on a separate machine
   (OpenClaw, Aider, CI runners) without transporting plaintext.
5. [claude-code-skill.md](./claude-code-skill.md) — What `aju skill install claude`
   writes, where, and how the templated description is generated.
6. [clients.md](./clients.md) — Per-host config JSON shapes — Claude
   Desktop vs Claude.ai vs Cursor vs OpenCode — and why each differs.
7. [stdio-bridge.md](./stdio-bridge.md) — The retired stdio transport in
   `client/mcp/aju-server.ts`, what it did, and the one-in-a-million case
   it's still useful for.
8. [sdks.md](./sdks.md) — TypeScript, Python, Go, and shell clients
   auto-generated from the OpenAPI spec. **Preview / in progress** —
   none of them are published to a registry yet.

## Reading order

Read `mcp-endpoint.md` and `mcp-tools.md` in sequence if you care about the
remote integration. Read `cli.md` and `claude-code-skill.md` in sequence if
you care about the local integration. `clients.md` and `stdio-bridge.md` are
reference material for specific host setups — skim on demand.
