# Product thesis: eval regression as a first-class workflow

**The one-liner:** most RAG projects can tell you their system _works_; very few can tell you the moment it _got worse_. This repo treats that second question as the product.

## The problem

A RAG demo is easy to make impressive once. Keeping it good is the hard part, because the things that quietly degrade retrieval don't look like bugs:

- someone ingests a batch of broad "summary" documents that crowd out the specific source,
- a chunk-size or overlap tweak shifts what lands in the top-k,
- an embedding-model or prompt change trades a little accuracy for latency,
- a reranker is added that helps most queries and silently hurts a few.

None of these throw an exception. Tests stay green. The chat still answers. You find out weeks later from a user complaint — and by then you can't tell _which_ change did it, or _where_ to look. The gap isn't "can we evaluate a RAG system"; plenty of harnesses compute Hit@k. The gap is making that measurement **continuous, attributable, and merge-blocking**, and wiring it to the same traces you'd use to debug production.

## The core idea

**Change the system → measure the same dataset → see what regressed, why, and where to look in a trace.** Concretely, an eval regression is a **CI check that fails a pull request**, the same way a failing unit test does:

1. On every backend PR, `eval/run_eval.py` runs the harness against a fixed dataset.
2. `eval/compare_eval.py` diffs the run against a pinned baseline and posts a delta table as a PR comment.
3. If a **gated** metric (Hit@5 / MRR) drops beyond tolerance, the check **fails** and the merge is blocked.

That turns "did retrieval get worse?" from a thing you hope someone notices into a thing the repo enforces. See it fire on a real change in the [worked case study](../backend/eval/case_study/README.md).

## What we optimize for

1. **Persisted harness runs.** Every `eval/run_eval.py` completion can land in Postgres (`eval_runs`, `eval_case_results`) with a stable id you can link from chat and CI — runs are durable objects, not console output that scrolls away.
2. **Regression UX.** List → detail (`/eval/runs?id=…`) → **compare two runs keyed by `case_id`**, with per-metric deltas and highlighted Hit@5 flips. You see _which specific questions_ moved, not just an aggregate that ticked down.
3. **Traceability.** Query audit rows (`queries`), chat `query_log_id`, and optional `eval_run_id` on messages mean an eval failure and a piece of live traffic share **one mental model** — the row you inspect in the query log is the same shape whether it came from CI or a user.
4. **Eval-as-code.** JSON/CSV exports and `curl` patterns ([EVAL_CI.md](./EVAL_CI.md)) so a pipeline can archive artifacts and gate merges without a UI in the loop.

## Design decisions worth defending

- **Compare by `case_id`, not row order.** Datasets get reordered, filtered, and appended to. Keying deltas on a stable case id means a comparison survives those edits — otherwise "case 12 regressed" silently becomes noise the first time someone inserts a row.
- **Gate on Hit@5 _and_ MRR.** These catch different failures. Distractor documents that steal the top rank tank MRR and Hit@1 while Hit@5 barely moves — a recall@k-only gate would ship that regression. The case study is exactly this failure, chosen to make the point.
- **A tolerance band, not exact equality.** LLM/embedding runs carry small run-to-run variance; the gate fails on moves _beyond_ a configured tolerance so it blocks real regressions without flapping on noise. Baselines are pinned from a CI run, not a local one, so the comparison is apples-to-apples.
- **Traces per pipeline stage, not per request.** A single `latency_ms` says "slow." One span per stage (embed → vector search → generate) says _which_ stage — usually a different fix (see [OBSERVABILITY.md](./OBSERVABILITY.md)).

## Where this sits

This is deliberately **not** a hosted eval SaaS or a general LLM-observability platform (LangSmith, Ragas, Arize Phoenix, TruLens live in that space). It is a **self-contained, deployable reference**: one repo where the chat, the eval harness, the regression gate, the query log, and the traces are the _same_ system reading the _same_ Postgres — so the loop from "I changed something" to "here's the row that got worse" stays inside one codebase you own.

## What we are not claiming

- Not a hosted service or a drop-in library for someone else's stack.
- Multi-tenant isolation and per-user auth are **out of scope** unless you extend it (see [HARDENING.md](./HARDENING.md)).
- The bundled corpus is a demonstration corpus, sized to make regressions visible — not a benchmark leaderboard.

## How to pitch it

> "RAG chat + **persisted offline eval** + **compare runs by case id** + a **CI gate that blocks a merge on retrieval regression** + a **query-log/trace explorer** — one repo you can deploy, where the eval and the production traces are the same system."
