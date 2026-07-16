# Local development

## Prerequisites

- Node 20+, [pnpm](https://pnpm.io/) 9+
- Python 3.11+, [uv](https://docs.astral.sh/uv/)
- Docker (optional, for Postgres + API in containers)

## Golden path (native)

1. **Postgres with pgvector**
   - Either: `docker compose up -d postgres` from the repo root (see `docker-compose.yml`),
   - Or use a hosted URL in `DATABASE_URL`.

2. **Environment**
   - Put `DATABASE_URL` and `OPENAI_API_KEY` in the repo root `.env` and/or `backend/.env` (backend loads both; see `ENV_VARS.md`).
   - The web app also needs (root `.env`):
     - `POSTGRES_URL` — the same Postgres the backend uses (Drizzle owns the chat/auth tables in it). Falls back to `DATABASE_URL`.
     - `AUTH_SECRET` — Auth.js signing secret. Generate with `openssl rand -base64 32` (or `npx auth secret`).
   - The chat UI now requires a session; a **guest** user is created automatically on first load, so no login is needed to try it.

3. **Schema**
   - Backend RAG tables (Docker init SQL + Alembic `upgrade head`):

     ```bash
     make migrate
     ```

   - Chat + auth tables (Drizzle, into the same DB via `POSTGRES_URL`):

     ```bash
     pnpm db:migrate
     ```

4. **Demo corpus** (recommended for first open; idempotent — skips existing `source` values)

   ```bash
   make seed
   # or: pnpm seed:corpus
   ```

   Loads the same five short RAG-topic docs used by `eval/run_eval.py`, so the home-screen example queries retrieve well.

5. **Backend**

   ```bash
   make api-dev
   # or: cd backend && uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
   ```

6. **Frontend** (new terminal)

   ```bash
   pnpm install
   pnpm dev
   ```

7. Open [http://localhost:3000](http://localhost:3000). The UI proxies API calls to `http://localhost:8000` unless `BACKEND_API_BASE_URL` is set.

## Troubleshooting (Eval page / `Cannot find module './NNN.js'`)

If `/eval/runs` shows a huge error or **Cannot find module './463.js'**, the dev bundle is usually stale. From the repo root:

```bash
rm -rf .next && pnpm dev
```

Then hard-refresh the browser. The eval routes load their UI with **client-only** dynamic imports to reduce SSR edge cases; the API still uses `/api/backend` as usual.

## Automated UI demo (no backend)

Playwright can drive the full chat shell with **mocked** API routes (clicks an example pill + types a follow-up with the keyboard):

```bash
pnpm demo:e2e
```

This runs `pnpm build` then `playwright test e2e/demo-automated.spec.ts`. The same spec is included in the default `pnpm exec playwright test` run in CI.

## README walkthrough GIF

The root README embeds `docs/images/demo-walkthrough.gif` (five screens: chat with one example Q→A, query logs, eval list, compare, export). Regenerate from mocked Playwright captures:

```bash
pnpm demo:capture   # PNGs → docs/images/demo-frames/ (gitignored)
pnpm demo:gif       # ImageMagick → docs/images/demo-walkthrough.gif (commit this)
```

`e2e/readme-demo-capture.spec.ts` runs only when `CAPTURE_README_DEMO=1` is set, so normal `pnpm exec playwright test` does not overwrite assets.

## One-command stack (Docker profile `full`)

Runs Postgres, API, and Next dev server (slow first `pnpm install` in the container):

```bash
docker compose --profile full up
```

Set `OPENAI_API_KEY` in your environment before starting. The web service uses `BACKEND_API_BASE_URL=http://api:8000`.

## Tests

```bash
cd backend && uv sync --extra dev && uv run pytest tests/ -q --cov=app --cov-fail-under=58
pnpm exec jest --ci
pnpm typecheck
pnpm lint
pnpm build
pnpm exec playwright install   # first time only
pnpm build && pnpm exec playwright test
```

Playwright starts a production `next start` server on **http://127.0.0.1:4173** (see `playwright.config.ts`) so it does not collide with `pnpm dev` on port 3000.

**Broader E2E:** `e2e/eval-observability-mocked.spec.ts` covers eval list/detail/compare and query logs with a mocked API. **`e2e/a11y-core-pages.spec.ts`** runs **axe-core** on `/`, `/eval/runs`, `/query-logs`, and `/metrics` (color-contrast disabled; focus on structure and naming — see file header). Both are included in `pnpm exec playwright test` / CI.

### Integration E2E (real API + Postgres)

CI runs this in `.github/workflows/e2e-integration.yml`. Locally, with Postgres migrated and API on port 8000, and Next built with `BACKEND_API_BASE_URL=http://127.0.0.1:8000`:

```bash
pnpm build
PW_INTEGRATION=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 BACKEND_API_BASE_URL=http://127.0.0.1:8000 \
  pnpm exec next start -H 127.0.0.1 -p 4173 &
pnpm exec playwright test
```

Stop the stray `next start` when finished.

## Migrations (Alembic)

`make migrate` applies `docker/init/*.sql` then `alembic upgrade head`. For databases created before Alembic was added, see `backend/migrations/README.md` (one-time `stamp`).

## Observability

- In-app JSON metrics: `GET /api/v1/metrics`
- Prometheus text: `GET /api/v1/metrics/prometheus`
- Grafana: `observability/grafana/README.md` and `observability/grafana-rag-eval-prometheus.json`.

Structured logs in non-TTY environments are JSON; search by field `request_id` on `http_request` events.
