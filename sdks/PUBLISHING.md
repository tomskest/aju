# Publishing the SDKs

All three SDKs release together from a single tag. The workflow at
`.github/workflows/sdks-release.yml` handles npm, PyPI, and the Go tag in
one run so the three languages stay in lockstep.

## Tag format

```
sdks-v<semver>
```

Example: `sdks-v0.1.0`. The workflow extracts the semver portion and uses
it for every channel:

- npm → `@aju/sdk@0.1.0`
- PyPI → `aju==0.1.0`
- Go → `sdks/go/v0.1.0` (auto-pushed by the workflow)

The workflow verifies that `sdks/typescript/package.json` and
`sdks/python/pyproject.toml` both declare the same version as the tag.
Mismatch → release fails before anything is published.

## First-time setup

### 1. npm — `NPM_TOKEN` secret

1. Sign in to npmjs.com with the aju publisher account.
2. `Account → Access Tokens → Generate New Token → Automation`.
3. Scope the token to the `@aju` scope (once you own it) or to the
   personal scope you're publishing under.
4. GitHub repo → `Settings → Secrets and variables → Actions → New repository secret`.
   - Name: `NPM_TOKEN`
   - Value: paste the token.

If `@aju` is taken on npm, change `name` in `sdks/typescript/package.json`
to a scope you own (`@tomskest/aju-sdk` is the obvious fallback) and
update the docs in `sdks/typescript/README.md`, `src/app/docs/sdks/`,
and `src/components/landing/SdksSection.tsx` to match.

### 2. PyPI — trusted publishing (no token)

Trusted publishing uses GitHub OIDC instead of a long-lived API token. It's
the recommended modern setup.

1. Publish once manually to claim the `aju` project name on PyPI (or
   change the package name to `aju-sdk` if taken). Alternatively, register
   a "pending publisher" before the first release so the name is claimed
   automatically on first CI publish.
2. On pypi.org, project `aju` → `Publishing → Add a new pending publisher`:
   - Owner: `tomskest`
   - Repository name: `aju`
   - Workflow name: `sdks-release.yml`
   - Environment name: `pypi`
3. GitHub repo → `Settings → Environments → New environment` → name
   `pypi`. (No secrets needed, the workflow authenticates via OIDC.)

If you'd rather use an API token: replace the `pypa/gh-action-pypi-publish`
step's auth with `password: ${{ secrets.PYPI_TOKEN }}` and create a
`PYPI_TOKEN` repo secret instead. OIDC is preferred — no rotation, no
leaked-token blast radius.

### 3. Go — nothing to configure

Go modules publish by git tag. The workflow has `contents: write`
permission and uses the default `GITHUB_TOKEN` to push
`sdks/go/v<version>`. `proxy.golang.org` picks it up the first time
anyone runs `go get github.com/tomskest/aju/sdks/go/ajuclient@v0.1.0`.

## Cutting a release

1. Make sure `sdks/openapi/openapi.yaml` and the three regenerated SDKs
   are committed and in sync. `./sdks/scripts/generate.sh` locally if you
   need to regenerate.
2. Bump the version in **both** files to the same semver:
   - `sdks/typescript/package.json` → `"version": "0.1.0"`
   - `sdks/python/pyproject.toml` → `version = "0.1.0"`
3. Commit the bump: `git commit -am "sdks: 0.1.0"`
4. Tag and push:
   ```bash
   git tag sdks-v0.1.0
   git push origin main sdks-v0.1.0
   ```
5. Watch the `sdks-release` workflow run. On success, all three SDKs are
   published and a GitHub Release is created with install snippets.

## Manual / dry-run

`workflow_dispatch` runs every step **except** the actual publishes and
the Go tag push — useful for verifying a tag candidate before you push it.

```
Actions → sdks-release → Run workflow → leave default tag
```

## Version bumping strategy

Keep the three package versions in lockstep with the OpenAPI spec's
`info.version`. If you only ship ergonomic improvements to one SDK
(no spec change), bump just that one and release it with a tag like
`sdks-ts-v0.1.1` — this workflow would need a small extension to
handle per-language tags; not wired up yet. For now, one tag → three
publishes → everything moves together.
