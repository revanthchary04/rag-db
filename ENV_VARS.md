# Environment Variables Reference

## Frontend (Vercel)

### Required (Server-Side Only - No NEXT*PUBLIC* prefix)

```env
BACKEND_API_BASE_URL=https://your-azure-container-apps-url
```

**Example:**

```env
BACKEND_API_BASE_URL=https://your-backend.onrender.com
```

**Where to set:** Vercel Dashboard → Project → Settings → Environment Variables

**Note:** The frontend now proxies requests through Vercel API routes (`/api/backend/*`), so the backend URL is server-side only and doesn't need the `NEXT_PUBLIC_` prefix. This avoids mixed content and CORS issues.

### Optional: Backend API key (proxy injects header)

If the FastAPI app has `API_KEY` set (see backend section), browsers never see that secret. Add the same value on Vercel so the server-side proxy can attach it:

```env
BACKEND_API_KEY=your-shared-secret
```

The Next.js route forwards this as `X-API-Key` on every proxied request. Leave unset for local dev when the backend has no `API_KEY`.

### Required: Auth.js + chat persistence (Drizzle)

The chat UI uses Auth.js (guest + email/password) and persists chats via Drizzle
into the **same Postgres** the backend uses.

```env
# Auth.js signing secret — generate with: openssl rand -base64 32
AUTH_SECRET=your-32-byte-secret

# Postgres for Drizzle (chat/auth tables). Same DB as the backend's DATABASE_URL;
# POSTGRES_URL is preferred, DATABASE_URL is the fallback.
POSTGRES_URL=postgresql://user:pass@host:5432/ragdb
```

