#!/usr/bin/env python3
"""
Evaluation harness for RAG system.

Runs evaluation directly (not via HTTP) and produces metrics and report.
"""

import asyncio
import json
import os
import sys
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

import structlog
from dotenv import load_dotenv

from app.core.logging import setup_logging
from app.db.eval_queries import insert_eval_run_completed
from app.db.session import close_db_pool, init_db_pool
from app.llm.openai_client import get_openai_client
from app.rag.answer import generate_answer
from app.rag.retrieve import retrieve

# Load environment variables
load_dotenv()

# Setup logging
setup_logging()
logger = structlog.get_logger()


@dataclass
class EvaluationCase:
    """Single evaluation case."""

    query: str
    expected_sources: list[str]
    expected_answer_contains: list[str]


@dataclass
class EvaluationResult:
    """Result for a single evaluation case."""

    query: str
    expected_sources: list[str]
    retrieved_sources: list[str]
    answer: str
    hit_at_1: bool
    hit_at_3: bool
    hit_at_5: bool
    hit_at_8: bool
    mrr: float
    llm_judge_correctness: bool | None = None
    llm_judge_faithfulness: bool | None = None
    llm_judge_reasoning: str | None = None
    error: str | None = None
    citations: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class EvaluationSummary:
    """Summary of all evaluation results."""

    total_cases: int
    successful: int
    failed: int
    hit_at_1: float
    hit_at_3: float
    hit_at_5: float
    hit_at_8: float
    mrr: float
    llm_judge_correctness_rate: float | None = None
    llm_judge_faithfulness_rate: float | None = None
    failure_examples: list[dict[str, Any]] = field(default_factory=list)


def load_dataset(dataset_path: Path) -> list[EvaluationCase]:
    """Load evaluation dataset from JSONL file."""
    cases = []
    with open(dataset_path) as f:
        for line in f:
            if line.strip():
                data = json.loads(line)
                cases.append(
                    EvaluationCase(
                        query=data["query"],
                        expected_sources=data.get("expected_sources", []),
                        expected_answer_contains=data.get("expected_answer_contains", []),
                    )
                )
    return cases


def calculate_hit_at_k(retrieved_sources: list[str], expected_sources: list[str], k: int) -> bool:
    """Calculate hit@k: whether any expected source is in top k retrieved."""
    if not expected_sources:
        return False
    top_k_sources = retrieved_sources[:k]
    # Check if any expected source appears in retrieved sources
    for expected in expected_sources:
        # Direct match or substring match
        for retrieved in top_k_sources:
            if expected.lower() in retrieved.lower() or retrieved.lower() in expected.lower():
                return True
    return False


def calculate_mrr(retrieved_sources: list[str], expected_sources: list[str]) -> float:
    """Calculate Mean Reciprocal Rank."""
    if not expected_sources:
        return 0.0

    for rank, source in enumerate(retrieved_sources, start=1):
        for expected in expected_sources:
            # Case-insensitive matching
            if expected.lower() in source.lower() or source.lower() in expected.lower():
                return 1.0 / rank
    return 0.0


def _extract_json_object(text: str | None) -> dict[str, Any] | None:
    """Best-effort extraction of the first JSON object from an LLM response.

    Handles a pure-JSON response, an object wrapped in ```json fences or prose,
    and — unlike a ``\\{[^}]+\\}`` regex — a ``}`` inside a string value (e.g. the
    free-text ``reasoning`` field), by scanning for a *balanced* top-level object
    while respecting string literals and escapes. Returns ``None`` if no object
    parses.
    """
    if not text:
        return None
    s = text.strip()

    # Fast path: the whole response is already a JSON object.
    try:
        obj = json.loads(s)
        return obj if isinstance(obj, dict) else None
    except json.JSONDecodeError:
        pass

    # Otherwise scan for the first balanced {...}, ignoring braces inside strings.
    start = s.find("{")
    while start != -1:
        depth = 0
        in_str = False
        esc = False
        for i in range(start, len(s)):
            c = s[i]
            if in_str:
                if esc:
                    esc = False
                elif c == "\\":
                    esc = True
                elif c == '"':
                    in_str = False
            elif c == '"':
                in_str = True
            elif c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    try:
                        obj = json.loads(s[start : i + 1])
                        if isinstance(obj, dict):
                            return obj
                    except json.JSONDecodeError:
                        pass
                    break  # this '{' didn't yield valid JSON; try the next one
        start = s.find("{", start + 1)
    return None


