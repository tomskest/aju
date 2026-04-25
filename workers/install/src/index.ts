interface Env {
  GITHUB_REPO: string;
  BINARY_NAME: string;
  DEFAULT_INSTALL_DIR: string;
}

const CACHE_TTL_SECONDS = 300;
const MANIFEST_CACHE_TTL_SECONDS = 300;
const MANIFEST_FALLBACK_CACHE_TTL_SECONDS = 60;
const MIN_SUPPORTED_VERSION = "0.1.0";
const PLATFORMS: Array<{ key: string; suffix: string }> = [
  { key: "darwin_arm64", suffix: "darwin-arm64" },
  { key: "darwin_amd64", suffix: "darwin-amd64" },
  { key: "linux_arm64", suffix: "linux-arm64" },
  { key: "linux_amd64", suffix: "linux-amd64" },
];

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/robots.txt") {
      return new Response("User-agent: *\nDisallow:\n", {
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    if (url.pathname === "/health") {
      return new Response("ok", { headers: { "content-type": "text/plain" } });
    }

    if (url.pathname === "/cli-manifest.json") {
      return handleManifest(env);
    }

    if (isBrowser(request) && url.pathname === "/") {
      return Response.redirect("https://aju.sh", 302);
    }

    const version = url.searchParams.get("version") ?? "latest";

    if (url.pathname === "/" || url.pathname === "/install.sh") {
      return script(renderShScript(env, version));
    }

    if (url.pathname === "/ps1" || url.pathname === "/install.ps1") {
      return script(renderPs1Script(env, version));
    }

    return new Response("Not found", { status: 404 });
  },
};

function script(body: string): Response {
  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": `public, max-age=${CACHE_TTL_SECONDS}`,
      "x-content-type-options": "nosniff",
    },
  });
}

function isBrowser(request: Request): boolean {
  const ua = (request.headers.get("user-agent") ?? "").toLowerCase();
  if (!ua) return false;
  if (/curl|wget|fetch|powershell|httpie/.test(ua)) return false;
  return /mozilla|chrome|safari|firefox|edge/.test(ua);
}

interface GhAsset {
  name: string;
  browser_download_url: string;
}

interface GhRelease {
  tag_name: string;
  name?: string;
  assets?: GhAsset[];
}

interface Manifest {
  latest_version: string;
  min_supported_version: string;
  download: Record<string, string>;
  checksums_url: string;
  announcements: unknown[];
}

