#!/usr/bin/env bash
# Restore a backup written by ops/backup.sh. Replaces the current data: run it only on purpose.
#
#   ops/restore.sh <backup folder>            e.g. ./backups/tendolive-20261101-020000
# Stops the stack, empties each backed-up volume and fills it from the archive, restores knowledge-base/ (the current
# folder is kept as knowledge-base.before-restore), then starts the stack. .env is not restored automatically: copy
# <backup>/env to .env yourself if the keys changed.
set -euo pipefail
cd "$(dirname "$0")/.."

SRC="${1:?usage: ops/restore.sh <backup folder>}"
[ -d "$SRC" ] || { echo "no such folder: $SRC" >&2; exit 1; }
PROJECT="$(docker compose config --format json | python3 -c 'import sys, json; print(json.load(sys.stdin)["name"])')"

read -r -p "Replace the current TendOlive data with $SRC? Type yes: " answer
[ "$answer" = "yes" ] || { echo "cancelled"; exit 1; }

docker compose stop
for archive in "$SRC"/*.tar.gz; do
  v="$(basename "$archive" .tar.gz)"
  [ "$v" = "knowledge-base" ] && continue
  name="${PROJECT}_${v}"
  docker volume create "$name" >/dev/null
  docker run --rm -v "$name:/data" -v "$(realpath "$SRC"):/backup:ro" alpine:3.20 \
    sh -c "find /data -mindepth 1 -delete && tar xzf /backup/$v.tar.gz -C /data"
  echo "volume $v restored"
done
if [ -f "$SRC/knowledge-base.tar.gz" ]; then
  rm -rf knowledge-base.before-restore && mv knowledge-base knowledge-base.before-restore
  tar xzf "$SRC/knowledge-base.tar.gz"
  echo "knowledge-base/ restored (previous copy: knowledge-base.before-restore/)"
fi
docker compose up -d
echo "restored; check docker compose ps"
