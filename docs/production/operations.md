# Operations

Day-to-day running of the stack: health, logs, monitoring, backups, restore and incidents. Commands run from the
repository folder on the server.

## 1. Health

| Service | Health check (already in `docker-compose.yml`) | Check by hand |
|---|---|---|
| web | none (static nginx) | `curl -fsS http://127.0.0.1:5173/ >/dev/null` |
| rag | `GET /health` | `curl -fsS http://127.0.0.1:8001/health` |
| proposal-studio | `GET /api/config` | `curl -fsS http://127.0.0.1:8091/api/config` |
| n8n | `GET /healthz/readiness` | `curl -fsS http://127.0.0.1:5679/healthz/readiness` |
| teams-bot | `GET /health` | `curl -fsS http://127.0.0.1:3978/health` |

`docker compose ps` shows `healthy` / `unhealthy` for each. Every service has `restart: unless-stopped`.

## 2. Logs

```bash
docker compose logs --since 1h n8n rag proposal-studio teams-bot   # recent logs
docker compose logs -f n8n                                          # follow one service
```

Docker keeps logs in the container; limit their size in production (`/etc/docker/daemon.json`:
`{"log-driver": "json-file", "log-opts": {"max-size": "20m", "max-file": "5"}}`) or ship them to the company's log
platform (Loki, Azure Monitor, Elastic).

Where to look:

| Question | Where |
|---|---|
| Did the weekly tender run work? How many tenders, failures, LLM errors? | n8n editor → Executions → **RFP - Main**; its **Run Summary** node (and the alert e-mail / Teams card when configured) |
| Why did a deck fail or stay queued? | The web app's deck run (steps and error), `GET /api/generations/<runId>` on the studio, n8n Executions of **RFP 00 Main** |
| A wrong requirement status | The tender's Requirements tab (method, evidence, note); `docs/rag-service.md` for how matching decides |
| Teams bot does not answer | `docker compose logs teams-bot`, [../teams-bot.md](../teams-bot.md) §11 |

## 3. Monitoring and alerts (to set up)

Not in the repository today; recommended minimum:

| Watch | How | Alert when |
|---|---|---|
| Public URLs up | Uptime checker (UptimeRobot, Azure Monitor) on `https://app.<domain>`, `/health` routes through the proxy | down 5 min |
| Containers healthy | Cron every 5 min: `docker compose ps --format '{{.Name}} {{.Health}}'` | any `unhealthy` |
| Weekly run succeeded | n8n's error workflow (**RFP 90 Error handler**) and the Run Summary e-mail / Teams alert (`TEAMS_NOTIFY=true`) | failed execution, or "failed calls" > 0 |
| LLM quota | Run Summary and deck runs report quota errors ("quota du fournisseur IA atteint") | any quota error: raise the tier or move a stage to another provider |
| Disk | `df -h` | > 80 % used |
| Backups | The backup job's exit code | any failure, or no new backup for 26 h |

## 4. Backups

Data that cannot be rebuilt:

| Data | Where | Content |
|---|---|---|
| `knowledge-base/` (folder) | bind-mounted into `rag` | CVs, projects, tech stacks, clients, tools, `pricing/pricing.json`, CVs added from the app |
| `n8n_data` | volume | n8n database: workflows, **credentials (encrypted with the key in this volume)**, executions, owner account |
| `studio_saves`, `studio_tenders`, `studio_generations`, `studio_exports`, `studio_uploads`, `studio_templates` | volumes | decks, tender inbox, deck runs, exported files, uploads, imported templates |
| `rag_state` | volume | analysed tenders, bid decisions |
| `teams_bot_data` | volume | Teams conversation references, alert channel |
| `.env` | file | keys and settings |

`rag_index` is not backed up: the index is rebuilt from `knowledge-base/` at start.

```bash
ops/backup.sh /srv/backups          # writes /srv/backups/tendolive-<date>/ (one archive per volume, knowledge-base, env)
```

Schedule it nightly and copy the folder off the server (it contains `.env` and personal data: encrypted storage only):

```cron
30 2 * * * cd /opt/TendOlive && ops/backup.sh /srv/backups >> /var/log/tendolive-backup.log 2>&1
```

Keep 7 daily and 4 weekly copies. The archives are written by root (the copy runs in a container).

## 5. Restore

```bash
ops/restore.sh /srv/backups/tendolive-20261101-023000
```

It asks for confirmation, stops the stack, replaces each volume found in the backup, restores `knowledge-base/` (the
current one is kept as `knowledge-base.before-restore/`), and starts the stack again. `.env` is not restored
automatically. **Test a restore on a spare machine once a quarter**: a backup that was never restored is not a backup.

## 6. Incident runbook

| Symptom | Likely cause | Action |
|---|---|---|
| Web app shows "The RAG service is not reachable" | `rag` restarting or rebuilding its index after a knowledge-base change | `docker compose logs rag`; wait for `healthy` (a few minutes) |
| n8n restarts in a loop | invalid `.env` value | `docker compose logs n8n` shows a `CONFIGURATION ERROR` line naming it |
| Weekly run finds no tenders | source API down, `FIRECRAWL_KEY` expired, or every tender filtered | Run Summary of the last execution: failed calls per source |
| Market studies / decks fail with 429 or quota errors | LLM tier exhausted | raise the tier, or set `LLM_PROVIDER` / `DECK_LLM_PROVIDER` to different providers; `docker compose up -d --force-recreate n8n proposal-studio` |
| Deck generation stays queued or returns 502 | n8n webhooks not published | start n8n once with `RFP_FORCE_IMPORT=1` |
| Deck run stuck at one step | the n8n execution was lost (n8n restarted during it) | start the deck again from the tender's Proposal tab |
| Teams bot silent | bot registration secret expired, or `BOT_*` empty | [../teams-bot.md](../teams-bot.md) §11; renew the client secret in Azure |
| Disk full | exports and executions accumulate | delete old exports; n8n: set `EXECUTIONS_DATA_PRUNE=true`, `EXECUTIONS_DATA_MAX_AGE=336` |

After an incident: note what happened, the cause and the fix in the team's tracker, and add a test when the cause was
a code defect.
