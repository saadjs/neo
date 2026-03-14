#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_NAME="${1:-neo}"
INSTALL_DIR="${2:-$HOME/neo}"
APP_USER="${3:-${SUDO_USER:-$USER}}"
CURRENT_USER="${SUDO_USER:-$USER}"
CURRENT_HOME="$(getent passwd "$CURRENT_USER" | cut -d: -f6)"
UNIT_DIR="${CURRENT_HOME}/.config/systemd/user"
SERVICE_PATH="${UNIT_DIR}/${SERVICE_NAME}.service"

[[ -z "${SUDO_USER:-}" ]] || {
  echo "Run deploy/install-systemd-user.sh without sudo as ${SUDO_USER}." >&2
  exit 1
}

[[ -n "$CURRENT_HOME" ]] || {
  echo "Unable to determine home directory for user: ${CURRENT_USER}." >&2
  exit 1
}

[[ "$APP_USER" == "$CURRENT_USER" ]] || {
  echo "Run deploy/install-systemd-user.sh as the target user. Expected app user ${CURRENT_USER}, got ${APP_USER}." >&2
  exit 1
}

mkdir -p "$INSTALL_DIR" "$UNIT_DIR"

cp "$ROOT_DIR/deploy/neo-user.service" "$SERVICE_PATH"
sed -i.bak \
  -e "s|^WorkingDirectory=.*|WorkingDirectory=${INSTALL_DIR}|" \
  -e "s|^Environment=NEO_DATA_DIR=.*|Environment=NEO_DATA_DIR=${HOME}/.neo|" \
  -e "s|^Environment=NEO_LOG_DIR=.*|Environment=NEO_LOG_DIR=${HOME}/.neo/logs|" \
  -e "s|^Environment=NEO_SYSTEMD_UNIT=.*|Environment=NEO_SYSTEMD_UNIT=${SERVICE_NAME}|" \
  -e "s|^EnvironmentFile=.*|EnvironmentFile=${INSTALL_DIR}/.env|" \
  "$SERVICE_PATH"

systemctl --user daemon-reload
systemctl --user enable "$SERVICE_NAME"

echo "Installed $SERVICE_PATH"
echo "Next steps:"
echo "  1. clone or pull the GitHub repo into ${INSTALL_DIR}"
echo "  2. cd ${INSTALL_DIR} && npm ci && npm run build"
echo "  3. ./deploy/preflight.sh"
echo "  4. systemctl --user start $SERVICE_NAME"
echo "  5. sudo loginctl enable-linger ${APP_USER}"
