#!/usr/bin/env bash

set -euo pipefail

SOURCE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_SERVICE_NAME="neo"
DEFAULT_INSTALL_DIR="/opt/neo"
DEFAULT_APP_USER="neo"
EXPECTED_NODE_VERSION="24.14.0"

prompt() {
  local label="$1"
  local default_value="$2"
  local value
  read -r -p "$label [$default_value]: " value
  printf '%s\n' "${value:-$default_value}"
}

confirm() {
  local prompt_text="$1"
  local default_answer="${2:-Y}"
  local suffix="[Y/n]"
  if [[ "$default_answer" == "N" ]]; then
    suffix="[y/N]"
  fi

  local reply
  read -r -p "$prompt_text $suffix: " reply
  reply="${reply:-$default_answer}"
  [[ "$reply" =~ ^[Yy]$ ]]
}

require_command() {
  local cmd="$1"
  command -v "$cmd" >/dev/null 2>&1 || {
    echo "Missing required command: $cmd" >&2
    exit 1
  }
}

run_as_app_user() {
  local app_user="$1"
  shift
  sudo -u "$app_user" "$@"
}

detect_node_arch() {
  case "$(uname -m)" in
    x86_64) printf '%s\n' "x64" ;;
    aarch64 | arm64) printf '%s\n' "arm64" ;;
    *)
      echo "Unsupported architecture for automatic Node install: $(uname -m)" >&2
      exit 1
      ;;
  esac
}

ensure_system_node() {
  local expected_version="v${EXPECTED_NODE_VERSION}"
  local current_version=""
  local tmp_dir=""

  if [[ -x /usr/bin/node ]]; then
    current_version="$(/usr/bin/node -v)"
  fi

  if [[ "$current_version" == "$expected_version" ]]; then
    return 0
  fi

  echo "Installing Node ${EXPECTED_NODE_VERSION} to /usr/bin/node..."

  require_command curl
  require_command tar
  require_command sudo

  local arch
  arch="$(detect_node_arch)"
  tmp_dir="$(mktemp -d)"
  local archive="node-v${EXPECTED_NODE_VERSION}-linux-${arch}.tar.xz"
  local url="https://nodejs.org/dist/v${EXPECTED_NODE_VERSION}/${archive}"

  curl -fsSL "$url" -o "$tmp_dir/$archive"
  tar -xJf "$tmp_dir/$archive" -C "$tmp_dir"

  sudo rm -rf /usr/local/lib/nodejs
  sudo mkdir -p /usr/local/lib/nodejs
  sudo cp -R "$tmp_dir/node-v${EXPECTED_NODE_VERSION}-linux-${arch}/." /usr/local/lib/nodejs/
  sudo ln -sf /usr/local/lib/nodejs/bin/node /usr/bin/node
  sudo ln -sf /usr/local/lib/nodejs/bin/npm /usr/bin/npm
  sudo ln -sf /usr/local/lib/nodejs/bin/npx /usr/bin/npx

  [[ "$(/usr/bin/node -v)" == "$expected_version" ]] || {
    echo "Failed to install Node ${EXPECTED_NODE_VERSION}" >&2
    exit 1
  }

  rm -rf "$tmp_dir"
}

main() {
  require_command sudo
  require_command rsync
  require_command systemctl
  ensure_system_node
  require_command npm
  require_command npx

  echo "Neo Ubuntu setup"
  echo

  local service_name
  service_name="$(prompt "systemd service name" "$DEFAULT_SERVICE_NAME")"

  local install_dir
  install_dir="$(prompt "install directory" "$DEFAULT_INSTALL_DIR")"

  local app_user
  app_user="$(prompt "service user" "$DEFAULT_APP_USER")"

  local env_path="${install_dir}/.env"

  echo
  echo "Planned setup:"
  echo "  service name: $service_name"
  echo "  install dir:  $install_dir"
  echo "  app user:     $app_user"
  echo "  env file:     $env_path"
  echo

  confirm "Continue with this setup?" "Y" || exit 0

  sudo "$SOURCE_ROOT/deploy/install-systemd.sh" "$service_name" "$install_dir" "$app_user"

  echo
  echo "Syncing repo to ${install_dir}..."
  sudo rsync -a --delete \
    --exclude .git \
    --exclude node_modules \
    --exclude dist \
    "$SOURCE_ROOT/" "${install_dir}/"
  sudo chown -R "$app_user:$app_user" "$install_dir"

  if [[ ! -f "$env_path" ]]; then
    echo
    if confirm "No .env found. Create ${env_path} from .env.example now?" "Y"; then
      sudo cp "${install_dir}/.env.example" "$env_path"
      sudo chown "$app_user:$app_user" "$env_path"
      echo "Created ${env_path}. Edit it before starting Neo if secrets are still missing."
      if confirm "Open ${env_path} in nano now?" "Y"; then
        sudo nano "$env_path"
      fi
    else
      echo "Skipping .env creation. Neo will not start until ${env_path} exists."
    fi
  fi

  echo
  echo "Installing npm dependencies..."
  run_as_app_user "$app_user" bash -lc "cd '$install_dir' && npm ci"

  echo "Building Neo..."
  run_as_app_user "$app_user" bash -lc "cd '$install_dir' && npm run build"

  echo "Installing Playwright Ubuntu dependencies..."
  sudo bash -lc "cd '$install_dir' && npx playwright install-deps chromium"

  echo "Installing Playwright Chromium..."
  run_as_app_user "$app_user" bash -lc "cd '$install_dir' && npx playwright install chromium"

  echo "Running preflight checks..."
  run_as_app_user "$app_user" bash -lc "cd '$install_dir' && ./deploy/preflight.sh '$env_path'"

  echo
  if confirm "Start and enable ${service_name} now?" "Y"; then
    sudo systemctl enable --now "$service_name"
    sudo systemctl --no-pager --full status "$service_name" || true
  else
    echo "Service not started."
  fi

  echo
  echo "Done."
  echo "Useful commands:"
  echo "  sudo systemctl status ${service_name}"
  echo "  sudo journalctl -u ${service_name} -f"
  echo "  cd ${install_dir} && git pull && npm ci && npm run build && sudo systemctl restart ${service_name}"
}

main "$@"