async def llm_judge_correctness(
    query: str, answer: str, expected_answer_contains: list[str]
) -> dict[str, Any]:
    """
    Use LLM to judge answer correctness and faithfulness.

    Returns dict with correctness, faithfulness, and reasoning.
    """
    try:
        openai_client = get_openai_client()

        # Build judgment prompt
        expected_keywords = ", ".join(expected_answer_contains)
        prompt = f"""You are an evaluator judging RAG system answers.

Question: {query}

Generated Answer: {answer}

Expected answer should contain these concepts: {expected_keywords}

Evaluate:
1. Correctness: Does the answer correctly address the question? (true/false)
2. Faithfulness: Is the answer grounded in the provided context, not hallucinated? (true/false)

Respond in JSON format:
{{
  "correctness": true/false,
  "faithfulness": true/false,
  "reasoning": "brief explanation"
}}"""

        messages = [
            {
                "role": "system",
                "content": "You are a precise evaluator. Respond only with valid JSON.",
            },
            {"role": "user", "content": prompt},
        ]

        response = await openai_client.create_chat_completion(
            messages=messages, temperature=0.0, max_tokens=200
        )

        # Parse the JSON verdict. The model is asked for a flat object, but a `}`
        # inside the free-text "reasoning" would truncate a naive regex — so use a
        # balanced-brace extractor that ignores braces inside strings.
        judgment = _extract_json_object(response.content)
        if judgment is not None:
            return {
                "correctness": judgment.get("correctness", False),
                "faithfulness": judgment.get("faithfulness", False),
                "reasoning": judgment.get("reasoning", ""),
            }
        else:
            return {
                "correctness": False,
                "faithfulness": False,
                "reasoning": "Failed to parse LLM judgment",
            }

    except Exception as e:
        logger.warning("LLM judgment failed", error=str(e))
        return {
            "correctness": None,
            "faithfulness": None,
            "reasoning": f"Error: {str(e)}",
        }


async def evaluate_case(case: EvaluationCase, use_llm_judge: bool = False) -> EvaluationResult:
    """Evaluate a single case."""
    try:
        # Retrieve chunks
        retrieved_chunks = await retrieve(query=case.query, top_k=8)

        # Extract retrieved sources
        retrieved_sources = [chunk.source for chunk in retrieved_chunks if chunk.source]

        # Calculate retrieval metrics
        hit_at_1 = calculate_hit_at_k(retrieved_sources, case.expected_sources, 1)
        hit_at_3 = calculate_hit_at_k(retrieved_sources, case.expected_sources, 3)
        hit_at_5 = calculate_hit_at_k(retrieved_sources, case.expected_sources, 5)
        hit_at_8 = calculate_hit_at_k(retrieved_sources, case.expected_sources, 8)
        mrr = calculate_mrr(retrieved_sources, case.expected_sources)

        # Generate answer
        answer_response = await generate_answer(query=case.query, retrieved_chunks=retrieved_chunks)
        answer = answer_response.answer

        # LLM judgment (optional)
        llm_judge_correctness = None
        llm_judge_faithfulness = None
        llm_judge_reasoning = None

        if use_llm_judge:
            judgment = await llm_judge_correctness(
                case.query, answer, case.expected_answer_contains
            )
            llm_judge_correctness = judgment["correctness"]
            llm_judge_faithfulness = judgment["faithfulness"]
            llm_judge_reasoning = judgment["reasoning"]

        return EvaluationResult(
            query=case.query,
            expected_sources=case.expected_sources,
            retrieved_sources=retrieved_sources,
            answer=answer,
            hit_at_1=hit_at_1,
            hit_at_3=hit_at_3,
            hit_at_5=hit_at_5,
            hit_at_8=hit_at_8,
            mrr=mrr,
            llm_judge_correctness=llm_judge_correctness,
            llm_judge_faithfulness=llm_judge_faithfulness,
            llm_judge_reasoning=llm_judge_reasoning,
            citations=list(answer_response.citations),
        )

    except Exception as e:
        logger.error("Evaluation case failed", query=case.query, error=str(e))
        return EvaluationResult(
            query=case.query,
            expected_sources=case.expected_sources,
            retrieved_sources=[],
            answer="",
            hit_at_1=False,
            hit_at_3=False,
            hit_at_5=False,
            hit_at_8=False,
            mrr=0.0,
            error=str(e),
            citations=[],
        )


