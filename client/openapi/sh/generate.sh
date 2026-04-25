#!/usr/bin/env bash
# Regenerate all SDKs from client/openapi/openapi.yaml.
#
# Prerequisites: node >=18, python3 >=3.10, go >=1.22.
# Per-SDK generator binaries are pulled on the fly (npx, pipx/uv/venv, go run).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SDK_ROOT="$(cd "$HERE/.." && pwd)"
SPEC="$SDK_ROOT/openapi.yaml"

if [[ ! -f "$SPEC" ]]; then
  echo "error: spec not found at $SPEC" >&2
  exit 1
fi

echo "==> TypeScript SDK"
(
  cd "$SDK_ROOT/ts"
  if [[ ! -d node_modules ]]; then
    npm install
  fi
  npm run generate
  npm run build
)

echo "==> Python SDK"
(
  cd "$SDK_ROOT/py"
  if ! command -v openapi-python-client >/dev/null 2>&1; then
    echo "   installing openapi-python-client (one-time, via pipx if available)"
    if command -v pipx >/dev/null 2>&1; then
      pipx install openapi-python-client
    else
      python3 -m pip install --user openapi-python-client
    fi
  fi
  rm -rf aju/_generated
  openapi-python-client generate \
    --path "$SPEC" \
    --config openapi-python-client.yaml \
    --meta none \
    --overwrite
  # --meta none drops the generated package at client/openapi/py/_generated. Move it
  # under aju/ so `from aju._generated.client import ...` resolves.
  mv _generated aju/_generated
)

echo "==> Go SDK"
(
  cd "$SDK_ROOT/go/ajuclient"
  go run github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@latest \
    -config oapi-codegen.yaml \
    "$SPEC"
  cd ..
  go mod tidy
  go build ./...
)

echo
echo "All SDKs regenerated from $SPEC"
