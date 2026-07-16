-- Chat persistence (matches Alembic 004_chat_history)
CREATE TABLE IF NOT EXISTS chat_threads (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  title TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

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
);

CREATE INDEX IF NOT EXISTS chat_messages_thread_seq_idx ON chat_messages (thread_id, seq);
CREATE INDEX IF NOT EXISTS chat_threads_updated_at_idx ON chat_threads (updated_at DESC);
