import structlog
from fastapi import APIRouter, HTTPException, Query

from app.db.analytics_queries import list_chat_query_links
from app.db.queries import (
    get_query_log_by_id,
    get_query_logs,
)
from app.schemas import (
    ChatQueryLinkItem,
    ChatQueryLinksResponse,
    QueryLogDetailResponse,
    QueryLogsListResponse,
)

logger = structlog.get_logger()

router = APIRouter()


@router.get("/analytics/chat-query-links", response_model=ChatQueryLinksResponse)
async def chat_query_links_endpoint(limit: int = Query(50, ge=1, le=200)):
    """Recent chat messages linked to ``queries`` rows (via ``query_log_id``)."""
    rows = await list_chat_query_links(limit=limit)
    return ChatQueryLinksResponse(
        links=[ChatQueryLinkItem(**row) for row in rows],
    )


@router.get("/analytics/query-logs", response_model=QueryLogsListResponse)
async def query_logs_list_endpoint(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    rag_model: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
):
    """List ``queries`` audit rows (newest first) with optional filters."""
    rows = await get_query_logs(
        limit=limit,
        offset=offset,
        rag_model=rag_model,
        start_date=start_date,
        end_date=end_date,
    )
    return QueryLogsListResponse(logs=[QueryLogDetailResponse(**r) for r in rows])


@router.get("/analytics/query-log/{query_id}", response_model=QueryLogDetailResponse)
async def query_log_detail_endpoint(query_id: str):
    """Return one ``queries`` row for observability drill-down from ``query_log_id``."""
    row = await get_query_log_by_id(query_id)
    if not row:
        raise HTTPException(status_code=404, detail="Query log not found")
    return QueryLogDetailResponse(**row)
