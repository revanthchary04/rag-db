"""Baseline revision: schema from docker/init + scripts/apply_init_sql.py.

After a fresh database, apply SQL init scripts, then:

    cd backend && uv run alembic stamp 001_baseline

Future schema changes: add new revisions with ALTER TABLE via op.execute(...).

Revision ID: 001_baseline
Revises:
Create Date: 2026-02-01

"""

revision: str = "001_baseline"
down_revision: str | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
