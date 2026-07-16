# Eval artifacts in CI

Persisted eval runs are available over the HTTP API (same auth as other `/api/v1/*` routes when `API_KEY` is configured).

## Fetch run JSON (detail)

```bash
BASE=http://localhost:8000/api/v1
RUN_ID=00000000-0000-0000-0000-000000000000
curl -sS -H "X-API-Key: $API_KEY" "$BASE/eval/runs/$RUN_ID" | jq '.hit_at_5, .mrr'
```

## Download export attachments

The export route returns `Content-Disposition: attachment` for archival or pipeline artifacts.

```bash
curl -sS -H "X-API-Key: $API_KEY" \
  "$BASE/eval/runs/$RUN_ID/export?format=json" -o "eval-$RUN_ID.json"

curl -sS -H "X-API-Key: $API_KEY" \
  "$BASE/eval/runs/$RUN_ID/export?format=csv" -o "eval-$RUN_ID.csv"
```

## Run harness locally or in CI

From the repo root (see `Makefile`):

```bash
cd backend && uv run python eval/run_eval.py
```

Set `EVAL_PERSIST_RUNS=1` (default) so the run appears in the API and UI. For a minimal smoke run, use `EVAL_MAX_CASES=1`.

## Regression gate (blocks PRs on a Hit@5 / MRR drop)

Every run writes `backend/eval/summary.json` (aggregate metrics + per-case
`hit_at_5`/`mrr`). The **[Eval gate workflow](../.github/workflows/eval-gate.yml)**
runs the harness on each PR, compares that summary against the pinned baseline,
posts a delta table as a PR comment, and **fails the check** when a gated metric
(`hit_at_5`, `mrr`) regresses beyond tolerance (default ±0.02). Per-case **Hit@5
flips** are called out by `case_id`. PRs from forks (no `OPENAI_API_KEY`) are
skipped, not failed.

Run the same comparison locally:

```bash
make eval            # writes backend/eval/summary.json
make eval-compare    # diffs summary.json vs baseline.json (exit 1 on regression)
```

### The pinned baseline

`backend/eval/baseline.json` is the committed reference. Create or move it when
you accept a run as the new normal (typically on `main`):

```bash
make eval            # produce a fresh summary.json
make eval-baseline   # copy summary.json -> baseline.json
git add backend/eval/baseline.json && git commit -m "eval: move baseline"
```

A baseline is committed (`git_sha` records the code state its metrics reflect),
so the CI gate always compares against it — it will **not** silently pass when
the baseline is absent. If `baseline.json` is ever missing, the CI job fails
loudly rather than no-opping. (The local `make eval-compare` keeps
`--allow-missing-baseline` for convenience while iterating on a branch.)

Tune the gate with `EVAL_GATE_TOLERANCE` (workflow env) or
`compare_eval.py --tolerance` / `--gated hit_at_5,mrr` locally.
