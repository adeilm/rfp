# ops

Scripts for running TendOlive on a server. Run them from anywhere: each one moves to the repository root itself. They
use `docker compose`, so the stack must be defined (`.env` present); `backup.sh` and `restore.sh` also need `python3`.

| Script | What it does | When |
|---|---|---|
| [backup.sh](backup.sh) `[folder]` | Saves every data volume (n8n, decks, tenders, templates, RAG state, Teams bot), `knowledge-base/` and `.env` into `<folder>/tendolive-<date>/` (default `./backups`). Reads only; the stack can keep running | nightly, and before every upgrade |
| [restore.sh](restore.sh) `<backup folder>` | Stops the stack, replaces each volume and `knowledge-base/` with the backup (the old `knowledge-base/` is kept as `knowledge-base.before-restore/`), starts the stack. Asks you to type `yes` first | after data loss, or to roll back an upgrade |
| [retention.sh](retention.sh) `[--dry-run]` | Archives expired tenders without a bid decision and deletes those archived for more than 12 months; prints the counts. `--dry-run` changes nothing | weekly |

Backups contain `.env` (API keys) and CVs (personal data): `backups/` is ignored by git; store copies encrypted
(Blob Storage, see [docs/production/deployment.md](../docs/production/deployment.md)).

Suggested crontab of the deploy user:

```cron
0 2 * * *  /opt/TendOlive/ops/backup.sh /var/backups/tendolive >> /var/log/tendolive-backup.log 2>&1
0 3 * * 1  /opt/TendOlive/ops/retention.sh >> /var/log/tendolive-retention.log 2>&1
```

Details: [docs/production/operations.md](../docs/production/operations.md),
[docs/retention-policy.md](../docs/retention-policy.md).
