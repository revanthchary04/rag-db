# Screenshots to capture (observability)

Drop three PNGs in this folder to fill the README + OBSERVABILITY.md placeholders.
Capture them from the local stack (`docker compose -f docker-compose.yml -f
docker-compose.observability.yml up`) after firing a few queries.

| File | Where | Frame it so it shows | Caption (already written in the docs) |
| --- | --- | --- | --- |
| `trace-waterfall.png` | Grafana → RAG Eval — Traces → click a `POST /api/v1/query` trace | The full span tree: `rag.retrieve` (with `openai.embedding` + `db.vector_search`) and `rag.generate` (with `openai.chat`), durations visible | 5.5s answer decomposed — latency is the two OpenAI calls, not retrieval |
| `pipeline-stages.png` | App `/metrics` page → **RAG Pipeline Stages** card (or the Grafana "RAG stage p95" panel) | The per-stage p50/p95/p99 table/panel | Per-stage p95 makes "the API is slow" answerable without opening a trace |
| `eval-compare.png` | App → `/eval/runs` → compare two runs | Two runs side by side with a Hit@5 delta / flip highlighted | Change → re-run → see what regressed → trace why |

## Tips
- Use a **wide** browser window and crop tight — no browser chrome, no empty margins.
- Prefer **dark mode** to match the social preview / existing `live/` shots.
- Retina/2x is fine; GitHub scales down. Aim for ~1600px wide.

## Optional upgrade: a GIF
A ~5s screen recording of clicking a trace row → the waterfall expanding is the
single most compelling artifact. Save as `trace-waterfall.gif` and swap the
README `![...](trace-waterfall.png)` for the gif. Tools: Kap / CleanShot (macOS),
or `ffmpeg` on a screen capture.
