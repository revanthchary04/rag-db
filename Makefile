.PHONY: dev lint test typecheck format db migrate seed eval eval-compare eval-baseline

# Development
dev:
	pnpm dev

# Linting
lint:
	pnpm lint
	pnpm format:check

# Testing
test:
	pnpm test

# Type checking
typecheck:
	pnpm typecheck

# Formatting
format:
	pnpm format

# Database operations
db:
	docker compose up -d postgres

# Database schema (same SQL as docker/init; idempotent) + Alembic revisions
migrate:
	cd backend && uv run python scripts/apply_init_sql.py && uv run alembic upgrade head
	pnpm db:migrate  # Drizzle chat/auth tables (User/Chat/Message_v2) — required for guest login

# Database seeding (eval corpus + local demo sources; idempotent)
seed:
	cd backend && uv run python scripts/seed_eval_corpus.py

# Evaluation
eval:
	cd backend && uv run python eval/run_eval.py

# Compare the latest run (eval/summary.json) against the pinned baseline; the
# same gate CI runs on PRs. Exits non-zero on a Hit@5/MRR regression.
eval-compare:
	cd backend && uv run python eval/compare_eval.py \
		--baseline eval/baseline.json --current eval/summary.json --allow-missing-baseline

# Promote the latest run to the pinned baseline (do this on main after a change
# you accept as the new reference), then commit backend/eval/baseline.json.
eval-baseline:
	cp backend/eval/summary.json backend/eval/baseline.json
	@echo "Updated backend/eval/baseline.json — commit it to move the baseline."

# API (Python FastAPI)
api:
	cd backend && uv run uvicorn app.main:app --host 0.0.0.0 --port 8000

api-dev:
	cd backend && uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

api-test:
	cd backend && uv run pytest

