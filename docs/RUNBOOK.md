# Runbook: operations and incidents

Copy-oriented guide for whoever is on call for a deployment of this stack.

## Health and readiness

| Check | Command / URL |
| --- | --- |
| Liveness | `GET /api/v1/health` — expect `ok: true` |
| DB connectivity | Same response includes `db: true` when the pool can query |
| Web (Next) | Load `/` — chat shell renders; sidebar fetches documents |

**Kubernetes-style:** use `/api/v1/health` for **liveness**; add a separate **readiness** probe only if you need stricter deps (e.g. migrations finished).

## Logs and metrics

- **Structured logs:** structlog JSON (see `backend/app/core/logging.py`).
- **In-process metrics:** `GET /api/v1/metrics` (JSON) and `GET /api/v1/metrics/prometheus` (text) — counters reset on process restart unless you add external storage.

**Pager trigger examples:**

- Error rate spike on `/api/v1/query` or `/api/v1/query/stream`.
- Health `db: false` for >1 interval.

## Common failures

### Database connection errors

1. Verify **`DATABASE_URL`** and network path.
2. Confirm pgvector extension and schema (`make migrate` / Alembic).
3. Restart API after DB failover (pool may need recycle).

### OpenAI / LLM errors

1. Check **`OPENAI_API_KEY`** and quota.
2. Inspect rate-limit responses (429) — client retries are bounded; back off upstream.

### Stale Next.js eval chunks in dev

From repo root: `rm -rf .next && pnpm dev` (see **DEVELOPMENT.md**).

## Rollback

1. **API:** deploy previous container image / revision; no automatic migration down — forward-only Alembic is assumed.
2. **Frontend:** revert Vercel deployment or previous static build.
3. **Data:** eval and chat data live in Postgres — rollback **code**, not arbitrary tables, unless you restore a snapshot.

## Escalation data to attach

- Request id / `query_log_id` from chat observability.
- Eval **`run_id`** and export JSON if the incident relates to quality regression.
- Time window + graphs from Prometheus if exported.

## Service level objectives (examples)

**Starter SLOs** for a self-hosted API + web UI. Adjust numbers to your user
contract and monitoring stack.

### API availability

| SLI | Target | Window |
| --- | --- | --- |
| **`GET /api/v1/health` success** | 99.9% | 30 rolling days |
| **Non-stream query success** (`POST /api/v1/query` 2xx) | 99.5% | 30 rolling days |
| **Streaming query** (`/api/v1/query/stream` completes without server error) | 99.0% | 30 rolling days |

**Note:** LLM provider outages count toward **dependency** error budgets unless you define an exclusion.

### Latency (p95)

| Route | Example p95 target |
| --- | --- |
| `/api/v1/query` (non-stream, excluding LLM) | < 3 s |
| Time-to-first-token (stream) | < 2 s |

Measure these directly: `/api/v1/metrics` exposes `percentiles` (p50/p95/p99)
per route and per RAG pipeline stage, and `/api/v1/metrics/prometheus` emits
`http_request_latency_ms` / `rag_stage_latency_ms` histograms for
`histogram_quantile()` in Grafana. With `OTEL_ENABLED=true`, per-stage spans in
the trace waterfall show whether a p95 breach is retrieval or generation.

### Error budget policy

When availability falls below target for **7 consecutive days**:

1. Freeze non-critical releases.
2. Focus on reliability work (timeouts, retries, pool sizing, provider fallbacks).

### UI availability

| SLI | Target |
| --- | --- |
| Next.js origin returns **200** for `/` | 99.9% |

Pair with synthetic checks (e.g. every 1–5 minutes) from multiple regions if you serve globally.

### Eval / data pipeline

Not traditionally "SLO'd" like the API, but useful:

| SLI | Target |
| --- | --- |
| Harness run completes and persists (`eval_runs` row) when **`EVAL_PERSIST_RUNS`** is on | 95% of scheduled CI runs |

Track in CI dashboards using artifacts from **[EVAL_CI.md](./EVAL_CI.md)**.
