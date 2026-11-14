# Workflows Directory

This directory stores the exported n8n agent workflow JSON files.

**Security Warning**: NEVER include credentials, API keys, webhook secrets, or private tokens inside exported workflow JSON files.

## Agent workflows (generated)

`00_main.json` to `90_error_handler.json` are generated from `agents/lib/` by
`npm run workflows:generate`; do not edit them in n8n. Import all nine, publish all nine
(n8n 2 requires it for sub-workflows), and set the environment variables listed in
[`docs/agents/N8N_WORKFLOWS.md`](../docs/agents/N8N_WORKFLOWS.md). Custom versions go in
`workflows/custom/` and are never overwritten.
