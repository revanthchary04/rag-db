import csv
import io

import structlog
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from app.db.eval_queries import get_eval_run, list_eval_runs
from app.schemas import (
    EvalCaseResultResponse,
    EvalRunDetailResponse,
    EvalRunListResponse,
    EvalRunSummaryResponse,
)

logger = structlog.get_logger()

router = APIRouter()


def _row_to_eval_run_detail(row: dict) -> EvalRunDetailResponse:
    r = {**row}
    cases_raw = r.pop("cases", [])
    err = r.pop("error_message", None)
    summary = EvalRunSummaryResponse(**r)
    return EvalRunDetailResponse(
        **summary.model_dump(),
        error_message=err,
        cases=[EvalCaseResultResponse(**c) for c in cases_raw],
    )


def _eval_run_detail_to_csv(detail: EvalRunDetailResponse) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(
        [
            "run_id",
            "created_at",
            "dataset_path",
            "hit_at_1",
            "hit_at_3",
            "hit_at_5",
            "hit_at_8",
            "mrr",
            "successful",
            "failed",
            "total_cases",
        ]
    )
    w.writerow(
        [
            detail.id,
            detail.created_at,
            detail.dataset_path,
            detail.hit_at_1,
            detail.hit_at_3,
            detail.hit_at_5,
            detail.hit_at_8,
            detail.mrr,
            detail.successful,
            detail.failed,
            detail.total_cases,
        ]
    )
    w.writerow([])
    w.writerow(
        [
            "case_index",
            "case_id",
            "query",
            "hit_at_1",
            "hit_at_3",
            "hit_at_5",
            "hit_at_8",
            "mrr",
            "error",
        ]
    )
    for c in detail.cases:
        w.writerow(
            [
                c.case_index,
                c.case_id,
                c.query,
                c.hit_at_1,
                c.hit_at_3,
                c.hit_at_5,
                c.hit_at_8,
                c.mrr,
                c.error or "",
            ]
        )
    return buf.getvalue()


@router.get("/eval/runs", response_model=EvalRunListResponse)
async def eval_runs_list_endpoint(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """List persisted RAG eval harness runs (newest first)."""
    rows = await list_eval_runs(limit=limit, offset=offset)
    return EvalRunListResponse(runs=[EvalRunSummaryResponse(**row) for row in rows])


@router.get("/eval/runs/{run_id}/export")
async def eval_run_export_endpoint(
    run_id: str,
    format: str = Query("json", description="Export as json or csv"),
):
    """Download one persisted eval run (full detail) for archival or CI artifacts."""
    fmt = format.lower().strip()
    if fmt not in ("json", "csv"):
        raise HTTPException(status_code=400, detail="format must be json or csv")
    row = await get_eval_run(run_id)
    if not row:
        raise HTTPException(status_code=404, detail="Eval run not found")
    detail = _row_to_eval_run_detail(row)
    if fmt == "json":
        return Response(
            content=detail.model_dump_json(indent=2),
            media_type="application/json",
            headers={
                "Content-Disposition": f'attachment; filename="eval-run-{run_id}.json"',
            },
        )
    return Response(
        content=_eval_run_detail_to_csv(detail),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="eval-run-{run_id}.csv"',
        },
    )


@router.get("/eval/runs/{run_id}", response_model=EvalRunDetailResponse)
async def eval_run_detail_endpoint(run_id: str):
    """Return one eval run with all per-case results."""
    row = await get_eval_run(run_id)
    if not row:
        raise HTTPException(status_code=404, detail="Eval run not found")
    return _row_to_eval_run_detail(row)
