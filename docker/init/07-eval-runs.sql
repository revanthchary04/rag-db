-- Persisted RAG eval harness runs (mirrors Alembic 006_eval_runs).
CREATE TABLE IF NOT EXISTS eval_runs (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'completed',
  dataset_path TEXT NOT NULL,
  use_llm_judge BOOLEAN NOT NULL DEFAULT FALSE,
  total_cases INTEGER NOT NULL,
  successful INTEGER NOT NULL,
  failed INTEGER NOT NULL,
  hit_at_1 DOUBLE PRECISION NOT NULL,
  hit_at_3 DOUBLE PRECISION NOT NULL,
  hit_at_5 DOUBLE PRECISION NOT NULL,
  hit_at_8 DOUBLE PRECISION NOT NULL,
  mrr DOUBLE PRECISION NOT NULL,
  llm_judge_correctness_rate DOUBLE PRECISION,
  llm_judge_faithfulness_rate DOUBLE PRECISION,
  config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS eval_runs_created_at_idx ON eval_runs (created_at DESC);

CREATE TABLE IF NOT EXISTS eval_case_results (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  eval_run_id TEXT NOT NULL REFERENCES eval_runs(id) ON DELETE CASCADE,
  case_index INTEGER NOT NULL,
  case_id TEXT NOT NULL,
  query TEXT NOT NULL,
  expected_sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  retrieved_sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  answer TEXT NOT NULL DEFAULT '',
  hit_at_1 BOOLEAN NOT NULL,
  hit_at_3 BOOLEAN NOT NULL,
  hit_at_5 BOOLEAN NOT NULL,
  hit_at_8 BOOLEAN NOT NULL,
  mrr DOUBLE PRECISION NOT NULL,
  llm_judge_correctness BOOLEAN,
  llm_judge_faithfulness BOOLEAN,
  llm_judge_reasoning TEXT,
  error TEXT,
  citations JSONB NOT NULL DEFAULT '[]'::jsonb,
  CONSTRAINT eval_case_results_run_case_unique UNIQUE (eval_run_id, case_index)
);

CREATE INDEX IF NOT EXISTS eval_case_results_run_id_idx ON eval_case_results (eval_run_id);
