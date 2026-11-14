# Documentation index

Start with the [repository README](../README.md) (what TendOlive does, screenshots, quick start), then pick by need.

## Understand the system

| Document | Content |
|---|---|
| [architecture.md](architecture.md) | The services, every node and data flow of the pipeline, the RAG service internals |
| [n8n-pipeline.md](n8n-pipeline.md) | What the tender pipeline does: its three agents, the code checks, the proposal input |
| [rag-service.md](rag-service.md) | Data modes, adding company knowledge (records, Add CV), how matching decides |
| [integration-and-api.md](integration-and-api.md) | Contracts between services; API reference of the RAG, the studio and the n8n webhooks |
| [teams-bot.md](teams-bot.md) | The Microsoft Teams bot: architecture, setup, commands, security, simulator |

## Results and quality

| Document | Content |
|---|---|
| [evaluation-report.md](evaluation-report.md) | **Start here for results:** benchmark, end-to-end runs, deck quality, tests, coverage of the brief, limitations |
| [rag-benchmark.md](rag-benchmark.md) | RAG evaluation: method, ablation, failure analysis, independent evaluation on unseen tenders, recall analysis |
| [edge-cases.md](edge-cases.md) | The pipeline's edge-case suite and the gaps it found |
| [../tests/README.md](../tests/README.md) | Every test suite and its command |
| [samples/](samples/) | A generated deck: [PPTX](samples/sample-deck.pptx), [PDF](samples/sample-deck.pdf) |
| [screenshots/](screenshots/) | Web app, deck slides and n8n workflows ([workflows/](screenshots/workflows/)) |

## Run it in production

| Document | Content |
|---|---|
| [production/README.md](production/README.md) | Production readiness: today vs production, the code changes still needed |
| [production/deployment.md](production/deployment.md) | Azure architecture, OliveSoft-only sign-in, services and costs, walkthrough, upgrades |
| [production/security.md](production/security.md) | Access per service, secrets, network, personal data (GDPR), threat model |
| [production/operations.md](production/operations.md) | Health checks, logs, monitoring, backup and restore, incidents |
| [production/user-guide.md](production/user-guide.md) | Daily use by the bid team |
| [retention-policy.md](retention-policy.md) | What is archived, deleted and kept, and why |
| [../ops/README.md](../ops/README.md) | Backup, restore and retention scripts |
| [../.github/SECURITY.md](../.github/SECURITY.md) | Reporting a vulnerability |

## Components

| Document | Content |
|---|---|
| [../apps/web/README.md](../apps/web/README.md) | The web app |
| [../services/rag/README.md](../services/rag/README.md) | The RAG service |
| [../n8n/README.md](../n8n/README.md) | The n8n workflows and their canvases |
| [../services/proposal-studio/README.md](../services/proposal-studio/README.md) | The proposal studio (standalone documentation) |
| [../services/proposal-studio/docs/agents/EVAL_REPORT.md](../services/proposal-studio/docs/agents/EVAL_REPORT.md) | The deck agents' own evaluation report |

## Working notes and assets

| Folder | Content |
|---|---|
| [design/](design/) | Design notes ([Real_Data_Integration.md](design/Real_Data_Integration.md)) |
| [presentation/](presentation/) | Presentation notes ([Knowledge_Base_Guide.md](presentation/Knowledge_Base_Guide.md), [RAG_progress_notes.md](presentation/RAG_progress_notes.md)) |
| [team/](team/) | Team notes ([README_agents.md](team/README_agents.md), [tender_pipeline_summary.md](team/tender_pipeline_summary.md)) |
| [brand/](brand/) | TendOlive logos and icons |
