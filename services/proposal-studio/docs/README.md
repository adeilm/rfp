# Documentation index

Who should read what. **Getting started** = installing and running the studio. **Agent builder** =
builds an n8n agent that sends slides to the editor. **Platform developer** = changes the
editor or the server.

| Document | What it covers | Read it if you are |
|---|---|---|
| [`../START_HERE.md`](../START_HERE.md) | First steps: install, start, send a deck with curl, slide rules | Getting started, agent builder |
| [`../README.md`](../README.md) | Full reference: project layout, install, environment variables, API with curl, deck spec, troubleshooting, limitations | Everyone (reference) |
| [`N8N_SETUP.md`](N8N_SETUP.md) | Install n8n, reach the editor from Docker, credentials, Groq setup | Agent builder |
| [`../tests/inputs/README.md`](../tests/inputs/README.md) | The five fake tender inputs and what each one tests | Agent builder |
| [`../workflows/README.md`](../workflows/README.md) | Where and how to export n8n workflows (never with credentials) | Agent builder |
| [`DESIGN_LOG.md`](DESIGN_LOG.md) | Historical design log of phases 0 to 6 | Platform developer |
| [`../CHANGELOG.md`](../CHANGELOG.md) | What changed in every phase and in v1.0.0 | Platform developer |


## Agent System Documentation

| Document | What it covers | Read it if you are |
|---|---|---|
| [`agents/CONTRACTS.md`](agents/CONTRACTS.md) | Agent output contracts, deck spec, block kinds, validation rules | Agent builder |
| [`agents/RUNBOOK.md`](agents/RUNBOOK.md) | Operations guide: configuration, startup, troubleshooting, monitoring, security | Agent builder, operator |
| [`agents/EVAL_REPORT.md`](agents/EVAL_REPORT.md) | System evaluation, test results, production readiness, recommendations | Project lead, operator |
| [`agents/PLATFORM_FACTS.md`](agents/PLATFORM_FACTS.md) | Platform behavior verification results | Agent builder, platform developer |
| [`../agents/prompts/`](../agents/prompts/) | System prompts for all 6 agents (agent1-6.md) | Agent builder, LLM engineer |
| [`agents/N8N_WORKFLOWS.md`](agents/N8N_WORKFLOWS.md) | The nine n8n workflows: Docker setup, variables, credentials, import, publish, verified results | Agent builder, operator |
| [`SETUP_GUIDE.md`](SETUP_GUIDE.md) | Full setup on a new machine: platform, n8n agents, keys, templates, tenders, prices, troubleshooting | Getting started, operator |
