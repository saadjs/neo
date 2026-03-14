#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXPECTED_NODE_VERSION="v24.14.0"
NODE_BIN="/usr/bin/node"
ENV_FILE="${1:-$ROOT_DIR/.env}"

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

warn() {
  echo "WARN: $1" >&2
}

pass() {
  echo "OK: $1"
}

require_file() {
  local path="$1"
  local label="$2"
  [[ -f "$path" ]] || fail "$label missing at $path"
  pass "$label present"
}

require_dir() {
  local path="$1"
  local label="$2"
  [[ -d "$path" ]] || fail "$label missing at $path"
  pass "$label present"
}

[[ -x "$NODE_BIN" ]] || fail "Expected system Node at $NODE_BIN"
[[ "$("$NODE_BIN" -v)" == "$EXPECTED_NODE_VERSION" ]] || \
  fail "Expected Node $EXPECTED_NODE_VERSION at $NODE_BIN, found $("$NODE_BIN" -v)"
pass "System Node matches $EXPECTED_NODE_VERSION"

require_file "$ENV_FILE" ".env file"
require_file "$ROOT_DIR/package.json" "package.json"
require_dir "$ROOT_DIR/node_modules" "node_modules"
require_file "$ROOT_DIR/dist/index.js" "bundled app"
require_file "$ROOT_DIR/deploy/neo.service" "systemd unit"
require_file "$ROOT_DIR/deploy/neo-user.service" "systemd user unit"

mkdir -p "$ROOT_DIR/data" "$ROOT_DIR/logs"
[[ -w "$ROOT_DIR/data" ]] || fail "data directory is not writable"
[[ -w "$ROOT_DIR/logs" ]] || fail "logs directory is not writable"
pass "Writable data/log directories"

"$NODE_BIN" --input-type=module -e "import { chromium } from 'playwright'; const browser = await chromium.launch({ headless: true }); await browser.close();"
pass "Playwright Chromium launches successfully"

if [[ -n "${GOOGLE_WORKSPACE_CLI_PATH:-}" ]]; then
  [[ -x "$GOOGLE_WORKSPACE_CLI_PATH" ]] || fail "GOOGLE_WORKSPACE_CLI_PATH is not executable: $GOOGLE_WORKSPACE_CLI_PATH"
  pass "Google Workspace CLI path is executable"
elif command -v gws >/dev/null 2>&1; then
  pass "Google Workspace CLI found in PATH"
else
  warn "gws CLI not found; google_workspace tool will fail until it is installed"
fi

echo "Preflight checks passed."
