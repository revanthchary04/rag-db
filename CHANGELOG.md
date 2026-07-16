# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_Nothing yet._

## [0.1.0] - 2026-07-15

First tagged release. RAG chat over your documents, plus the parts most demos
skip: persisted offline evals, run-to-run comparison keyed by `case_id`, a
per-answer query log, and pipeline-level tracing — one repo you can deploy.

### Added

**RAG pipeline**

- Grounded chat that streams answers with inline citations to retrieved sources.
- Four retrieval strategies — vector similarity, hybrid (vector + BM25), reranking,
  and multi-query — selectable per request (`rag_model`).
- Document ingestion for text, PDF, and DOCX with adaptive, overlap-aware chunking
  and chunk-preview APIs.

**Evaluation**

- Offline eval harness (`eval/run_eval.py`) computing Hit@1/3/5/8 and MRR, with an
  optional LLM judge for correctness and faithfulness.
- Persisted runs in Postgres (`eval_runs`, `eval_case_results`) with stable IDs;
  list → drill into a run → **compare two runs by `case_id`** with per-metric deltas
  and highlighted Hit@5 flips.
- **CI eval-regression gate** (`eval/compare_eval.py`): diffs a run against a pinned
  baseline, posts a delta table as a PR comment, and fails the check when a gated
  metric (Hit@5 / MRR) regresses beyond tolerance. A guard fails loudly rather than
  passing silently when the key is missing on a same-repo run.
- Worked, reproducible case study of the gate catching a real regression
  (`backend/eval/case_study/`).
- JSON/CSV export endpoints for archiving artifacts and gating merges in CI.

**Observability**

- OpenTelemetry span per pipeline stage (`rag.retrieve` → `openai.embedding` /
  `db.vector_search` → `rag.generate` → `openai.chat`) for a full trace waterfall
  per request; degrades to a zero-cost no-op when OTel is not installed.
- Latency percentiles (p50/p95/p99) per route **and per pipeline stage**, exported
  as Prometheus histograms.
- Query-log explorer correlating live traffic and eval failures via `query_log_id`;
  structured logging with request-ID / `trace_id` correlation; per-answer cost and
  token tracking.
- One-command local trace stack (Tempo + Prometheus + Grafana) with committed
  dashboards.

**Frontend**

- Next.js 15 / React 19 app (App Router) built on Vercel's AI Chatbot template,
  adapted to stream from the FastAPI RAG backend: chat with citations and
  per-message observability, metrics dashboard, eval run list / detail / compare,
  and the query-log explorer. Auth.js (guest + email/password), Drizzle ORM.

**Engineering**

- CI: frontend lint / typecheck / Jest / build / Playwright (incl. axe-core
  accessibility) and backend Ruff / Mypy / pytest against Postgres + pgvector.
- Mypy runs across the full `app` package; backend test coverage gated at a 70%
  floor.
- Docker Compose for local and production; deploy guides for Docker, Render, and
  Azure Container Apps. Operational docs: runbook, SLOs, threat model, hardening,
  and API contract.

[Unreleased]: https://github.com/Padraigobrien08/rag-eval-observe/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Padraigobrien08/rag-eval-observe/releases/tag/v0.1.0
