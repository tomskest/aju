---
title: SDKs (preview)
description: TypeScript, Python, Go, and shell clients auto-generated from the OpenAPI spec. Currently in preview — not yet published.
order: 80
---

# SDKs (preview)

> **Status: in progress.** The SDKs are generated and live in source at
> `client/openapi/{ts,py,go,sh}/`, but **none of them are published yet** —
> no npm release, no PyPI release, no Go module tag. Treat them as preview
> code: the OpenAPI surface is still settling, generated outputs may
> change shape between commits, and the publish workflow at
> `.github/workflows/sdks-release.yml` is wired but unused. For
> production today, use the [HTTP API](../01-overview/request-lifecycle.md)
> directly or the [remote MCP endpoint](./mcp-endpoint.md).

aju ships official client SDKs for three languages, all generated from a
single OpenAPI spec so every language stays in lockstep with the wire
format. A POSIX shell generator script regenerates all three from the spec.

## Layout

```
client/openapi/
├── openapi.yaml                # source of truth — edit this
├── ts/                         # TypeScript SDK (intended for npm)
├── py/                         # Python SDK (intended for PyPI)
├── go/                         # Go SDK (intended for `go get`)
└── sh/generate.sh              # regenerate all three from the spec
```

`README.md` and `PUBLISHING.md` at `client/openapi/` document the
generator pipeline and the (unrun) release workflow respectively.

## Generators

| SDK | Tool | Why |
|---|---|---|
| TypeScript | [`@hey-api/openapi-ts`](https://heyapi.dev/) | Modern, tree-shakeable, fetch-based, good types. |
| Python | [`openapi-python-client`](https://github.com/openapi-generators/openapi-python-client) | httpx + attrs; sync + async; idiomatic output. |
| Go | [`oapi-codegen`](https://github.com/oapi-codegen/oapi-codegen) | net/http-native, widely adopted, typed params/responses. |

All three are open source and pinned — no SaaS dependency on the codegen
pipeline.

## Why a single OpenAPI spec

Hand-writing three SDKs drifts immediately: a param gets renamed in TS,
never makes it to Python, and six months later an integrator hits a 400
they can't explain. The spec is the contract; the SDKs are disposable —
regenerate from the spec when the API surface changes, commit the spec
change and the regenerated outputs together so git history stays in step.

## What "in progress" means concretely

The SDK code compiles and exposes the current vault, brain, agents, and
keys endpoints, but:

- **Not on registries.** No `@aju/sdk` on npm, no `aju` on PyPI, no
  tagged Go module yet. The first publish is the `sdks-v0.1.0` tag; the
  release workflow handles npm + PyPI + Go in one run.
- **Spec coverage is incomplete.** The spec covers the most-used endpoints
  but not every route the HTTP API exposes. Anything missing from the
  spec is missing from all three SDKs.
- **Shapes may change.** Until the first published release, breaking
  changes to method names, types, and parameter shapes can land without a
  major-version bump.
- **No public stability promise.** Treat any SDK use as you would code
  vendored from `main` — pin to a commit, expect to re-generate on
  upgrade.

## Recommended path until v0.1.0 ships

1. **Hit the HTTP API directly** with whatever client your language has
   (`fetch`, `httpx`, `net/http`, `curl`). Auth is `Authorization: Bearer
   aju_live_<key>`. The endpoint list lives in
   [request-lifecycle.md](../01-overview/request-lifecycle.md) and
   [deployment-layout.md](../01-overview/deployment-layout.md).
2. **Use the remote MCP endpoint** at `https://mcp.aju.sh/mcp` if your
   client is an MCP-capable host (Claude Desktop, Cursor, OpenCode,
   Claude.ai). Same bearer auth; per-host config in [clients.md](./clients.md).
3. **Use the Go CLI** for terminal and shell-script use cases — it's
   already a thin HTTP client over the same surface and is the supported
   path until SDK v0.1.0 ships. See [cli.md](./cli.md).

When the SDKs ship, this page will pivot to install snippets and per-language
quickstart examples. Track the `sdks-v*` tag in the GitHub repo for
publish events.

## For maintainers

`client/openapi/PUBLISHING.md` covers the npm / PyPI / Go release path
end-to-end, including first-time secrets setup (npm token, PyPI trusted
publisher), version-bump rules, and the dry-run dispatch workflow. Don't
push an `sdks-v*` tag until both `client/openapi/ts/package.json` and
`client/openapi/py/pyproject.toml` declare the same semver — the workflow
fails fast on mismatch.
