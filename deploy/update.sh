#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

SERVICE_NAME="${1:-${NEO_SYSTEMD_UNIT:-neo}}"
SERVICE_SCOPE="${2:-${NEO_SYSTEMCTL_SCOPE:-system}}"

require_command() {
  local cmd="$1"
  command -v "$cmd" >/dev/null 2>&1 || {
    echo "Missing required command: $cmd" >&2
    exit 1
  }
}

resolve_checkout_owner() {
  if command -v stat >/dev/null 2>&1; then
    stat -c '%U' "$ROOT_DIR" 2>/dev/null && return 0
  fi

  if command -v id >/dev/null 2>&1; then
    id -un
    return 0
  fi

  echo "Unable to determine checkout owner." >&2
  exit 1
}

run_as_checkout_owner() {
  local owner="$1"
  shift

  if [[ "$(id -un)" == "$owner" ]]; then
    "$@"
    return 0
  fi

  require_command sudo
  sudo -u "$owner" "$@"
}

run_systemctl() {
  if [[ "$SERVICE_SCOPE" == "user" ]]; then
    systemctl --user "$@"
    return 0
  fi

  if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
    systemctl "$@"
    return 0
  fi

  require_command sudo
  sudo systemctl "$@"
}

ensure_clean_worktree() {
  if [[ -n "$(git -C "$ROOT_DIR" status --short)" ]]; then
    echo "Refusing to update: git worktree is not clean in ${ROOT_DIR}." >&2
    echo "Commit, stash, or discard local changes before running deploy/update.sh." >&2
    exit 1
  fi
}

main() {
  require_command git
  require_command npm
  require_command systemctl

  [[ "$SERVICE_SCOPE" == "system" || "$SERVICE_SCOPE" == "user" ]] || {
    echo "Invalid systemd scope: ${SERVICE_SCOPE}. Expected system or user." >&2
    exit 1
  }

  local branch
  branch="$(git -C "$ROOT_DIR" rev-parse --abbrev-ref HEAD)"
  [[ "$branch" != "HEAD" ]] || {
    echo "Refusing to update from a detached HEAD. Check out a branch first." >&2
    exit 1
  }

  local upstream
  upstream="$(git -C "$ROOT_DIR" rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)"
  if [[ -z "$upstream" ]]; then
    echo "Refusing to update: branch ${branch} has no configured upstream." >&2
    exit 1
  fi

  local remote="${upstream%%/*}"
  local remote_branch="${upstream#*/}"
  local checkout_owner
  checkout_owner="$(resolve_checkout_owner)"

  echo "Updating Neo in ${ROOT_DIR}"
  echo "  service: ${SERVICE_NAME} (${SERVICE_SCOPE})"
  echo "  branch:  ${branch}"
  echo "  remote:  ${remote}/${remote_branch}"
  echo "  owner:   ${checkout_owner}"

  ensure_clean_worktree

  echo
  echo "Fetching latest commits..."
  run_as_checkout_owner "$checkout_owner" git -C "$ROOT_DIR" fetch "$remote" "$remote_branch"

  echo "Fast-forwarding checkout..."
  run_as_checkout_owner "$checkout_owner" git -C "$ROOT_DIR" merge --ff-only "$upstream"

  echo "Installing dependencies..."
  run_as_checkout_owner "$checkout_owner" bash -lc \
    "cd '$ROOT_DIR' && HUSKY=0 npm ci --include=dev"

  echo "Building Neo..."
  run_as_checkout_owner "$checkout_owner" bash -lc "cd '$ROOT_DIR' && npm run build"

  echo "Running preflight checks..."
  run_as_checkout_owner "$checkout_owner" bash -lc "cd '$ROOT_DIR' && ./deploy/preflight.sh '$ENV_FILE'"

  echo "Restarting ${SERVICE_NAME}..."
  run_systemctl restart "$SERVICE_NAME"

  echo
  echo "Update completed successfully."
  run_systemctl --no-pager --full status "$SERVICE_NAME" || true
}

main "$@"
