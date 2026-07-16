-- Query logging table for monitoring and analytics
CREATE TABLE IF NOT EXISTS queries (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  query_text TEXT NOT NULL,
  rag_model TEXT NOT NULL,
  top_k INTEGER,
  request_id TEXT,
  client_ip TEXT,
  user_agent TEXT,
  latency_ms INTEGER,
  token_usage JSONB,
  cost_usd NUMERIC(10, 6),
  citations_count INTEGER DEFAULT 0,
  answer_length INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS queries_created_at_idx ON queries (created_at DESC);
CREATE INDEX IF NOT EXISTS queries_rag_model_idx ON queries (rag_model);
CREATE INDEX IF NOT EXISTS queries_client_ip_idx ON queries (client_ip);
CREATE INDEX IF NOT EXISTS queries_request_id_idx ON queries (request_id);

-- Index for cost analysis
CREATE INDEX IF NOT EXISTS queries_cost_idx ON queries (cost_usd) WHERE cost_usd IS NOT NULL;

-- Index for time-based analytics
CREATE INDEX IF NOT EXISTS queries_created_at_rag_model_idx ON queries (created_at DESC, rag_model);

