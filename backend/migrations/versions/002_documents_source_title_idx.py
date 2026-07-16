"""Add documents (source, title) lookup index.

Revision ID: 002_documents_source_title_idx
Revises: 001_baseline
Create Date: 2026-05-01

"""

from alembic import op

revision: str = "002_documents_source_title_idx"
down_revision: str | None = "001_baseline"


def upgrade() -> None:
    op.execute("CREATE INDEX IF NOT EXISTS documents_source_title_idx ON documents (source, title)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS documents_source_title_idx")