def generate_report(summary: EvaluationSummary, results: list[EvaluationResult]) -> str:
    """Generate markdown report."""
    report = f"""# RAG Evaluation Report

Generated: {time.strftime("%Y-%m-%d %H:%M:%S")}

## Summary

| Metric | Value |
|--------|-------|
| Total Cases | {summary.total_cases} |
| Successful | {summary.successful} |
| Failed | {summary.failed} |
| Hit@1 | {summary.hit_at_1:.2%} |
| Hit@3 | {summary.hit_at_3:.2%} |
| Hit@5 | {summary.hit_at_5:.2%} |
| Hit@8 | {summary.hit_at_8:.2%} |
| MRR | {summary.mrr:.3f} |
"""

    if summary.llm_judge_correctness_rate is not None:
        report += f"""| LLM Judge Correctness | {summary.llm_judge_correctness_rate:.2%} |
| LLM Judge Faithfulness | {summary.llm_judge_faithfulness_rate:.2%} |
"""

    report += "\n## Retrieval Metrics\n\n"
    report += "Hit@K measures whether any expected source appears in the top K retrieved results.\n"
    report += "MRR (Mean Reciprocal Rank) measures the average reciprocal rank of the first relevant result.\n\n"

    if summary.failure_examples:
        report += "## Failure Examples\n\n"
        for i, failure in enumerate(summary.failure_examples[:5], 1):
            report += f"### Example {i}\n\n"
            report += f"**Query:** {failure['query']}\n\n"
            report += f"**Expected Sources:** {', '.join(failure['expected_sources'])}\n\n"
            report += f"**Retrieved Sources:** {', '.join(failure['retrieved_sources'][:5])}\n\n"
            report += f"**Answer:** {failure['answer'][:200]}...\n\n"
            if failure.get("llm_judge_reasoning"):
                report += f"**LLM Judgment:** {failure['llm_judge_reasoning']}\n\n"
            report += "\n"

    return report


def write_summary_json(
    path: Path,
    summary: EvaluationSummary,
    results: list[EvaluationResult],
    config: dict[str, Any],
) -> None:
    """Write a machine-readable run summary for CI comparison (compare_eval.py).

    Kept intentionally small: aggregate metrics plus per-case ``hit_at_5`` / ``mrr``
    keyed by ``case_id`` so the gate can compute deltas and detect Hit@5 flips
    without a database.
    """
    payload = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "git_sha": os.getenv("GITHUB_SHA") or os.getenv("GIT_SHA") or None,
        "config": config,
        "metrics": {
            "hit_at_1": summary.hit_at_1,
            "hit_at_3": summary.hit_at_3,
            "hit_at_5": summary.hit_at_5,
            "hit_at_8": summary.hit_at_8,
            "mrr": summary.mrr,
            "llm_judge_correctness_rate": summary.llm_judge_correctness_rate,
            "llm_judge_faithfulness_rate": summary.llm_judge_faithfulness_rate,
        },
        "cases": [
            {
                "case_id": f"case-{i}",
                "query": r.query,
                "hit_at_5": r.hit_at_5,
                "mrr": r.mrr,
            }
            for i, r in enumerate(results, start=1)
        ],
    }
    with open(path, "w") as f:
        json.dump(payload, f, indent=2)


def _eval_record_chat_enabled() -> bool:
    return os.getenv("EVAL_RECORD_CHAT", "").strip().lower() in ("1", "true", "yes")


def _eval_persist_runs_enabled() -> bool:
    return os.getenv("EVAL_PERSIST_RUNS", "true").strip().lower() not in ("0", "false", "no")


async def _persist_eval_turn_to_db(
    *,
    eval_run_id: str,
    case_index: int,
    case: EvaluationCase,
    result: EvaluationResult,
    thread_slot: dict[str, str | None],
) -> None:
    """Append eval user/assistant turns to one Postgres chat thread (same DB pool as retrieval)."""
    from app.db.chat_queries import append_chat_message, create_chat_thread

    case_key = f"case-{case_index}"
    if thread_slot.get("id") is None:
        row = await create_chat_thread(title=f"Eval {eval_run_id[:8]}")
        thread_slot["id"] = row["id"]

    tid = thread_slot["id"]
    assert tid is not None

    await append_chat_message(
        tid,
        role="user",
        content=case.query,
        metadata={"source": "eval"},
        eval_run_id=eval_run_id,
        eval_case_id=case_key,
    )
    assistant_body = result.answer if not result.error else f"[error] {result.error}"
    meta: dict[str, Any] = {"source": "eval", "hit_at_5": result.hit_at_5}
    if result.error:
        meta["error"] = result.error
    await append_chat_message(
        tid,
        role="assistant",
        content=assistant_body or "",
        citations=result.citations or [],
        metadata=meta,
        eval_run_id=eval_run_id,
        eval_case_id=case_key,
    )


