"""Store optional uploaded binary (PDF) for document preview.

Revision ID: 003_document_original_binary
Revises: 002_documents_source_title_idx
Create Date: 2026-05-01

"""

from alembic import op

revision: str = "003_document_original_binary"
down_revision: str | None = "002_documents_source_title_idx"


def upgrade() -> None:
    op.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS original_file BYTEA")
    op.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS original_media_type TEXT")


def downgrade() -> None:
    op.execute("ALTER TABLE documents DROP COLUMN IF EXISTS original_file")
    op.execute("ALTER TABLE documents DROP COLUMN IF EXISTS original_media_type")
