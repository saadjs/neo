#!/usr/bin/env bash

set -euo pipefail

SOURCE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_SERVICE_NAME="neo"
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

git_origin_url() {
  git -C "$SOURCE_ROOT" remote get-url origin 2>/dev/null || {
    echo "Unable to determine git origin from $SOURCE_ROOT" >&2
    exit 1
  }
}

git_current_branch() {
  git -C "$SOURCE_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || {
    echo "Unable to determine current git branch from $SOURCE_ROOT" >&2
    exit 1
  }
}

sync_checkout() {
  local install_dir="$1"
  local repo_url="$2"
  local branch="$3"

  if [[ -d "$install_dir/.git" ]]; then
    echo "Updating git checkout in ${install_dir}..."
    git -C "$install_dir" remote set-url origin "$repo_url"
    git -C "$install_dir" fetch origin "$branch"
    git -C "$install_dir" checkout "$branch"
    git -C "$install_dir" pull --ff-only origin "$branch"
    return 0
  fi

  if [[ -n "$(find "$install_dir" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]]; then
    echo "Install directory is not empty and is not a git checkout: $install_dir" >&2
    echo "Move or remove it, or convert it to a git checkout first." >&2
    exit 1
  fi

  echo "Cloning ${repo_url} (${branch}) into ${install_dir}..."
  git clone --branch "$branch" "$repo_url" "$install_dir"
}

current_login_user() {
  printf '%s\n' "${SUDO_USER:-$USER}"
}

home_dir_for_user() {
  local user_name="$1"
  local home_dir
  home_dir="$(getent passwd "$user_name" | cut -d: -f6)"
  [[ -n "$home_dir" ]] || {
    echo "Unable to determine home directory for user: $user_name" >&2
    exit 1
  }
  printf '%s\n' "$home_dir"
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
  require_command git
  require_command systemctl
  ensure_system_node
  require_command npm
  require_command npx

  echo "Neo Ubuntu setup"
  echo

  local service_scope
  service_scope="$(prompt "systemd scope (system/user)" "user")"
  if [[ "$service_scope" != "system" && "$service_scope" != "user" ]]; then
    echo "Invalid systemd scope: $service_scope (expected system or user)" >&2
    exit 1
  fi

  local service_name
  service_name="$(prompt "systemd service name" "$DEFAULT_SERVICE_NAME")"

  local default_app_user
  local default_install_dir
  if [[ "$service_scope" == "user" ]]; then
    default_app_user="$(current_login_user)"
    default_install_dir="$(home_dir_for_user "$default_app_user")/neo"
  else
    default_app_user="neo"
    default_install_dir="/opt/neo"
  fi

  local install_dir
  install_dir="$(prompt "install directory" "$default_install_dir")"

  local app_user
  app_user="$(prompt "service user" "$default_app_user")"

  if [[ "$service_scope" == "user" && "$app_user" != "$(current_login_user)" ]]; then
    echo "User-scoped installs must use the current login user ($(current_login_user))." >&2
    exit 1
  fi

  local env_path="${install_dir}/.env"
  local repo_url
  repo_url="$(git_origin_url)"
  local repo_branch
  repo_branch="$(git_current_branch)"

  echo
  echo "Planned setup:"
  echo "  systemd scope: $service_scope"
  echo "  service name: $service_name"
  echo "  install dir:  $install_dir"
  echo "  app user:     $app_user"
  echo "  repo url:     $repo_url"
  echo "  repo branch:  $repo_branch"
  echo "  env file:     $env_path"
  echo

  confirm "Continue with this setup?" "Y" || exit 0

  if [[ "$service_scope" == "user" ]]; then
    "$SOURCE_ROOT/deploy/install-systemd-user.sh" "$service_name" "$install_dir" "$app_user"
  else
    sudo "$SOURCE_ROOT/deploy/install-systemd.sh" "$service_name" "$install_dir" "$app_user"
  fi

  echo
  echo "Syncing repo from GitHub into ${install_dir}..."
  if [[ "$service_scope" == "user" ]]; then
    sync_checkout "$install_dir" "$repo_url" "$repo_branch"
  else
    run_as_app_user "$app_user" bash -lc "$(printf '%q ' \
      "install_dir=$install_dir" \
      "repo_url=$repo_url" \
      "repo_branch=$repo_branch" \
      "$(declare -f sync_checkout)" \
      'sync_checkout "$install_dir" "$repo_url" "$repo_branch"')"
  fi

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
  if [[ "$service_scope" == "user" ]]; then
    bash -lc "cd '$install_dir' && npx playwright install chromium"
  else
    run_as_app_user "$app_user" bash -lc "cd '$install_dir' && npx playwright install chromium"
  fi

  echo "Running preflight checks..."
  if [[ "$service_scope" == "user" ]]; then
    bash -lc "cd '$install_dir' && ./deploy/preflight.sh '$env_path'"
  else
    run_as_app_user "$app_user" bash -lc "cd '$install_dir' && ./deploy/preflight.sh '$env_path'"
  fi

  echo
  if confirm "Start and enable ${service_name} now?" "Y"; then
    if [[ "$service_scope" == "user" ]]; then
      if command -v loginctl >/dev/null 2>&1; then
        sudo loginctl enable-linger "$app_user"
      fi
      systemctl --user enable --now "$service_name"
      systemctl --user --no-pager --full status "$service_name" || true
    else
      sudo systemctl enable --now "$service_name"
      sudo systemctl --no-pager --full status "$service_name" || true
    fi
  else
    echo "Service not started."
  fi

  echo
  echo "Done."
  echo "Useful commands:"
  if [[ "$service_scope" == "user" ]]; then
    echo "  systemctl --user status ${service_name}"
    echo "  journalctl --user -u ${service_name} -f"
  else
    echo "  sudo systemctl status ${service_name}"
    echo "  sudo journalctl -u ${service_name} -f"
  fi
  echo "  cd ${SOURCE_ROOT} && git pull && ./deploy/setup-ubuntu.sh"
  echo "  cd ${install_dir} && ./deploy/update.sh ${service_name} ${service_scope}"
}

main "$@"