async def run_evaluation():
    """Run the evaluation harness."""
    # Load configuration
    use_llm_judge = os.getenv("EVAL_USE_LLM_JUDGE", "false").lower() == "true"

    # Load dataset
    eval_dir = Path(__file__).parent
    dataset_path = eval_dir / "dataset.jsonl"
    report_path = eval_dir / "report.md"

    logger.info("Loading evaluation dataset", dataset_path=str(dataset_path))
    cases = load_dataset(dataset_path)
    max_cases_raw = os.getenv("EVAL_MAX_CASES", "").strip()
    if max_cases_raw.isdigit():
        n = int(max_cases_raw)
        if n > 0:
            cases = cases[:n]
            logger.info("Truncated dataset via EVAL_MAX_CASES", max_cases=n)
    logger.info("Loaded cases", count=len(cases))

    await init_db_pool()
    try:
        run_id = str(uuid.uuid4())
        record_chat = _eval_record_chat_enabled()
        thread_slot: dict[str, str | None] = {"id": None}
        if record_chat:
            logger.info(
                "EVAL_RECORD_CHAT enabled — persisting turns to chat_threads/chat_messages",
                eval_run_id=run_id,
            )

        # Run evaluation
        results = []
        for i, case in enumerate(cases, 1):
            logger.info("Evaluating case", case_num=i, total=len(cases), query=case.query)
            result = await evaluate_case(case, use_llm_judge=use_llm_judge)
            results.append(result)

            if record_chat:
                try:
                    await _persist_eval_turn_to_db(
                        eval_run_id=run_id,
                        case_index=i,
                        case=case,
                        result=result,
                        thread_slot=thread_slot,
                    )
                except Exception as rec_err:
                    logger.warning(
                        "EVAL_RECORD_CHAT persist failed",
                        case_num=i,
                        error=str(rec_err),
                        exc_info=True,
                    )

            # Small delay to avoid rate limits
            if i < len(cases):
                await asyncio.sleep(0.5)

        # Calculate summary
        successful = sum(1 for r in results if not r.error)
        failed = len(results) - successful

        hit_at_1_count = sum(1 for r in results if r.hit_at_1)
        hit_at_3_count = sum(1 for r in results if r.hit_at_3)
        hit_at_5_count = sum(1 for r in results if r.hit_at_5)
        hit_at_8_count = sum(1 for r in results if r.hit_at_8)
        mrr_sum = sum(r.mrr for r in results)

        summary = EvaluationSummary(
            total_cases=len(results),
            successful=successful,
            failed=failed,
            hit_at_1=hit_at_1_count / len(results) if results else 0.0,
            hit_at_3=hit_at_3_count / len(results) if results else 0.0,
            hit_at_5=hit_at_5_count / len(results) if results else 0.0,
            hit_at_8=hit_at_8_count / len(results) if results else 0.0,
            mrr=mrr_sum / len(results) if results else 0.0,
        )

        # LLM judge metrics
        if use_llm_judge:
            correctness_count = sum(1 for r in results if r.llm_judge_correctness is True)
            faithfulness_count = sum(1 for r in results if r.llm_judge_faithfulness is True)
            judged_count = sum(1 for r in results if r.llm_judge_correctness is not None)

            if judged_count > 0:
                summary.llm_judge_correctness_rate = correctness_count / judged_count
                summary.llm_judge_faithfulness_rate = faithfulness_count / judged_count

        # Collect failure examples
        failure_examples = []
        for result in results:
            if not result.hit_at_5 or result.error:
                failure_examples.append(
                    {
                        "query": result.query,
                        "expected_sources": result.expected_sources,
                        "retrieved_sources": result.retrieved_sources,
                        "answer": result.answer,
                        "llm_judge_reasoning": result.llm_judge_reasoning,
                    }
                )
        summary.failure_examples = failure_examples[:10]  # Top 10 failures

        # Generate and save report
        report = generate_report(summary, results)
        with open(report_path, "w") as f:
            f.write(report)

        # Machine-readable summary for the CI regression gate (compare_eval.py).
        summary_config = {
            "embedding_model": os.getenv("OPENAI_EMBEDDING_MODEL", ""),
            "chat_model": os.getenv("OPENAI_CHAT_MODEL", ""),
            "dataset": dataset_path.name,
            "total_cases": summary.total_cases,
            "use_llm_judge": use_llm_judge,
        }
        summary_path = eval_dir / "summary.json"
        write_summary_json(summary_path, summary, results, summary_config)

        logger.info(
            "Evaluation completed",
            report_path=str(report_path),
            summary_path=str(summary_path),
            hit_at_1=summary.hit_at_1,
            hit_at_5=summary.hit_at_5,
            mrr=summary.mrr,
        )

        if _eval_persist_runs_enabled():
            case_rows = []
            for i, result in enumerate(results, start=1):
                case_rows.append(
                    {
                        "case_index": i,
                        "case_id": f"case-{i}",
                        "query": result.query,
                        "expected_sources": result.expected_sources,
                        "retrieved_sources": result.retrieved_sources,
                        "answer": result.answer,
                        "hit_at_1": result.hit_at_1,
                        "hit_at_3": result.hit_at_3,
                        "hit_at_5": result.hit_at_5,
                        "hit_at_8": result.hit_at_8,
                        "mrr": result.mrr,
                        "llm_judge_correctness": result.llm_judge_correctness,
                        "llm_judge_faithfulness": result.llm_judge_faithfulness,
                        "llm_judge_reasoning": result.llm_judge_reasoning,
                        "error": result.error,
                        "citations": result.citations,
                    }
                )
            config_json = {
                "openai_embedding_model": os.getenv("OPENAI_EMBEDDING_MODEL", ""),
                "openai_chat_model": os.getenv("OPENAI_CHAT_MODEL", ""),
                "eval_max_cases": max_cases_raw or None,
                "eval_use_llm_judge": use_llm_judge,
            }
            try:
                await insert_eval_run_completed(
                    run_id=run_id,
                    dataset_path=str(dataset_path.resolve()),
                    use_llm_judge=use_llm_judge,
                    total_cases=summary.total_cases,
                    successful=summary.successful,
                    failed=summary.failed,
                    hit_at_1=summary.hit_at_1,
                    hit_at_3=summary.hit_at_3,
                    hit_at_5=summary.hit_at_5,
                    hit_at_8=summary.hit_at_8,
                    mrr=summary.mrr,
                    llm_judge_correctness_rate=summary.llm_judge_correctness_rate,
                    llm_judge_faithfulness_rate=summary.llm_judge_faithfulness_rate,
                    config_json=config_json,
                    case_rows=case_rows,
                )
                logger.info("Persisted eval run to database", eval_run_id=run_id)
            except Exception as persist_err:
                logger.warning(
                    "Failed to persist eval run",
                    error=str(persist_err),
                    exc_info=True,
                )

        # Print summary to console
        print("\n" + "=" * 60)
        print("EVALUATION SUMMARY")
        print("=" * 60)
        print(f"Total Cases: {summary.total_cases}")
        print(f"Successful: {summary.successful}")
        print(f"Failed: {summary.failed}")
        print("\nRetrieval Metrics:")
        print(f"  Hit@1: {summary.hit_at_1:.2%}")
        print(f"  Hit@3: {summary.hit_at_3:.2%}")
        print(f"  Hit@5: {summary.hit_at_5:.2%}")
        print(f"  Hit@8: {summary.hit_at_8:.2%}")
        print(f"  MRR: {summary.mrr:.3f}")
        if summary.llm_judge_correctness_rate is not None:
            print("\nLLM Judge Metrics:")
            print(f"  Correctness: {summary.llm_judge_correctness_rate:.2%}")
            print(f"  Faithfulness: {summary.llm_judge_faithfulness_rate:.2%}")
        print(f"\nReport saved to: {report_path}")
        if _eval_persist_runs_enabled():
            print(f"Eval run id (database): {run_id}")
        print("=" * 60 + "\n")
    finally:
        await close_db_pool()


if __name__ == "__main__":
    try:
        asyncio.run(run_evaluation())
    except KeyboardInterrupt:
        logger.info("Evaluation interrupted by user")
        sys.exit(1)
    except Exception as e:
        logger.error("Evaluation failed", error=str(e), exc_info=True)
        sys.exit(1)
