# Data retention policy

TendOlive does not delete data to save disk space: a stored tender is a few KB of JSON, and storage is not the issue.
It archives what is no longer actionable and deletes what it should not keep, for **clarity** (the Tenders list shows
only live tenders) and **privacy** (tenders hold buyer contact data). What actually grows is the n8n execution history,
which is pruned.

| Data | Rule | Why | Where |
|---|---|---|---|
| Tender, deadline passed, no "bid" decision | **Archived** (hidden from the Tenders list, kept) | the history is useful: which buyers publish what, why OliveSoft declined (no-bid reasons), market data for later studies | `apply_retention()` in [services/rag/rag/tenders.py](../services/rag/rag/tenders.py) |
| Archived tender | **Deleted 12 months after archiving** | buyer contact data: keep it only as long as it is useful (GDPR minimisation) | same |
| Tender with a "bid" decision | **Never archived nor deleted** by the job | it is (or was) a live bid | same |
| Tender without a readable deadline | **Never archived** | the job cannot know it is over | same |
| n8n execution history | **Deleted after 14 days** (`EXECUTIONS_DATA_MAX_AGE=336` hours) | the main thing that grows (about 25 MB after a few weeks of runs); old executions are only needed to debug recent runs | n8n's own pruning, `docker-compose.yml` |
| Deck exports (PPTX / PDF files) | **Deleted after 24 hours** | they can be exported again from the deck at any time | `_cleanup_old_exports()` in the studio, already in place |
| Decks | **Kept** as long as their tender is kept | they are the work product | — |
| CVs | **Kept while the person works at OliveSoft**; deleted by hand when they leave (PDF and its `.profile.json` in `knowledge-base/cvs/`, then reindex) | personal data | see [production/security.md](production/security.md) §4 |
| Backups | **30 days** | covers a month of mistakes | [ops/backup.sh](../ops/backup.sh), storage lifecycle rule |

## How it runs

Weekly, Monday 03:00, from the server's crontab:

```cron
0 3 * * 1  /opt/TendOlive/ops/retention.sh >> /var/log/tendolive-retention.log 2>&1
```

[ops/retention.sh](../ops/retention.sh) calls the RAG service's `POST /api/tenders/retention` and logs one JSON line:
`{"date": "...", "dry_run": false, "archived": 3, "deleted": 0}`. `ops/retention.sh --dry-run` counts without
changing anything: run it once before the first real run.

## Archived tenders

- `GET /api/tenders` hides them (default `archived=exclude`); `GET /api/tenders?archived=only` lists them,
  `?archived=include` lists everything.
- `POST /api/tenders/<id>/unarchive` brings one back (for example a tender whose deadline was extended).
- A tender sent again by the pipeline is stored again as received (the pipeline drops expired notices on intake, so an
  expired tender is not sent again).
- The web app does not have an "Archived" tab yet: the archive is reached through the API.

## Status

Written on 2026-11-01. Not yet run on real data, and no automated test covers it yet: run
`ops/retention.sh --dry-run` and check the counts before scheduling it.
