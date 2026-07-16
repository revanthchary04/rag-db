"""Link chat_messages to query logs and optional eval correlation.

Revision ID: 005_chat_message_observability
Revises: 004_chat_history
Create Date: 2026-05-02

"""

from alembic import op

revision: str = "005_chat_message_observability"
down_revision: str | None = "004_chat_history"


def upgrade() -> None:
    op.execute("ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS request_id TEXT")
    op.execute("ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS query_log_id TEXT")
    op.execute("ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS eval_run_id TEXT")
    op.execute("ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS eval_case_id TEXT")
    op.execute(
        "CREATE INDEX IF NOT EXISTS chat_messages_request_id_idx ON chat_messages (request_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS chat_messages_query_log_id_idx ON chat_messages (query_log_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS chat_messages_eval_run_case_idx ON chat_messages (eval_run_id, eval_case_id)"
    )
    op.execute(
        """
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_class t ON c.conrelid = t.oid
            WHERE t.relname = 'chat_messages'
              AND c.conname = 'chat_messages_query_log_id_fkey'
          ) THEN
            ALTER TABLE chat_messages
              ADD CONSTRAINT chat_messages_query_log_id_fkey
              FOREIGN KEY (query_log_id) REFERENCES queries(id) ON DELETE SET NULL;
          END IF;
        END $$
        """
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE chat_messages DROP CONSTRAINT IF EXISTS chat_messages_query_log_id_fkey"
    )
    op.execute("DROP INDEX IF EXISTS chat_messages_eval_run_case_idx")
    op.execute("DROP INDEX IF EXISTS chat_messages_query_log_id_idx")
    op.execute("DROP INDEX IF EXISTS chat_messages_request_id_idx")
    op.execute("ALTER TABLE chat_messages DROP COLUMN IF EXISTS eval_case_id")
    op.execute("ALTER TABLE chat_messages DROP COLUMN IF EXISTS eval_run_id")
    op.execute("ALTER TABLE chat_messages DROP COLUMN IF EXISTS query_log_id")
    op.execute("ALTER TABLE chat_messages DROP COLUMN IF EXISTS request_id")
