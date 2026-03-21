#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_NAME="${1:-neo}"
INSTALL_DIR="${2:-/opt/neo}"
APP_USER="${3:-neo}"
SERVICE_PATH="/etc/systemd/system/${SERVICE_NAME}.service"

[[ $EUID -eq 0 ]] || {
  echo "Run as root: sudo ./deploy/install-systemd.sh [service-name] [install-dir] [app-user]" >&2
  exit 1
}

id -u "$APP_USER" >/dev/null 2>&1 || \
  useradd --system --home "$INSTALL_DIR" --shell /usr/sbin/nologin "$APP_USER"

install -d -o "$APP_USER" -g "$APP_USER" "$INSTALL_DIR"

cp "$ROOT_DIR/deploy/neo.service" "$SERVICE_PATH"
sed -i.bak \
  -e "s|^User=.*|User=${APP_USER}|" \
  -e "s|^Group=.*|Group=${APP_USER}|" \
  -e "s|^WorkingDirectory=.*|WorkingDirectory=${INSTALL_DIR}|" \
  -e "s|^Environment=NEO_DATA_DIR=.*|Environment=NEO_DATA_DIR=${INSTALL_DIR}/data|" \
  -e "s|^Environment=NEO_LOG_DIR=.*|Environment=NEO_LOG_DIR=${INSTALL_DIR}/logs|" \
  -e "s|^Environment=NEO_SYSTEMD_UNIT=.*|Environment=NEO_SYSTEMD_UNIT=${SERVICE_NAME}|" \
  -e "s|^EnvironmentFile=.*|EnvironmentFile=${INSTALL_DIR}/.env|" \
  "$SERVICE_PATH"

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"

echo "Installed $SERVICE_PATH"
echo "Next steps:"
echo "  1. clone or pull the GitHub repo into ${INSTALL_DIR}"
echo "  2. cd ${INSTALL_DIR} && npm ci && npm run build"
echo "  3. sudo -u ${APP_USER} ./deploy/preflight.sh"
echo "  4. systemctl start $SERVICE_NAME"
echo "Later updates:"
echo "  cd ${INSTALL_DIR} && ./deploy/update.sh ${SERVICE_NAME} system"