Apply the Drizzle chat/auth tables with `pnpm db:migrate` (additive — it does not
touch the backend's `documents`/`chunks`/`queries`/`eval_*` tables).

---

## Backend (Azure Container Apps)

### Required Variables

```env
# Database (Neon DB connection string)
DATABASE_URL=postgresql://user:password@host:5432/database?sslmode=require

# OpenAI API Key (MARK AS SECURE)
OPENAI_API_KEY=sk-...

# Environment
ENVIRONMENT=production

# CORS - Include your Vercel URL (comma-separated)
CORS_ALLOW_ORIGINS=https://your-vercel-app.vercel.app,https://your-vercel-app-git-main-username.vercel.app
```

### Optional Variables (with defaults)

```env
# OpenAI Models
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
OPENAI_CHAT_MODEL=gpt-4o-mini
EMBEDDING_DIMENSION=1536

# OpenAI API Settings
OPENAI_MAX_RETRIES=3
OPENAI_TIMEOUT=60

# Rate Limiting
RATE_LIMIT_REQUESTS=100
RATE_LIMIT_WINDOW=60

# Redis (for distributed rate limiting - optional)
REDIS_URL=redis://redis-host:6379/0
REDIS_ENABLED=false

# Chunking Configuration
CHUNK_SIZE=1000
CHUNK_OVERLAP=200

# Ingest preprocessing (cleaner chunks from noisy PDF/DOCX extraction)
# Collapse runs of more than N newlines down to N (2 keeps a single blank line between blocks).
INGEST_COLLAPSE_BLANK_LINES_TO=2
# Drop consecutive duplicate paragraphs (same trimmed text).
INGEST_DEDUPE_CONSECUTIVE_PARAGRAPHS=true
# Merge chunks shorter than this into neighbors when combined size stays under soft cap.
INGEST_MIN_CHUNK_CHARS=80
# Max merged chunk size ≈ CHUNK_SIZE × this ratio (then embeddings).
INGEST_MERGED_CHUNK_SOFT_CAP_RATIO=1.35

# Adaptive chunk size (per ingest, from preprocessed length). Uses CHUNK_SIZE / CHUNK_OVERLAP as defaults when off.
INGEST_ADAPTIVE_CHUNKING=true
INGEST_ADAPTIVE_CHUNK_MIN=400
INGEST_ADAPTIVE_CHUNK_MAX=2000
INGEST_ADAPTIVE_OVERLAP_RATIO=0.2

# Request Limits
MAX_INGEST_PAYLOAD_SIZE=10485760
# Max decoded size for optional PDF attached at ingest (`original_file_base64`), for UI preview
MAX_INGEST_ORIGINAL_FILE_BYTES=26214400
MAX_QUERY_LENGTH=5000
MAX_CONTEXT_CHARS=50000
MAX_CONTEXT_TOKENS=12000

# Postgres chat threads/messages (`/api/v1/chat/*`). When > 0, threads older than N calendar days are pruned on list/create.
CHAT_RETENTION_DAYS=0

# Chat messages can store request_id / query_log_id (joins queries.id) plus optional eval_run_id / eval_case_id for harness correlation.
# Non-stream POST /query and streaming ``done`` events include request_id and query_log_id when audit logging succeeds.

# Server Configuration
HOST=0.0.0.0
PORT=8000

# Optional: require X-API-Key or Authorization: Bearer on all /api/v1/* routes
# except /health and /metrics (empty = disabled)
API_KEY=

# OpenTelemetry (install: cd backend && uv sync --extra otel)
OTEL_ENABLED=false
OTEL_SERVICE_NAME=rag-eval-backend
# Standard OTLP HTTP env vars, for example:
# OTEL_EXPORTER_OTLP_ENDPOINT=https://your-collector:4318/v1/traces
```

### Metrics and streaming

- `GET /api/v1/analytics/chat-query-links?limit=50` returns recent rows joining **`chat_messages.query_log_id`** → **`queries.id`** (audit ↔ persisted assistant turns). Same **`API_KEY`** rules as other `/api/v1/*` routes when configured.
- `GET /api/v1/analytics/query-log/{query_id}` returns one **`queries`** audit row (used by the chat UI “Observability” panel when a message has **`query_log_id`**).
- `GET /api/v1/eval/runs` and **`GET /api/v1/eval/runs/{run_id}`** list and detail persisted eval harness runs (see Phase 1 **`eval_runs`** tables).
- **`GET /api/v1/eval/runs/{run_id}/export?format=json|csv`** downloads the same detail as an attachment (CI / archival). See **`docs/EVAL_CI.md`**.
- **`GET /api/v1/analytics/query-logs`** lists **`queries`** audit rows with optional `rag_model`, `start_date`, `end_date`, `limit`, `offset` (query-log explorer in the app at **`/query-logs`**).
- `GET /api/v1/metrics` and `GET /api/v1/metrics/prometheus` expose per-route counters (including `/api/v1/query` and `/api/v1/query/stream`) and token totals. They are in-memory and reset on process restart.
- Grafana: import `observability/grafana-rag-eval-prometheus.json` or use provisioning files under `observability/grafana/` (see `observability/grafana/README.md`).

### Logs (correlation)

- Non-TTY environments use JSON logs. Each request emits `http_request` with `request_id`, `route`, `method`, `status_code`, and `latency_ms` — use `request_id` to tie logs to the `X-Request-ID` response header.

### CI notifications (optional)

- Repository secret **`SLACK_WEBHOOK_URL`**: if set, failed **Eval** and **Eval smoke** workflows POST a short message to Slack.

### Evaluation harness

- `EVAL_MAX_CASES` — optional positive integer; truncate the eval dataset for cheaper runs (e.g. in CI smoke jobs).
- `EVAL_USE_LLM_JUDGE` — `true` / `false` for extra LLM judging in `eval/run_eval.py`.
- `EVAL_RECORD_CHAT` — when `true` / `1` / `yes`, `eval/run_eval.py` appends each case as user + assistant rows into **one** Postgres chat thread (same DB pool as retrieval), tagged with `eval_run_id` and `eval_case_id` (`case-{n}`). Requires current chat schema migrations applied.
- `EVAL_PERSIST_RUNS` — default **on** (`true`). When enabled, each completed `eval/run_eval.py` run writes a row to `eval_runs` and per-case rows to `eval_case_results` (requires eval tables from `docker/init/07-eval-runs.sql` or Alembic `006_eval_runs`). Set to `false` / `0` / `no` to skip DB persistence (report file is still written).

---

## Complete Example for Azure Container Apps

Here's a complete example with all required variables filled in:

```env
# REQUIRED - Database (Neon DB)
DATABASE_URL=postgresql://neondb_owner:password@ep-xxx-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require

# Optional asyncpg pool (defaults: 5 / 20 / 60s)
# DB_POOL_MIN_SIZE=5
# DB_POOL_MAX_SIZE=20
# DB_COMMAND_TIMEOUT=60

# Optional: re-ingest replaces chunks for same (source, title) instead of versioned sources
# INGEST_REPLACE_IF_EXISTS=false

# REQUIRED - OpenAI (MARK AS SECURE)
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# REQUIRED - Environment
ENVIRONMENT=production

# REQUIRED - CORS (replace with your actual Vercel URL)
CORS_ALLOW_ORIGINS=https://your-app.vercel.app,https://your-app-git-main-yourusername.vercel.app
```

---

## Which Variables to Mark as "Secure" in Azure?

**Mark as Secure (encrypted, hidden in logs):**

- ✅ `DATABASE_URL` - Contains database credentials
- ✅ `OPENAI_API_KEY` - Sensitive API key

**Do NOT mark as Secure (can be visible):**

- `ENVIRONMENT` - Just "production"
- `CORS_ALLOW_ORIGINS` - Public URLs
- All optional variables with defaults

---

## Quick Setup Checklist

### Vercel:

- [ ] Add `BACKEND_API_BASE_URL` pointing to your FastAPI base URL (no `NEXT_PUBLIC_` prefix)
- [ ] If the backend uses `API_KEY`, add `BACKEND_API_KEY` with the same value
- [ ] Redeploy after adding environment variables

### Azure Container Apps:

- [ ] Apply DB migrations after deploy or pulling new revisions: `make migrate` from the **repo root** or from **`backend/`** (with `DATABASE_URL` set), or run `uv run python scripts/apply_init_sql.py && uv run alembic upgrade head` inside `backend/`
- [ ] Add `DATABASE_URL` (from Neon DB) - **Mark as Secure**
- [ ] Add `OPENAI_API_KEY` - **Mark as Secure**
- [ ] Add `ENVIRONMENT=production`
- [ ] Add `CORS_ALLOW_ORIGINS` with your Vercel URL(s)
- [ ] Optional: add `API_KEY` and the same value in Vercel as `BACKEND_API_KEY`
- [ ] Optional: `OTEL_ENABLED=true` and OTLP endpoint env vars after `uv sync --extra otel`
- [ ] Save and wait for container restart

---

## Notes

1. **CORS_ALLOW_ORIGINS**: Include both your main Vercel domain and preview deployment URLs if you want preview deployments to work.

2. **DATABASE_URL**: Get this from your Neon DB dashboard → Connection Details → Connection String

3. **Environment Variable Names**: Azure Container Apps are case-insensitive, but use uppercase for consistency.

4. **After Adding Variables**: Azure will automatically restart your container. Wait 1-2 minutes before testing.

5. **Testing**: After setup, test the connection by:
   - Opening your Vercel URL
   - Checking browser console for errors
   - Trying to send a query
   - Checking Azure logs if issues occur
