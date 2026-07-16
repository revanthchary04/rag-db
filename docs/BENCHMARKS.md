# Benchmarks and case study (reproducible baseline)

LLM and retrieval outputs can vary by model version and temperature. This document defines a **repeatable procedure** and **what “good” looks like** on the **bundled demo corpus**, not a frozen leaderboard.

## Retrieval strategy comparison

`eval/benchmark_strategies.py` runs the whole dataset through each of the four
retrieval strategies and reports quality, latency, and **measured** OpenAI cost
(token usage priced at current public rates — not an estimate; the script wraps
the client and tallies real tokens per strategy). It measures the **retrieval
stage only**: answer generation is ~constant across strategies, so including it
would dilute exactly the differences the table exists to show.

```bash
cd backend
uv run python eval/benchmark_strategies.py                # full corpus
uv run python eval/benchmark_strategies.py --max-cases 5  # cheap smoke
```

| Strategy | Hit@1 | Hit@5 | MRR | Retrieval latency p50 / p95 | Cost / 1k queries | OpenAI calls (embed / chat) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `vector-similarity` | 76.9% | 94.9% | **0.840** | 227 ms / 331 ms | $0.0002 | 1 / 0.0 |
| `hybrid-search` | 75.6% | 94.9% | 0.825 | 220 ms / 292 ms | $0.0002 | 1 / 0.0 |
| `reranking` | 73.1% | **98.7%** | 0.831 | 1119 ms / 1599 ms | $0.2361 | 1 / 1.0 |
| `multi-query` | 73.1% | 94.9% | 0.827 | 2089 ms / 2906 ms | $0.0372 | 4 / 1.0 |

_Bundled 78-case corpus, `text-embedding-3-small` + `gpt-4o-mini`, `top_k=8`.
Latency is wall-clock around `retrieve()` on a local run against a Docker
Postgres; absolute numbers depend on your machine and network round-trip to
OpenAI, but the **relative** ordering is the signal. Full machine-readable output
lands in `eval/benchmark_results.json`._

**How to read it.** There is no free lunch: the cheapest, fastest strategy is
not dominated on quality, and the strategy with the best top-5 recall pays for it
in latency and cost (an extra LLM call per query). "Which retriever?" is a
trade-off you resolve against *your* corpus and *your* latency/cost budget — which
is the whole reason the harness exists. Re-run it after any change to embeddings,
chunking, or `top_k` and the numbers move.

## Setup (golden path)

1. Postgres + migrations (`make migrate` or equivalent).
2. Seed the eval-oriented corpus: `pnpm seed:corpus` or `make seed` (same documents `eval/run_eval.py` expects to retrieve against).
3. Run the harness from `backend`:

   ```bash
   cd backend && uv run python eval/run_eval.py
   ```

4. Optional smoke: `EVAL_MAX_CASES=3` to shorten runs.

## What to record

After each run, capture from the API or UI:

- **Hit@1 / Hit@5 / MRR** (run summary).
- **Run id** (for compare and exports).
- **Git SHA** and **`OPENAI_*` model names** (embedding + chat).

Use **`GET /api/v1/eval/runs/{id}/export?format=json`** in CI to store artifacts (see **[EVAL_CI.md](./EVAL_CI.md)**).

## Worked case study: a regression the gate caught

A **real, reproduced** run of the workflow — ingesting four broad "summary /
glossary" documents silently demotes the canonical source for 12 questions, and
the CI gate (`eval/compare_eval.py`) blocks the merge. Full write-up, artifacts,
and a one-command reproduction: **[`backend/eval/case_study/`](../backend/eval/case_study/README.md)**.

| Field | Value |
| --- | --- |
| Dataset | `backend/eval/dataset.jsonl` (78 cases) |
| Embedding model | `text-embedding-3-small` |
| Chat model | `gpt-4o-mini` |
| Change under test | +4 distractor docs (`case_study/distractors/`) |
| Hit@5 | 94.9% → 97.4% (within run noise) |
| **MRR (gated)** | **0.840 → 0.812 (−0.028)** |
| Hit@1 | 76.9% → 70.5% (−6.4pp) |
| Rank-1 answers | 60 → 55 canonical sources |
| Gate result | 🔴 **fails (exit 1)** — MRR beyond ±0.02 tolerance |

The clean run reproduced the pinned baseline (`eval/baseline.json`) to within a
case, so the delta is attributable to the distractors, not drift. The takeaway:
**Hit@5 barely moved — a recall@k-only gate would have shipped this. MRR caught
it** because it is sensitive to *where* the right document lands, not just whether
it appears. This is why the gate keys on both.

## Case study template (fill in for your deployment)

| Field | Example |
| --- | --- |
| Date | |
| Commit | |
| Embedding model | |
| Chat model | |
| Dataset | `backend/eval/dataset.jsonl` |
| Hit@5 | |
| MRR | |
| Notes (reranker, top_k, etc.) | |

## Interpreting drift

- **Retrieval-only regressions** often show up as Hit@k and MRR moves with **similar** generation quality.
- **Generation regressions** may show stable Hit@k but worse human judgment; enable **`EVAL_USE_LLM_JUDGE`** when you need that signal.

For SLO-style availability targets for the API itself, see **[RUNBOOK.md](./RUNBOOK.md)**.
