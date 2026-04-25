# install.aju.sh — Cloudflare Worker

Serves the install bash / PowerShell script for the `aju` CLI. Fetches binaries
from the `tomskest/aju` GitHub Releases.

## Config

Vars live in `wrangler.toml` under `[vars]`:

| Var                   | Value                   |
| --------------------- | ----------------------- |
| `GITHUB_REPO`         | `tomskest/aju`          |
| `BINARY_NAME`         | `aju`                   |
| `DEFAULT_INSTALL_DIR` | `$HOME/.local/bin`      |

Change them there, not in code.

## Deploy

Prereqs:

```
npm install -g wrangler
wrangler login
```

Deploy:

```
cd worker/install
wrangler deploy
```

## Custom domain

The route in `wrangler.toml` is `install.aju.sh/*` on zone `aju.sh`. Add the
custom domain once in the Cloudflare dashboard:

Workers & Pages → your Worker (`aju-install`) → Settings → Domains & Routes →
Add → Custom Domain → `install.aju.sh`.

Cloudflare provisions the TLS cert automatically.

## Test

```
curl -fsSL https://install.aju.sh | head -20
curl -fsSL https://install.aju.sh/ps1 | head -20
```

You should see the bash / PowerShell installer with `REPO="tomskest/aju"` and
`BINARY="aju"` baked in.

## Local dev

```
cd worker/install
wrangler dev
```
