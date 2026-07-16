#!/usr/bin/env bash
# Reproduce the "distractor documents regress retrieval" case study end to end.
#
# It runs the eval harness twice against the SAME dataset (backend/eval/dataset.jsonl)
# and the SAME code — the only variable is the corpus:
#
#   1. clean run:      data/sample_docs/                      -> clean.summary.json
#   2. regressed run:  data/sample_docs/ + distractors/*.md   -> regressed.summary.json
#
# then diffs them with the real CI gate (eval/compare_eval.py) and prints its
# exit code. A non-zero exit is the gate blocking the merge.
#
# Prereqs: DATABASE_URL + OPENAI_API_KEY, a Postgres with the schema applied
# (scripts/apply_init_sql.py && alembic upgrade head). Run from backend/:
#
#   DATABASE_URL=postgresql://... ./eval/case_study/reproduce.sh
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$(cd "$HERE/../.." && pwd)"
REPO="$(cd "$BACKEND/.." && pwd)"
CORPUS="$REPO/data/sample_docs"
DISTRACTORS="$HERE/distractors"

cd "$BACKEND"
export EVAL_USE_LLM_JUDGE=false
export EVAL_PERSIST_RUNS=false

echo "==> [1/4] Seeding clean corpus ($CORPUS)"
uv run python scripts/seed_eval_corpus.py

echo "==> [2/4] Clean run"
uv run python eval/run_eval.py
cp eval/summary.json "$HERE/clean.summary.json"

echo "==> [3/4] Ingesting distractor documents, then re-running"
# seed_eval_corpus.py reads data/sample_docs; stage distractors there temporarily.
staged=()
for f in "$DISTRACTORS"/*.md; do
  cp "$f" "$CORPUS/$(basename "$f")"
  staged+=("$CORPUS/$(basename "$f")")
done
trap 'for s in "${staged[@]:-}"; do rm -f "$s"; done' EXIT
uv run python scripts/seed_eval_corpus.py
uv run python eval/run_eval.py
cp eval/summary.json "$HERE/regressed.summary.json"

echo "==> [4/4] Gate: clean (baseline) vs regressed (current)"
set +e
uv run python eval/compare_eval.py \
  --baseline "$HERE/clean.summary.json" \
  --current "$HERE/regressed.summary.json" \
  --tolerance 0.02 \
  --output "$HERE/comment.md"
gate_exit=$?
set -e
echo "gate exit code: $gate_exit (non-zero = regression blocked)"
exit 0
