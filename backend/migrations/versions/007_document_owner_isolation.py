"""Per-device document isolation: owner_key + expires_at.

Guest uploads are scoped to the device that created them (``owner_key``) and
auto-expire (``expires_at``). A NULL ``owner_key`` means the document is public
(the seeded demo corpus), and a NULL ``expires_at`` means it never expires.

Revision ID: 007_document_owner_isolation
Revises: 006_eval_runs
Create Date: 2026-07-30

"""

from alembic import op

revision: str = "007_document_owner_isolation"
down_revision: str | None = "006_eval_runs"


def upgrade() -> None:
    op.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS owner_key TEXT")
    op.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ")
    # Filter by owner on every list/retrieve; sweep expired rows on a timer.
    op.execute("CREATE INDEX IF NOT EXISTS documents_owner_key_idx ON documents (owner_key)")
    op.execute(
        "CREATE INDEX IF NOT EXISTS documents_expires_at_idx ON documents (expires_at) "
        "WHERE expires_at IS NOT NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS documents_expires_at_idx")
    op.execute("DROP INDEX IF EXISTS documents_owner_key_idx")
    op.execute("ALTER TABLE documents DROP COLUMN IF EXISTS expires_at")
    op.execute("ALTER TABLE documents DROP COLUMN IF EXISTS owner_key")
