#!/usr/bin/env bash
# Back up everything TendOlive cannot rebuild: the Docker volumes holding data, the knowledge base folder and .env.
# The RAG index (rag_index) is not backed up: it is rebuilt from knowledge-base/ at start.
#
#   ops/backup.sh [destination folder]        default: ./backups
# Writes <destination>/tendolive-<date>/ with one .tar.gz per volume, knowledge-base.tar.gz and env (mode 600).
# Safe while the stack runs; stop it first (docker compose stop) for a fully consistent n8n database copy.
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT="$(docker compose config --format json | python3 -c 'import sys, json; print(json.load(sys.stdin)["name"])')"
DEST="${1:-./backups}/tendolive-$(date +%Y%m%d-%H%M%S)"
VOLUMES=(n8n_data rag_state studio_saves studio_tenders studio_generations studio_exports studio_uploads studio_templates teams_bot_data)

mkdir -p "$DEST"
for v in "${VOLUMES[@]}"; do
  name="${PROJECT}_${v}"
  if docker volume inspect "$name" >/dev/null 2>&1; then
    docker run --rm -v "$name:/data:ro" -v "$(realpath "$DEST"):/backup" alpine:3.20 \
      tar czf "/backup/$v.tar.gz" -C /data .
    echo "volume $v"
  else
    echo "volume $v: not created yet, skipped"
  fi
done
tar czf "$DEST/knowledge-base.tar.gz" knowledge-base
echo "knowledge-base/"
if [ -f .env ]; then install -m 600 .env "$DEST/env"; echo ".env (mode 600)"; fi
echo "backup written to $DEST"