async function handleManifest(env: Env): Promise<Response> {
  try {
    const manifest = await buildManifest(env);
    return jsonResponse(manifest, {
      "cache-control": `public, max-age=${MANIFEST_CACHE_TTL_SECONDS}`,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.log(`cli-manifest fallback: ${reason}`);
    const fallback: Manifest = {
      latest_version: "unknown",
      min_supported_version: MIN_SUPPORTED_VERSION,
      download: {},
      checksums_url: "",
      announcements: [],
    };
    return jsonResponse(fallback, {
      "cache-control": `public, max-age=${MANIFEST_FALLBACK_CACHE_TTL_SECONDS}`,
      "x-aju-manifest-fallback": "github-api-failed",
    });
  }
}

async function buildManifest(env: Env): Promise<Manifest> {
  const apiURL = `https://api.github.com/repos/${env.GITHUB_REPO}/releases/latest`;
  const res = await fetch(apiURL, {
    headers: {
      "user-agent": "aju-install-worker",
      accept: "application/vnd.github+json",
    },
  });
  if (!res.ok) {
    throw new Error(`github api ${res.status}`);
  }
  const release = (await res.json()) as GhRelease;
  const tag = release.tag_name ?? "";
  if (!/^cli-v/.test(tag)) {
    throw new Error(`unexpected tag: ${tag}`);
  }
  const latestVersion = tag.replace(/^cli-v/, "");

  const binary = env.BINARY_NAME;
  const download: Record<string, string> = {};
  const assets = release.assets ?? [];
  for (const plat of PLATFORMS) {
    const assetName = `${binary}-${plat.suffix}`;
    const found = assets.find((a) => a.name === assetName);
    if (found) {
      download[plat.key] = found.browser_download_url;
    }
  }

  const checksumsURL = `https://github.com/${env.GITHUB_REPO}/releases/download/${tag}/checksums.txt`;

  return {
    latest_version: latestVersion,
    min_supported_version: MIN_SUPPORTED_VERSION,
    download,
    checksums_url: checksumsURL,
    announcements: [],
  };
}

function jsonResponse(value: unknown, extra: Record<string, string> = {}): Response {
  const headers: Record<string, string> = {
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
    ...extra,
  };
  return new Response(JSON.stringify(value, null, 2), { headers });
}

function renderShScript(env: Env, version: string): string {
  const repo = env.GITHUB_REPO;
  const binary = env.BINARY_NAME;
  const installDir = env.DEFAULT_INSTALL_DIR;
  const tag = version === "latest" ? "latest" : encodeURIComponent(version);

  return `#!/usr/bin/env sh
# aju installer — https://aju.sh
# Usage: curl -fsSL install.aju.sh | sh
#        curl -fsSL install.aju.sh?version=cli-v0.1.0 | sh
set -eu
# pipefail is a bash/ksh/zsh feature; ignore the error on plain POSIX sh.
# shellcheck disable=SC3040
(set -o pipefail 2>/dev/null) && set -o pipefail || true

REPO="${repo}"
BINARY="${binary}"
VERSION="${tag}"
INSTALL_DIR="\${AJU_INSTALL_DIR:-${installDir}}"

info()  { printf '\\033[0;36m==>\\033[0m %s\\n' "$*"; }
warn()  { printf '\\033[0;33m!!!\\033[0m %s\\n' "$*" >&2; }
error() { printf '\\033[0;31mxxx\\033[0m %s\\n' "$*" >&2; exit 1; }

detect_os() {
  uname_s="$(uname -s)"
  case "$uname_s" in
    Linux)  echo "linux" ;;
    Darwin) echo "darwin" ;;
    *)      error "Unsupported OS: $uname_s" ;;
  esac
}

detect_arch() {
  uname_m="$(uname -m)"
  case "$uname_m" in
    x86_64|amd64)  echo "amd64" ;;
    arm64|aarch64) echo "arm64" ;;
    *)             error "Unsupported architecture: $uname_m" ;;
  esac
}

require() {
  command -v "$1" >/dev/null 2>&1 || error "Missing required tool: $1"
}

require uname
require mkdir
require chmod
if command -v curl >/dev/null 2>&1; then
  DL="curl -fsSL"
elif command -v wget >/dev/null 2>&1; then
  DL="wget -qO-"
else
  error "Need curl or wget to download."
fi

# sha256 verification tool detection: prefer sha256sum (Linux),
# fall back to 'shasum -a 256' (macOS). Not fatal if absent, but strongly recommended.
if command -v sha256sum >/dev/null 2>&1; then
  SHA256="sha256sum"
elif command -v shasum >/dev/null 2>&1; then
  SHA256="shasum -a 256"
else
  SHA256=""
fi

OS="$(detect_os)"
ARCH="$(detect_arch)"
ASSET="\${BINARY}-\${OS}-\${ARCH}"

if [ "$VERSION" = "latest" ]; then
  BASE_URL="https://github.com/$REPO/releases/latest/download"
else
  BASE_URL="https://github.com/$REPO/releases/download/$VERSION"
fi
URL="$BASE_URL/$ASSET"
CHECKSUMS_URL="$BASE_URL/checksums.txt"

info "Installing $BINARY ($VERSION) for $OS/$ARCH"
info "Source: $URL"

mkdir -p "$INSTALL_DIR"
TMP="$(mktemp)"
SUMS_TMP="$(mktemp)"
trap 'rm -f "$TMP" "$SUMS_TMP"' EXIT

if ! $DL "$URL" > "$TMP"; then
  error "Download failed from $URL"
fi

if [ ! -s "$TMP" ]; then
  error "Downloaded file is empty."
fi

# Checksum verification against checksums.txt in the same release.
if [ -n "$SHA256" ]; then
  if $DL "$CHECKSUMS_URL" > "$SUMS_TMP" && [ -s "$SUMS_TMP" ]; then
    EXPECTED="$(grep " $ASSET\\$" "$SUMS_TMP" | awk '{print $1}' | head -n1 || true)"
    if [ -z "$EXPECTED" ]; then
      EXPECTED="$(grep "  *$ASSET *\\$" "$SUMS_TMP" | awk '{print $1}' | head -n1 || true)"
    fi
    if [ -z "$EXPECTED" ]; then
      rm -f "$TMP"
      error "No checksum entry for $ASSET in checksums.txt"
    fi
    ACTUAL="$($SHA256 "$TMP" | awk '{print $1}')"
    if [ "$EXPECTED" != "$ACTUAL" ]; then
      rm -f "$TMP"
      error "Checksum mismatch for $ASSET (expected $EXPECTED, got $ACTUAL)"
    fi
    info "Checksum OK ($ACTUAL)"
  else
    warn "Could not fetch checksums.txt from $CHECKSUMS_URL — skipping verification."
  fi
else
  warn "No sha256 tool found (sha256sum or shasum). Skipping checksum verification."
fi

DEST="$INSTALL_DIR/$BINARY"
mv "$TMP" "$DEST"
chmod +x "$DEST"

info "Installed to $DEST"

case ":$PATH:" in
  *":$INSTALL_DIR:"*) : ;;
  *) warn "$INSTALL_DIR is not on your PATH. Add: export PATH=\\"$INSTALL_DIR:\\$PATH\\"" ;;
esac

info "Run '$BINARY --help' to get started."
`;
}

function renderPs1Script(env: Env, version: string): string {
  const repo = env.GITHUB_REPO;
  const binary = env.BINARY_NAME;
  const tag = version === "latest" ? "latest" : encodeURIComponent(version);

  return `# aju installer — https://aju.sh
# Usage: irm install.aju.sh/ps1 | iex
#        irm install.aju.sh/ps1?version=cli-v0.1.0 | iex
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Repo    = "${repo}"
$Binary  = "${binary}"
$Version = "${tag}"

function Write-Info($msg)  { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Warn2($msg) { Write-Host "!!! $msg" -ForegroundColor Yellow }
function Die($msg) {
  Write-Host "xxx $msg" -ForegroundColor Red
  exit 1
}

$archRaw = $env:PROCESSOR_ARCHITECTURE
switch -Regex ($archRaw) {
  "AMD64|x86_64" { $Arch = "amd64" }
  "ARM64"        { $Arch = "arm64" }
  default        { Die "Unsupported architecture: $archRaw" }
}

$InstallDir = $env:AJU_INSTALL_DIR
if (-not $InstallDir) {
  $InstallDir = Join-Path $env:LOCALAPPDATA "aju\\bin"
}
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

$AssetName = "$Binary-windows-$Arch.exe"
if ($Version -eq "latest") {
  $Url = "https://github.com/$Repo/releases/latest/download/$AssetName"
} else {
  $Url = "https://github.com/$Repo/releases/download/$Version/$AssetName"
}

$Dest = Join-Path $InstallDir "$Binary.exe"

Write-Info "Installing $Binary ($Version) for windows/$Arch"
Write-Info "Source: $Url"

try {
  Invoke-WebRequest -Uri $Url -OutFile $Dest -UseBasicParsing
} catch {
  Die "Download failed from $Url — $_"
}

if (-not (Test-Path $Dest) -or (Get-Item $Dest).Length -eq 0) {
  Die "Downloaded file is empty."
}

Write-Info "Installed to $Dest"

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
$segments = @()
if ($userPath) { $segments = $userPath.Split(";") | Where-Object { $_ -ne "" } }
if ($segments -notcontains $InstallDir) {
  $newPath = (@($InstallDir) + $segments) -join ";"
  [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
  Write-Info "Added $InstallDir to User PATH (restart your shell to pick it up)."
} else {
  Write-Info "$InstallDir already on PATH."
}

Write-Info "Run '$Binary --help' to get started."
`;
}
