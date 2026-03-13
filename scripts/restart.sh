#!/usr/bin/env bash
# Self-restart helper for Neo
# Writes a marker file and exits — systemd handles the restart

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="${NEO_DATA_DIR:-$SCRIPT_DIR/../data}"

echo "{\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"source\":\"restart-script\"}" > "$DATA_DIR/.restart-marker"

# Find and kill the Node process
PID=$(pgrep -f "node.*dist/index.js" || true)
if [ -n "$PID" ]; then
  kill "$PID"
  echo "Sent SIGTERM to Neo (PID $PID)"
else
  echo "Neo process not found"
fi
