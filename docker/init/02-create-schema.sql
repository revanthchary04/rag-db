-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Documents table
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  title TEXT,
  original_file BYTEA,
  original_media_type TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Chunks table
CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  embedding vector(1536),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Indexes for chunks table

-- HNSW index for vector similarity search (pgvector 0.5.0+)
CREATE INDEX IF NOT EXISTS chunks_embedding_hnsw_idx ON chunks 
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- B-tree index for document_id (for filtering by document)
CREATE INDEX IF NOT EXISTS chunks_document_id_idx ON chunks (document_id);

-- B-tree index for created_at (for time-based queries)
CREATE INDEX IF NOT EXISTS chunks_created_at_idx ON chunks (created_at DESC);

-- Composite index for common query patterns (document_id + created_at)
CREATE INDEX IF NOT EXISTS chunks_document_created_idx ON chunks (document_id, created_at DESC);

-- Index on documents source for filtering
CREATE INDEX IF NOT EXISTS documents_source_idx ON documents (source);

-- Index on documents created_at
CREATE INDEX IF NOT EXISTS documents_created_at_idx ON documents (created_at DESC);

