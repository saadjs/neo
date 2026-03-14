#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXPECTED_NODE_VERSION="v24.14.0"
NODE_BIN="/usr/bin/node"
ENV_FILE="${1:-$ROOT_DIR/.env}"
DEFAULT_DATA_DIR="${HOME}/.neo"
DEFAULT_LOG_DIR="${DEFAULT_DATA_DIR}/logs"

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

[[ -f "$ENV_FILE" ]] && {
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
}

DATA_DIR="${NEO_DATA_DIR:-$DEFAULT_DATA_DIR}"
LOG_DIR="${NEO_LOG_DIR:-$DEFAULT_LOG_DIR}"

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

mkdir -p "$DATA_DIR" "$LOG_DIR"
[[ -w "$DATA_DIR" ]] || fail "data directory is not writable: $DATA_DIR"
[[ -w "$LOG_DIR" ]] || fail "log directory is not writable: $LOG_DIR"
pass "Writable runtime directories ($DATA_DIR, $LOG_DIR)"

"$NODE_BIN" --input-type=module -e "import { chromium } from 'playwright'; const browser = await chromium.launch({ headless: true }); await browser.close();"
pass "Playwright Chromium launches successfully"

echo "Preflight checks passed."
