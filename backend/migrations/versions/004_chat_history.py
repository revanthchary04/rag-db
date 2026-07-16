"""Chat threads and messages for Postgres-backed history.

Revision ID: 004_chat_history
Revises: 003_document_original_binary
Create Date: 2026-05-02

"""

from alembic import op

revision: str = "004_chat_history"
down_revision: str | None = "003_document_original_binary"


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS chat_threads (
            id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
            title TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS chat_messages (
            id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
            thread_id TEXT NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
            role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
            content TEXT NOT NULL,
            citations JSONB DEFAULT '[]'::jsonb NOT NULL,
            metadata JSONB DEFAULT '{}'::jsonb NOT NULL,
            latency_ms INTEGER,
            cost_usd DOUBLE PRECISION,
            rag_model TEXT,
            seq INTEGER NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
            UNIQUE(thread_id, seq)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS chat_messages_thread_seq_idx ON chat_messages (thread_id, seq)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS chat_threads_updated_at_idx ON chat_threads (updated_at DESC)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS chat_messages")
    op.execute("DROP TABLE IF EXISTS chat_threads")
