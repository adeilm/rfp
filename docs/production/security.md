# Security

What each part of TendOlive trusts today, what that means in production, and the controls to add. The short version:
**today the system assumes it runs on one trusted machine**; before other people use it, put it behind SSO
([deployment.md](deployment.md) §4) and complete the code changes of [README.md](README.md).

## 1. Who can do what today

| Component | Authentication today | Exposure today | Production control |
|---|---|---|---|
| Web app (5173) | none: every visitor is "OliveSoft admin" | 127.0.0.1 only | SSO (Entra ID) in front, then in-app login and roles (roadmap) |
| RAG API (8001) | none; CORS limited to the web app's origin | 127.0.0.1 only | never published; reached only through the web container and n8n; add a key or SSO identity on write routes (roadmap) |
| Proposal studio (8091) | `X-API-Key: STUDIO_API_KEY` on deck creation and the inbox; the editor routes have none | 127.0.0.1 only | behind SSO; editor reachable only by the bid team |
| n8n (5679) | owner account (created on first visit) | 127.0.0.1 only | behind SSO and its own login; admins only |
| Deck webhooks (n8n) | `AGENTS_WEBHOOK_KEY` header | internal network | unchanged |
| Teams bot (3978) | Microsoft Bot Framework JWT on `/api/messages`; Entra tenant; `TEAMS_ALLOWED_USERS` / `TEAMS_APPROVER_USERS`; `BOT_NOTIFY_KEY` on `/notify` | 127.0.0.1 only | public through the proxy (required by Teams); keep the allow-lists filled; `BOT_TEST_MODE=0` |

## 2. Secrets

| Secret | Used by | Rotate |
|---|---|---|
| `STUDIO_API_KEY`, `AGENTS_WEBHOOK_KEY`, `BOT_NOTIFY_KEY` | service to service | yearly, or when someone leaves |
| `GROQ_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY` | LLM calls | at once if exposed (they are billed) |
| `FIRECRAWL_KEY`, `GCP_BILLING_API_KEY` | portal reading, GCP prices | yearly |
| `BOT_APP_PASSWORD` | Teams bot (Entra client secret) | before it expires (Azure sets 6-24 months) |
| n8n credentials | stored in `n8n_data`, encrypted with the key in the same volume | with the keys above (they are written by `n8n/init/init.js` from `.env`) |

Rules:
- `.env` is never committed (`.gitignore`); `.env.example` carries the names with empty values. On the server:
  `chmod 600 .env`, owned by the deploy user.
- In production, prefer a secret store (Azure Key Vault, or Docker secrets) that writes `.env` at deploy time.
- A key pasted in a chat, ticket or screenshot is exposed: rotate it the same day.
- Backups contain `.env`: store them encrypted ([operations.md](operations.md) §4).

## 3. Network

- Only the reverse proxy listens on the public interface (443). Every container port stays bound to 127.0.0.1
  (already the case in `docker-compose.yml`).
- Outbound traffic: LLM providers, BOAMP / TED / DECP / registry APIs, Firecrawl, Azure Retail Prices, ECB, OpenRouter,
  Google Cloud Billing, Microsoft Bot Framework. Restrict egress to these if the company firewall allows it.
- `demo-tenders` is a test service: do not start it in production.

## 4. Personal data (GDPR)

The knowledge base holds CVs: names, career history, certifications, sometimes contact details. Tender research
stores buyer contact data from public registries.

| Requirement | State | To do |
|---|---|---|
| Purpose and legal basis | CVs are used to answer tenders (legitimate interest of OliveSoft, employees informed) | write it in OliveSoft's record of processing |
| Minimisation | only CVs of staff who may be proposed; demo records are fictional | do not add CVs of people who left; no LinkedIn exports of third parties (removed from the repository on 2026-10-30) |
| Access | anyone reaching the web app sees every CV | SSO, then roles (roadmap) |
| Deletion | by hand: delete the PDF and its `.profile.json` in `knowledge-base/cvs/`, then reindex | a delete button with audit (roadmap) |
| Transfer to LLM providers | tender text and short CV / project facts are sent to the LLM chosen in `.env` | choose a provider with an EU data processing agreement; Ollama keeps everything local |
| Retention | none set | e.g. CVs of former staff deleted within 1 month; executions in n8n pruned after 14 days |

## 5. Threat model (main risks)

| Threat | Impact | Mitigation in place | To add |
|---|---|---|---|
| Unauthenticated access to the app | read CVs, change prices, delete tenders | localhost binding | SSO, roles |
| Prompt injection in a tender text ("ignore your instructions") | wrong analysis or deck text | tender text is wrapped as data for the LLMs; facts (prices, references, quotes) are checked by code; an injection test input exists in the studio's tests | keep the code checks; human review before export (enforced: pricing approval) |
| Malicious SVG / HTML in a generated diagram | script in the editor | `scanSVGSecurity` rejects scripts, event handlers and `javascript:` URLs; Mermaid renders with `securityLevel: strict` | — |
| Malicious uploaded CV or template | parser exploit | PDFs only, 10 MB limit, parsed by pypdf; templates parsed by python-pptx | antivirus scan of uploads if required by policy |
| LLM key leak | billed usage | keys only in `.env` | secret store, spending limits on the provider account |
| Data loss | lost decks, decisions, workflows | — | nightly backups and restore tests ([operations.md](operations.md)) |

## 6. Reporting a vulnerability

See [.github/SECURITY.md](../../.github/SECURITY.md) (shown in the GitHub repository's Security tab).
