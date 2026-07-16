.PHONY: migrate

# Same as repo root `make migrate`, for when your shell cwd is backend/
migrate:
	uv run python scripts/apply_init_sql.py && uv run alembic upgrade head
