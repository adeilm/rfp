# Production readiness

TendOlive runs today as a **local, single-user system** (`docker compose` on one machine, every port bound to
127.0.0.1). This folder documents how it would run in production for OliveSoft: what is already in place, what must
change in the code first, and how to deploy, secure, operate and use it.

| Document | For | Content |
|---|---|---|
| [deployment.md](deployment.md) | Ops / IT | Azure architecture (Mermaid), OliveSoft-only sign-in, services and costs, step-by-step walkthrough, upgrades, version 2 |
| [security.md](security.md) | Security / IT | What each service trusts today, secrets, network exposure, personal data (CVs, GDPR), threat model |
| [operations.md](operations.md) | Ops | Health checks, logs, monitoring, backup and restore of every volume, incident runbook |
| [user-guide.md](user-guide.md) | OliveSoft bid team | Daily use: tenders, bid decision, deck review and export, pricing, knowledge base, Teams bot |
| [../retention-policy.md](../retention-policy.md) | Ops / DPO | What is archived, deleted and kept, and why (tenders, n8n history, exports, CVs, backups) |

## Status at a glance

| Area | Today | Production needs |
|---|---|---|
| Hosting | One machine, `docker compose`, ports on 127.0.0.1 | One VM (or more) behind an HTTPS reverse proxy, real host names |
| Users | No login on the web app; anyone reaching port 5173 is the "OliveSoft admin" | Single sign-on (Microsoft Entra ID, like the Teams bot) and roles |
| API protection | Studio deck routes need `STUDIO_API_KEY`; the RAG API has none; n8n has its owner login | Every API behind the proxy's authentication; RAG and studio never exposed directly |
| Addresses | `localhost` written in `docker-compose.yml` (web build, CORS, n8n webhook URL, editor URL) | One public base URL per service, from `.env` |
| Secrets | `.env` file on disk | A secret store (Azure Key Vault, or Docker secrets) and rotation |
| Data | Docker volumes + the `knowledge-base/` folder | Nightly backups, tested restore, retention |
| Monitoring | Container health checks, `docker compose logs` | Uptime checks, log shipping, alerts on failed runs and LLM quota errors |
| Tests | CI on every push (pipeline, deck agents, web build) | Same, plus the RAG and studio Python suites in CI and a deploy job |
| LLM | Groq / Gemini / OpenAI / Ollama keys per `.env` | A paid tier with quotas sized for the tender volume (free tiers rate-limit market studies) |

## What must change in the code before production

These are code changes, not configuration. They are listed here as the roadmap; none of them is done.

1. **Authentication on the web app.** Add Entra ID sign-in (MSAL in the React app) or put the whole site behind the
   reverse proxy's OpenID Connect (oauth2-proxy). Today the app trusts anyone who can reach it.
2. **Authentication on the RAG API.** Its write routes (`PUT /api/pricing`, `POST /api/cvs`, `POST /api/records`,
   `DELETE /api/tenders`) have no key. Require a key or the proxy's identity on every route.
3. **Configurable public URLs.** Replace the `localhost` values in `docker-compose.yml` (`VITE_STUDIO_URL`,
   `VITE_N8N_URL`, `RAG_CORS_ORIGINS`, `PUBLIC_EDITOR_URL`, `N8N_EDITOR_BASE_URL`, `WEBHOOK_URL`, the demo feed links)
   with `.env` variables. The web app reads two of them at build time, so the image is built per environment.
4. **Audit trail.** Record who decided bid / no-bid, approved the pricing and exported a deck (today: the time only).
5. **Automatic backups** (see [operations.md](operations.md)): a scheduled job, not a manual command. The tender
   retention job is written ([../retention-policy.md](../retention-policy.md)) but must also be scheduled.
6. **Personal data handling.** A retention rule for CVs and a way to delete a person's CV from the app (today a CV can
   only be removed by hand from `knowledge-base/cvs/`).

## Already production-minded

- Facts are checked by code: prices, references and quotes cannot be invented by an LLM (see the evaluation report).
- Every service has a health check and `restart: unless-stopped`.
- Secrets are only in `.env` (ignored by git); `.env.example` documents every setting with empty values.
- The Teams bot already authenticates users with Entra ID and restricts actions to listed approvers.
- CI runs on every push to `main`.
