#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_NAME="${1:-neo}"
SERVICE_PATH="/etc/systemd/system/${SERVICE_NAME}.service"

[[ $EUID -eq 0 ]] || {
  echo "Run as root: sudo ./deploy/install-systemd.sh [service-name]" >&2
  exit 1
}

id -u neo >/dev/null 2>&1 || useradd --system --home /opt/neo --shell /usr/sbin/nologin neo

install -d -o neo -g neo /opt/neo
install -d -o neo -g neo /opt/neo/data
install -d -o neo -g neo /opt/neo/logs

cp "$ROOT_DIR/deploy/neo.service" "$SERVICE_PATH"
sed -i.bak "s/NEO_SYSTEMD_UNIT=neo/NEO_SYSTEMD_UNIT=${SERVICE_NAME}/" "$SERVICE_PATH"

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"

echo "Installed $SERVICE_PATH"
echo "Next steps:"
echo "  1. rsync the repo to /opt/neo"
echo "  2. cd /opt/neo && npm ci && npm run build"
echo "  3. sudo -u neo ./deploy/preflight.sh"
echo "  4. systemctl start $SERVICE_NAME"
