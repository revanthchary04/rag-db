import structlog
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import PlainTextResponse

from app.core.metrics import get_metrics

logger = structlog.get_logger()

router = APIRouter()


@router.get("/metrics")
async def get_metrics_endpoint(request: Request):
    """Get application metrics."""
    request_id = getattr(request.state, "request_id", "unknown")

    try:
        metrics = get_metrics()
        metrics_data = metrics.get_metrics()

        logger.debug("Metrics retrieved", request_id=request_id)

        return metrics_data
    except Exception as e:
        logger.error(
            "Failed to get metrics",
            request_id=request_id,
            error=str(e),
            exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail="Failed to retrieve metrics",
        )


@router.get("/metrics/prometheus", response_class=PlainTextResponse)
async def get_metrics_prometheus_endpoint(request: Request):
    """In-memory metrics in Prometheus text exposition format (single-process)."""
    request_id = getattr(request.state, "request_id", "unknown")
    try:
        metrics = get_metrics()
        return metrics.prometheus_text()
    except Exception as e:
        logger.error(
            "Failed to export Prometheus metrics",
            request_id=request_id,
            error=str(e),
            exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail="Failed to export metrics",
        )
