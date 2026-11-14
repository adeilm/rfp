#!/bin/sh
# n8n with the RFP workflows: init (credentials from .env, workflows imported and published when they changed), then n8n itself.
# The deck agents' LLM settings (AGENTS_LLM_BASE_URL / GROQ_API_KEY / GROQ_MODEL, computed from LLM_PROVIDER) reach n8n through a
# pipe and `eval`, never a file or a log. GROQ_BASE_URL is removed: n8n's Groq SDK reads it as its own base and would double
# /openai/v1 in Main's requests.
set -eu

node /opt/rfp/init.js prepare

AGENTS_LLM_EXPORTS="$(node /opt/rfp/init.js env)"
eval "$AGENTS_LLM_EXPORTS"
unset AGENTS_LLM_EXPORTS GROQ_BASE_URL

echo "[rfp-init] starting n8n: editor http://localhost:5679 (published webhooks register now)"
exec /docker-entrypoint.sh "$@"
