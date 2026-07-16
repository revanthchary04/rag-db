import logging
import sys

import structlog
from structlog.types import Processor


def setup_logging() -> None:
    """Configure structured logging with JSON output."""
    shared_processors: list[Processor] = [
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.StackInfoRenderer(),
        structlog.dev.set_exc_info,
        structlog.processors.TimeStamper(fmt="iso"),
    ]

    if sys.stderr.isatty():
        # Development: pretty console output
        processors = shared_processors + [
            structlog.dev.ConsoleRenderer(),
        ]
    else:
        # Production: JSON output
        processors = shared_processors + [
            structlog.processors.dict_tracebacks,
            structlog.processors.JSONRenderer(),
        ]

    structlog.configure(
        processors=processors,
        wrapper_class=structlog.make_filtering_bound_logger(logging.INFO),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )


def log_request(
    request_id: str,
    route: str,
    method: str,
    status_code: int,
    latency_ms: int,
    **kwargs,
) -> None:
    """
    Log HTTP request with structured fields.

    Args:
        request_id: Request ID for correlation
        route: API route path
        method: HTTP method
        status_code: HTTP status code
        latency_ms: Request latency in milliseconds
        **kwargs: Additional fields to log
    """
    logger = structlog.get_logger()
    logger.info(
        "http_request",
        request_id=request_id,
        route=route,
        method=method,
        status_code=status_code,
        latency_ms=latency_ms,
        **kwargs,
    )
