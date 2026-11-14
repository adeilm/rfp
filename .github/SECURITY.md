# Security policy

## Reporting a vulnerability

Do not open a public GitHub issue for a security problem. Write to the maintainer privately (repository owner on
GitHub: adeilm) with:
- what is affected (service, route, file),
- how to reproduce it,
- the impact you expect.

I answer within 5 working days and agree on a fix and disclosure date with you.

## Secrets

Never commit a key: `.env` is ignored by git, and `.env.example` keeps every setting with an empty value. If a key
was exposed (commit, chat, screenshot), rotate it at the provider at once.

## Scope and known limits

TendOlive is designed to run on one trusted machine today: the web app and the RAG API have no login. Running it for
several users needs the controls in [docs/production/security.md](../docs/production/security.md) first.
