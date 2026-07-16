"""Benchmark the four retrieval strategies on the bundled corpus.

Runs `dataset.jsonl` through each retrieval strategy (vector-similarity,
hybrid-search, reranking, multi-query) and reports, per strategy:

- retrieval quality: Hit@1, Hit@5, MRR (same metrics the eval gate keys on);
- retrieval-stage latency: p50 / p95 wall-clock around `retrieve()`;
- retrieval-stage cost: real OpenAI token usage, priced at current public rates.

Only the *retrieval* stage is measured. Answer generation is deliberately
excluded: the generation call is ~constant across strategies (same top-k chunks
in, one chat completion out), so including it would dilute exactly the
retrieval-side latency/cost differences this table exists to expose.

Cost is captured by wrapping the singleton OpenAI client with a tallying proxy
(`set_openai_client`), so the numbers are measured token usage, not estimates.

Usage (from `backend/`, with Postgres seeded and OPENAI_API_KEY set):

    uv run python eval/benchmark_strategies.py                 # full dataset
    uv run python eval/benchmark_strategies.py --max-cases 5   # cheap smoke
    BENCH_MAX_CASES=5 uv run python eval/benchmark_strategies.py

Writes a machine-readable summary to `eval/benchmark_results.json` and prints a
Markdown table to stdout (paste-ready for docs/BENCHMARKS.md).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

import structlog

from app.db.session import close_db_pool, init_db_pool
from app.llm.openai_client import get_openai_client, set_openai_client
from app.rag.retrieve import retrieve
from eval.run_eval import (
    EvaluationCase,
    calculate_hit_at_k,
    calculate_mrr,
    load_dataset,
)

logger = structlog.get_logger()

STRATEGIES = ["vector-similarity", "hybrid-search", "reranking", "multi-query"]
TOP_K = 8

# Current public OpenAI pricing (USD per 1M tokens) for the demo models. Update
# alongside OPENAI_EMBEDDING_MODEL / OPENAI_CHAT_MODEL if you change them.
PRICING = {
    "embedding_per_1m": 0.02,  # text-embedding-3-small
    "chat_input_per_1m": 0.15,  # gpt-4o-mini input
    "chat_output_per_1m": 0.60,  # gpt-4o-mini output
}


class TallyingClient:
    """Wraps the real OpenAI client and tallies token usage per retrieval.

    Retrieval strategies fetch the client via `get_openai_client()`; injecting
    this proxy with `set_openai_client()` lets us attribute exact embedding and
    chat token counts to whichever strategy is running, with zero changes to
    application code. Unknown attributes fall through to the wrapped client.
    """

    def __init__(self, inner: Any) -> None:
        self._inner = inner
        self.reset()

    def reset(self) -> None:
        self.embed_tokens = 0
        self.chat_prompt_tokens = 0
        self.chat_completion_tokens = 0
        self.embed_calls = 0
        self.chat_calls = 0

    async def create_embedding(self, *args: Any, **kwargs: Any) -> Any:
        resp = await self._inner.create_embedding(*args, **kwargs)
        self.embed_calls += 1
        if resp.token_usage:
            self.embed_tokens += resp.token_usage.total_tokens
        return resp

    async def create_chat_completion(self, *args: Any, **kwargs: Any) -> Any:
        resp = await self._inner.create_chat_completion(*args, **kwargs)
        self.chat_calls += 1
        if resp.token_usage:
            self.chat_prompt_tokens += resp.token_usage.prompt_tokens
            self.chat_completion_tokens += resp.token_usage.completion_tokens
        return resp

    def cost_usd(self) -> float:
        return (
            self.embed_tokens * PRICING["embedding_per_1m"] / 1_000_000
            + self.chat_prompt_tokens * PRICING["chat_input_per_1m"] / 1_000_000
            + self.chat_completion_tokens * PRICING["chat_output_per_1m"] / 1_000_000
        )

    def __getattr__(self, name: str) -> Any:
        return getattr(self._inner, name)


@dataclass
class CaseMeasurement:
    hit_at_1: bool
    hit_at_5: bool
    mrr: float
    latency_ms: float
    cost_usd: float
    embed_calls: int
    chat_calls: int
    error: str | None = None


@dataclass
class StrategySummary:
    strategy: str
    n_cases: int
    n_errors: int
    hit_at_1: float
    hit_at_5: float
    mrr: float
    latency_p50_ms: float
    latency_p95_ms: float
    cost_per_1k_queries_usd: float
    avg_embed_calls: float
    avg_chat_calls: float
    per_case: list[CaseMeasurement] = field(default_factory=list)


def _percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    # Linear interpolation between closest ranks.
    rank = (pct / 100) * (len(ordered) - 1)
    lo = int(rank)
    hi = min(lo + 1, len(ordered) - 1)
    frac = rank - lo
    return ordered[lo] + (ordered[hi] - ordered[lo]) * frac


async def _measure_case(
    tally: TallyingClient,
    case: EvaluationCase,
    strategy: str,
    sleep_s: float,
) -> CaseMeasurement:
    tally.reset()
    start = time.perf_counter()
    try:
        chunks = await retrieve(query=case.query, top_k=TOP_K, rag_model=strategy)
        latency_ms = (time.perf_counter() - start) * 1000
        sources = [c.source for c in chunks if c.source]
        return CaseMeasurement(
            hit_at_1=calculate_hit_at_k(sources, case.expected_sources, 1),
            hit_at_5=calculate_hit_at_k(sources, case.expected_sources, 5),
            mrr=calculate_mrr(sources, case.expected_sources),
            latency_ms=latency_ms,
            cost_usd=tally.cost_usd(),
            embed_calls=tally.embed_calls,
            chat_calls=tally.chat_calls,
        )
    except Exception as exc:  # noqa: BLE001 — one bad case shouldn't kill the sweep
        logger.warning("Benchmark case failed", strategy=strategy, query=case.query, error=str(exc))
        return CaseMeasurement(
            hit_at_1=False,
            hit_at_5=False,
            mrr=0.0,
            latency_ms=(time.perf_counter() - start) * 1000,
            cost_usd=tally.cost_usd(),
            embed_calls=tally.embed_calls,
            chat_calls=tally.chat_calls,
            error=str(exc),
        )
    finally:
        if sleep_s:
            await asyncio.sleep(sleep_s)


async def _run_strategy(
    tally: TallyingClient,
    strategy: str,
    cases: list[EvaluationCase],
    sleep_s: float,
) -> StrategySummary:
    logger.info("Benchmarking strategy", strategy=strategy, n_cases=len(cases))
    measurements: list[CaseMeasurement] = []
    for i, case in enumerate(cases, 1):
        m = await _measure_case(tally, case, strategy, sleep_s)
        measurements.append(m)
        if i % 10 == 0 or i == len(cases):
            logger.info("Progress", strategy=strategy, done=i, total=len(cases))

    ok = [m for m in measurements if m.error is None]
    n = len(measurements)
    quality_base = ok or measurements  # if everything errored, avoid div-by-zero below
    latencies = [m.latency_ms for m in ok] or [m.latency_ms for m in measurements]
    avg_cost = (sum(m.cost_usd for m in quality_base) / len(quality_base)) if quality_base else 0.0

    return StrategySummary(
        strategy=strategy,
        n_cases=n,
        n_errors=n - len(ok),
        hit_at_1=sum(m.hit_at_1 for m in quality_base) / len(quality_base),
        hit_at_5=sum(m.hit_at_5 for m in quality_base) / len(quality_base),
        mrr=sum(m.mrr for m in quality_base) / len(quality_base),
        latency_p50_ms=_percentile(latencies, 50),
        latency_p95_ms=_percentile(latencies, 95),
        cost_per_1k_queries_usd=avg_cost * 1000,
        avg_embed_calls=sum(m.embed_calls for m in quality_base) / len(quality_base),
        avg_chat_calls=sum(m.chat_calls for m in quality_base) / len(quality_base),
        per_case=measurements,
    )


def _markdown_table(summaries: list[StrategySummary]) -> str:
    header = (
        "| Strategy | Hit@1 | Hit@5 | MRR | Retrieval latency p50 / p95 | "
        "Cost / 1k queries | OpenAI calls (embed / chat) |\n"
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: |"
    )
    rows = []
    for s in summaries:
        rows.append(
            f"| `{s.strategy}` | {s.hit_at_1 * 100:.1f}% | {s.hit_at_5 * 100:.1f}% | "
            f"{s.mrr:.3f} | {s.latency_p50_ms:.0f} ms / {s.latency_p95_ms:.0f} ms | "
            f"${s.cost_per_1k_queries_usd:.4f} | "
            f"{s.avg_embed_calls:.0f} / {s.avg_chat_calls:.1f} |"
        )
    return header + "\n" + "\n".join(rows)


async def main() -> None:
    parser = argparse.ArgumentParser(description="Benchmark retrieval strategies on the corpus.")
    parser.add_argument(
        "--max-cases",
        type=int,
        default=int(os.getenv("BENCH_MAX_CASES", "0")) or None,
        help="Limit number of dataset cases (cheap smoke run).",
    )
    parser.add_argument(
        "--sleep",
        type=float,
        default=float(os.getenv("BENCH_SLEEP", "0.2")),
        help="Seconds to pause between cases (avoid rate limits).",
    )
    parser.add_argument(
        "--strategies",
        nargs="+",
        default=STRATEGIES,
        help="Subset of strategies to run.",
    )
    args = parser.parse_args()

    eval_dir = Path(__file__).parent
    cases = load_dataset(eval_dir / "dataset.jsonl")
    if args.max_cases:
        cases = cases[: args.max_cases]
    logger.info("Loaded cases", count=len(cases))

    await init_db_pool()
    tally = TallyingClient(get_openai_client())
    set_openai_client(tally)
    try:
        summaries = []
        for strategy in args.strategies:
            summaries.append(await _run_strategy(tally, strategy, cases, args.sleep))
    finally:
        set_openai_client(None)
        await close_db_pool()

    table = _markdown_table(summaries)
    print("\n" + table + "\n")

    out = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "git_sha": os.getenv("GITHUB_SHA") or os.getenv("GIT_SHA"),
        "n_cases": len(cases),
        "top_k": TOP_K,
        "embedding_model": os.getenv("OPENAI_EMBEDDING_MODEL", ""),
        "chat_model": os.getenv("OPENAI_CHAT_MODEL", ""),
        "pricing_usd_per_1m": PRICING,
        "markdown_table": table,
        "strategies": [{k: v for k, v in asdict(s).items() if k != "per_case"} for s in summaries],
    }
    out_path = eval_dir / "benchmark_results.json"
    out_path.write_text(json.dumps(out, indent=2))
    logger.info("Wrote benchmark results", path=str(out_path))


if __name__ == "__main__":
    asyncio.run(main())
