# SDKs

Official client SDKs for the aju HTTP API, all generated from a single OpenAPI
spec so every language stays in lockstep.

```
client/openapi/
├── openapi.yaml                # source of truth — edit this
├── ts/                         # @tomskest/aju-sdk (npm)
├── py/                         # aju (PyPI)
├── go/                         # github.com/tomskest/aju/client/openapi/go
└── sh/generate.sh              # regenerate all three from the spec
```

## Workflow

1. Add or change an endpoint in `src/app/api/...`.
2. Update `client/openapi/openapi.yaml` to match.
3. Run `./client/openapi/sh/generate.sh` from the repo root.
4. Commit the spec change **and** the regenerated SDK source together — that
   keeps git history in step with the API surface.

## Why a single spec

Hand-writing three SDKs drifts immediately: a param gets renamed in TS, never
makes it to Python, and six months later an integrator hits a 400 they can't
explain. The spec is the contract; the SDKs are disposable.

## Generators

| SDK | Tool | Why |
|---|---|---|
| TypeScript | [`@hey-api/openapi-ts`](https://heyapi.dev/) | Modern, tree-shakeable, fetch-based, good types. |
| Python | [`openapi-python-client`](https://github.com/openapi-generators/openapi-python-client) | httpx + attrs; sync + async; idiomatic output. |
| Go | [`oapi-codegen`](https://github.com/oapi-codegen/oapi-codegen) | net/http-native, widely adopted, typed params/responses. |

All three are OSS and pinnable — no SaaS dependency on the codegen pipeline.

## Versioning

Each SDK is versioned independently (`package.json`, `pyproject.toml`,
`go.mod`), but the OpenAPI spec has its own `info.version`. Bump the spec
version when the API surface changes in a way clients care about; let SDKs
track that version until ergonomic changes diverge.
