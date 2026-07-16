# Documentation index

Start at the [project README](../README.md) for the overview and Quick Start.
This index maps every doc so you can find the right one fast.

## Get started

| Doc | What it covers |
| --- | --- |
| [README → Quick Start](../README.md#quick-start) | Fastest path (Docker Compose) and manual dev setup |
| [DEVELOPMENT.md](../DEVELOPMENT.md) | Full local workflow — Postgres, migrate, seed, API, web, tests, Playwright, Alembic |
| [ENV_VARS.md](../ENV_VARS.md) | Every environment variable, backend and frontend |

## Understand the product

| Doc | What it covers |
| --- | --- |
| [THESIS.md](./THESIS.md) | The product argument — eval regression as a first-class workflow |
| [OBSERVABILITY.md](./OBSERVABILITY.md) | Pipeline tracing + latency percentiles (Tempo + Prometheus + Grafana) |
| [BENCHMARKS.md](./BENCHMARKS.md) | Reproducible eval harness procedure + case-study template |
| [API_CONTRACT.md](./API_CONTRACT.md) | HTTP API contract specification |
| [backend/README.md](../backend/README.md) | Backend service internals |

## Ship & operate

| Doc | What it covers |
| --- | --- |
| [DEPLOYMENT.md](../DEPLOYMENT.md) | Production deployment (Vercel + container backend + Postgres) |
| [AZURE_DEPLOY.md](./AZURE_DEPLOY.md) | Azure Container Apps path (optional/legacy) |
| [RUNBOOK.md](./RUNBOOK.md) | Health checks, incidents, rollback, escalation, and example SLOs |
| [EVAL_CI.md](./EVAL_CI.md) | Eval exports, CI artifacts, and the regression gate |

## Security & hardening

| Doc | What it covers |
| --- | --- |
| [HARDENING.md](./HARDENING.md) | `API_KEY`, rate limits, CORS, multi-tenant posture, and the threat model |
| [SECURITY.md](../SECURITY.md) | Security policy and vulnerability reporting |

## Contribute

| Doc | What it covers |
| --- | --- |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | How to propose changes, run checks, open a PR |
| [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md) | Community standards |
