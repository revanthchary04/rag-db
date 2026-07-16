# Case study: distractor documents regress retrieval, and the gate catches it

This is a **real, reproduced regression** run through the same CI gate
(`eval/compare_eval.py`) that runs on every PR — not a hypothetical. It exists to
show the flagship workflow *firing*: a change that looks harmless (ingesting a few
broad "summary" documents) silently degrades retrieval ranking, and the eval gate
blocks the merge.

## The scenario

A common production incident: someone ingests a batch of **broad overview /
glossary / cheatsheet documents** — each one textually close to *many* user
questions because it name-drops every topic on one page. They feel helpful. But in
a top-k retriever they **outrank the specific canonical source** for the questions
they skim, demoting the right document from rank 1 to rank 2–3.

Here that batch is four documents ([`distractors/`](./distractors)):
`vector-index-cheatsheet`, `retrieval-methods-glossary`,
`evaluation-metrics-glossary`, `embeddings-overview`.

## Method

Two harness runs against the **same 78-case dataset** (`backend/eval/dataset.jsonl`)
and the **same code** — the *only* variable is the corpus:

| Run | Corpus | Artifact |
| --- | --- | --- |
| Baseline | `data/sample_docs/` (27 docs) | [`clean.summary.json`](./clean.summary.json) |
| Regressed | 27 docs **+ 4 distractors** | [`regressed.summary.json`](./regressed.summary.json) |

The clean run reproduced the pinned production baseline almost exactly (Hit@5
0.9487, identical to `eval/baseline.json`), which is what makes the delta
attributable to the distractors rather than run-to-run drift.

Reproduce it end to end: [`reproduce.sh`](./reproduce.sh).

## Result — the gate fails (exit 1)

Full gate output: [`comment.md`](./comment.md) (this is exactly what gets posted
on the PR).

| Metric | Baseline | Current | Δ | |
| --- | ---: | ---: | ---: | :---: |
| Hit@1 | 76.9% | 70.5% | **-6.4pp** | 🟡 |
| Hit@3 | 88.5% | 91.0% | +2.6pp | 🟢 |
| **Hit@5** | 94.9% | 97.4% | +2.6pp | 🟢 |
| Hit@8 | 97.4% | 98.7% | +1.3pp | ➖ |
| **MRR** | 0.840 | 0.812 | **-0.028** | 🔴 |

**MRR dropped past the ±0.02 tolerance → the check fails and the merge is blocked.**

## Why this is the interesting part

The distractors reliably steal the **top rank**: 12 cases had their canonical
source demoted, and the number of questions answered by the *correct* document at
rank 1 fell from **60 → 55**. A few examples:

| Case | Question | Canonical source demoted by | MRR |
| --- | --- | --- | --- |
| case-25 | dimensions of OpenAI embeddings | `embeddings-overview` | 1.00 → 0.33 |
| case-66 | hypothetical document embeddings (HyDE) | `retrieval-methods-glossary` | 1.00 → 0.33 |
| case-62 | probes and lists in IVFFlat | `vector-index-cheatsheet` | 1.00 → 0.50 |
| case-74 | RAGAS reference-free metrics | `evaluation-metrics-glossary` | 1.00 → 0.50 |

Notice **Hit@5 barely moved** (it stayed within ±1–2 cases of run-to-run noise —
the canonical source is still *somewhere* in the top 5, just no longer first).
**A gate on Hit@5 alone would have shipped this regression.** MRR is sensitive to
*where* in the ranking the right answer lands, so it caught what a coarse
recall@k missed — which is exactly why the gate keys on **MRR and Hit@5**, not
just one.

## Files

- [`distractors/`](./distractors) — the four documents that cause the regression.
- [`clean.summary.json`](./clean.summary.json) / [`regressed.summary.json`](./regressed.summary.json) — the two run summaries (`case_id`-keyed).
- [`comment.md`](./comment.md) — the gate's rendered PR comment.
- [`reproduce.sh`](./reproduce.sh) — one command to regenerate all of the above.

> Note: LLM/embedding runs carry small (~1pp) run-to-run variance, so exact
> per-case flips can differ slightly on re-run. The gated signal here (MRR −0.028,
> Hit@1 −6.4pp, 12 demotions) is well outside that noise band.
