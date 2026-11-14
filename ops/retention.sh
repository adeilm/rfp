#!/usr/bin/env bash
# Weekly retention (docs/retention-policy.md): archive expired tenders without a bid decision, delete those archived for
# more than 12 months. Tenders with a "bid" decision are never touched. Prints the counts as JSON.
#
#   ops/retention.sh            apply
#   ops/retention.sh --dry-run  count only, change nothing
# Schedule (crontab of the deploy user, Monday 03:00):  0 3 * * 1  /opt/TendOlive/ops/retention.sh >> /var/log/tendolive-retention.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/.."
DRY=false; [ "${1:-}" = "--dry-run" ] && DRY=true
docker compose exec -T rag python -c "
import json, urllib.request
req = urllib.request.Request('http://127.0.0.1:8001/api/tenders/retention?dry_run=$DRY', method='POST')
print(json.dumps({k: v for k, v in json.load(urllib.request.urlopen(req, timeout=60)).items() if not k.endswith('_ids')}))
"
