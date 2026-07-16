# Grafana

Two dashboards live next to this folder:

- [`grafana-rag-eval-prometheus.json`](../grafana-rag-eval-prometheus.json) — API metrics (requests, latency, tokens). Datasource UID `prometheus`.
- [`grafana-rag-eval-traces.json`](../grafana-rag-eval-traces.json) — RAG pipeline **trace waterfall** (recent traces table + span waterfall). Datasource type `tempo`.

## Import in the UI

1. Grafana → **Dashboards** → **New** → **Import**.
2. Upload the dashboard JSON.
3. Choose your Prometheus (metrics) or Tempo (traces) datasource when prompted.

## Provisioning (Docker / Kubernetes)

Use the files under `provisioning/`:

| Mount (container path) | Source file |
|------------------------|-------------|
| `/etc/grafana/provisioning/datasources/datasource.yaml` | `provisioning/datasources/datasource.yaml` |
| `/etc/grafana/provisioning/dashboards/default.yaml` | `provisioning/dashboards/default.yaml` |
| `/etc/grafana/dashboards/rag-eval.json` | `../grafana-rag-eval-prometheus.json` |
| `/etc/grafana/dashboards/rag-eval-traces.json` | `../grafana-rag-eval-traces.json` |

Edit `datasource.yaml` so `url` points at your Prometheus (`prometheus:9090`) and Tempo (`tempo:3200`). The dashboard provider reads all JSON from `/etc/grafana/dashboards`.

## Run the whole stack locally (verify traces end to end)

An overlay brings up Tempo + Prometheus + Grafana wired to the API, turns on
OpenTelemetry, and installs the `otel` extra automatically:

```bash
export OPENAI_API_KEY=sk-...   # real key: /query calls embeddings + chat
docker compose -f docker-compose.yml -f docker-compose.observability.yml up --build
```

Then generate a trace and open the waterfall:

```bash
# Fire a query — response includes request_id + query_log_id; the api logs
# print the matching trace_id.
curl -s localhost:8000/api/v1/query \
  -H 'content-type: application/json' \
  -d '{"query":"what is RAG?","top_k":5}' | jq '{request_id, query_log_id}'
```

1. Open Grafana at **http://localhost:3001** (anonymous admin, no login).
2. **Dashboards → RAG Eval — Traces (Tempo waterfall)**.
3. The **recent-traces** table lists the query — click its **Trace ID** to see
   the `rag.retrieve → openai.embedding / db.vector_search → rag.generate →
   openai.chat` waterfall, or paste the `trace_id` into the `traceId` variable.

Ports: API `8000`, Grafana `3001`, Prometheus `9090`, Tempo `3200` / OTLP
`4318`. Add `--profile full` to also run the Next.js UI on `3000`. Tear down
with `docker compose -f docker-compose.yml -f docker-compose.observability.yml
down -v`.

> Without a valid `OPENAI_API_KEY` the query errors, but the trace still
> exports with the failing span marked ERROR — useful to verify instrumentation
> even offline.

## Traces (waterfall)

`datasource.yaml` provisions a **Tempo** datasource (uid `tempo`). Run the backend with `OTEL_ENABLED=true` (`cd backend && uv sync --extra otel`) and set `OTEL_EXPORTER_OTLP_ENDPOINT` to your collector so spans reach Tempo.

The **RAG Eval — Traces** dashboard has:

1. a **recent-traces table** (slowest first) filtered by `$service` (defaults to `OTEL_SERVICE_NAME` = `rag-eval-backend`) — click a **Trace ID** to open its waterfall;
2. a **trace waterfall** panel pinned to the `$traceId` variable — paste an id from the app (logged as `trace_id`, shared with the request's `query_log_id`).

The waterfall shows one span per pipeline stage — `rag.retrieve` → `openai.embedding` / `db.vector_search` → `rag.generate` → `openai.chat` — with `gen_ai.*` token/model attributes, so a slow or expensive query is diagnosable end to end.

## Metrics reference

Scraped from `GET /api/v1/metrics/prometheus`:

| Metric | Type | Labels | Use |
|--------|------|--------|-----|
| `http_requests_total` | counter | `route`, `status` | Request/error rate |
| `http_request_latency_ms` | histogram | `route` | `histogram_quantile(0.95, sum by (le,route) (rate(http_request_latency_ms_bucket[5m])))` |
| `rag_stage_latency_ms` | histogram | `stage` | Per-stage p95 (`retrieve`, `embedding`, `chat_completion`, …) — shows whether latency is retrieval or generation |
| `openai_tokens_*` | counter | — | Token spend |

For a full per-request trace waterfall (server → `rag.retrieve` → `openai.embedding` / `db.vector_search` → `rag.generate` → `openai.chat`), run the backend with `OTEL_ENABLED=true` (`uv sync --extra otel`) and point `OTEL_EXPORTER_OTLP_ENDPOINT` at Tempo/Jaeger. Logs carry the matching `trace_id`.
