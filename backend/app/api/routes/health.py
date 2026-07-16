import structlog
from fastapi import APIRouter, Request

from app.db.session import check_db_connection
from app.schemas import (
    HealthResponse,
)

logger = structlog.get_logger()

router = APIRouter()


@router.get("/health", response_model=HealthResponse)
async def health_check(request: Request):
    """Health check endpoint with database connectivity."""
    request_id = getattr(request.state, "request_id", "unknown")
    db_connected = await check_db_connection()

    if not db_connected:
        logger.warning(
            "Health check failed",
            request_id=request_id,
            database_connected=False,
        )

    return HealthResponse(
        ok=db_connected,
        db=db_connected,
        version="0.1.0",
    )
