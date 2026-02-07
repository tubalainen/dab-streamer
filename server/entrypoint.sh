#!/bin/bash
# dab-server entrypoint
# Starts the Python-based management HTTP API which handles
# device enumeration, scanning, and welle-cli lifecycle.

set -euo pipefail

mkdir -p /data/locks /tmp/dab

export MGMT_PORT="${MGMT_PORT:-8888}"
export WELLE_PORT="${WELLE_PORT:-7979}"
export SCAN_TIMEOUT="${SCAN_TIMEOUT:-10}"

echo "=== dab-server starting ==="
echo "Management API port: $MGMT_PORT"
echo "welle-cli stream port: $WELLE_PORT"

exec python3 /usr/local/bin/server.py
