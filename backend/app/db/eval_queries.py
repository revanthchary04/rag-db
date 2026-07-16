"""Read/write persisted eval harness runs (``eval_runs``, ``eval_case_results``)."""

from __future__ import annotations

import json
from typing import Any

from app.db.session import get_db_pool


def _coerce_json_object(value: Any) -> dict[str, Any]:
    if value is None:
        return {}
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        return json.loads(value) if value.strip() else {}
    return {}


def _coerce_json_list(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        return json.loads(value) if value.strip() else []
    return []


async def insert_eval_run_completed(
    *,
    run_id: str,
    dataset_path: str,
    use_llm_judge: bool,
    total_cases: int,
    successful: int,
    failed: int,
    hit_at_1: float,
    hit_at_3: float,
    hit_at_5: float,
    hit_at_8: float,
    mrr: float,
    llm_judge_correctness_rate: float | None,
    llm_judge_faithfulness_rate: float | None,
    config_json: dict[str, Any],
    case_rows: list[dict[str, Any]],
) -> None:
    """Insert one finished run and all case rows in a single transaction."""
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                """
                INSERT INTO eval_runs (
                  id, finished_at, status, dataset_path, use_llm_judge,
                  total_cases, successful, failed,
                  hit_at_1, hit_at_3, hit_at_5, hit_at_8, mrr,
                  llm_judge_correctness_rate, llm_judge_faithfulness_rate,
                  config_json
                ) VALUES (
                  $1, NOW(), 'completed', $2, $3,
                  $4, $5, $6,
                  $7, $8, $9, $10, $11,
                  $12, $13,
                  $14::jsonb
                )
                """,
                run_id,
                dataset_path,
                use_llm_judge,
                total_cases,
                successful,
                failed,
                hit_at_1,
                hit_at_3,
                hit_at_5,
                hit_at_8,
                mrr,
                llm_judge_correctness_rate,
                llm_judge_faithfulness_rate,
                json.dumps(config_json),
            )
            for row in case_rows:
                await conn.execute(
                    """
                    INSERT INTO eval_case_results (
                      eval_run_id, case_index, case_id, query,
                      expected_sources, retrieved_sources, answer,
                      hit_at_1, hit_at_3, hit_at_5, hit_at_8, mrr,
                      llm_judge_correctness, llm_judge_faithfulness, llm_judge_reasoning,
                      error, citations
                    ) VALUES (
                      $1, $2, $3, $4,
                      $5::jsonb, $6::jsonb, $7,
                      $8, $9, $10, $11, $12,
                      $13, $14, $15,
                      $16, $17::jsonb
                    )
                    """,
                    run_id,
                    row["case_index"],
                    row["case_id"],
                    row["query"],
                    json.dumps(row["expected_sources"]),
                    json.dumps(row["retrieved_sources"]),
                    row["answer"],
                    row["hit_at_1"],
                    row["hit_at_3"],
                    row["hit_at_5"],
                    row["hit_at_8"],
                    row["mrr"],
                    row.get("llm_judge_correctness"),
                    row.get("llm_judge_faithfulness"),
                    row.get("llm_judge_reasoning"),
                    row.get("error"),
                    json.dumps(row.get("citations") or []),
                )


async def list_eval_runs(*, limit: int = 50, offset: int = 0) -> list[dict[str, Any]]:
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT
              id,
              created_at,
              finished_at,
              status,
              dataset_path,
              use_llm_judge,
              total_cases,
              successful,
              failed,
              hit_at_1,
              hit_at_3,
              hit_at_5,
              hit_at_8,
              mrr,
              llm_judge_correctness_rate,
              llm_judge_faithfulness_rate,
              config_json
            FROM eval_runs
            ORDER BY created_at DESC
            LIMIT $1 OFFSET $2
            """,
            limit,
            offset,
        )
    out: list[dict[str, Any]] = []
    for r in rows:
        d = dict(r)
        for k in ("created_at", "finished_at"):
            if d.get(k) is not None:
                d[k] = d[k].isoformat()
        d["config_json"] = _coerce_json_object(d.get("config_json"))
        out.append(d)
    return out


async def get_eval_run(run_id: str) -> dict[str, Any] | None:
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        run = await conn.fetchrow(
            """
            SELECT
              id,
              created_at,
              finished_at,
              status,
              dataset_path,
              use_llm_judge,
              total_cases,
              successful,
              failed,
              hit_at_1,
              hit_at_3,
              hit_at_5,
              hit_at_8,
              mrr,
              llm_judge_correctness_rate,
              llm_judge_faithfulness_rate,
              config_json,
              error_message
            FROM eval_runs
            WHERE id = $1
            """,
            run_id,
        )
        if not run:
            return None
        cases = await conn.fetch(
            """
            SELECT
              id,
              case_index,
              case_id,
              query,
              expected_sources,
              retrieved_sources,
              answer,
              hit_at_1,
              hit_at_3,
              hit_at_5,
              hit_at_8,
              mrr,
              llm_judge_correctness,
              llm_judge_faithfulness,
              llm_judge_reasoning,
              error,
              citations
            FROM eval_case_results
            WHERE eval_run_id = $1
            ORDER BY case_index ASC
            """,
            run_id,
        )

    rd = dict(run)
    for k in ("created_at", "finished_at"):
        if rd.get(k) is not None:
            rd[k] = rd[k].isoformat()
    rd["config_json"] = _coerce_json_object(rd.get("config_json"))

    case_list: list[dict[str, Any]] = []
    for c in cases:
        cd = dict(c)
        cd["expected_sources"] = _coerce_json_list(cd.get("expected_sources"))
        cd["retrieved_sources"] = _coerce_json_list(cd.get("retrieved_sources"))
        cd["citations"] = _coerce_json_list(cd.get("citations"))
        case_list.append(cd)
    rd["cases"] = case_list
    return rd
