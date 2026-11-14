#!/usr/bin/env bash
# Quickstart script for RFP Slide Deck Studio (macOS/Linux)
set -euo pipefail

# Run from the folder that contains this script, wherever it is called from
cd "$(dirname "$0")"

# Set STUDIO_API_KEY to default dev key only if not already set
if [ -z "${STUDIO_API_KEY:-}" ]; then
  export STUDIO_API_KEY="WIN2WIN_FSS_CSTAM_3"
fi

PORT="${1:-8091}"

echo "===================================================="
echo " Starting RFP Slide Deck Studio on port ${PORT}"
echo " Web UI:     http://localhost:${PORT}"
echo " API Auth:   Include header 'X-API-Key'"
echo "===================================================="

# Prefer this project's virtual environment when it exists. This prevents a
# restarted Studio from silently using a system Python without python-pptx.
if [ -x ".venv/bin/python" ]; then
  exec .venv/bin/python server.py "${PORT}"
elif command -v python3 >/dev/null 2>&1; then
  exec python3 server.py "${PORT}"
else
  exec python server.py "${PORT}"
fi
