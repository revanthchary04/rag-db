import secrets
import time
import uuid
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes import router
from app.core.config import settings
from app.core.logging import log_request, setup_logging
from app.core.metrics import get_metrics
from app.core.rate_limit import get_rate_limiter
from app.core.rate_limit_redis import get_redis_rate_limiter
from app.db.session import close_db_pool, init_db_pool

logger = structlog.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan events."""
    setup_logging()
    logger.info("Starting application", environment=settings.ENVIRONMENT)

    # Loudly flag the abuse/cost hole: a production backend with no API key accepts
    # unauthenticated requests straight to billed OpenAI calls.
    if settings.is_production and not settings.API_KEY.strip():
        logger.warning(
            "API_KEY is not set in a production environment — the backend accepts "
            "unauthenticated requests to billed endpoints. Set API_KEY here and "
            "BACKEND_API_KEY on the frontend proxy so only the trusted frontend can "
            "reach it. See docs/HARDENING.md.",
        )

    await init_db_pool()

    # Initialize Redis rate limiter if enabled
    redis_limiter = get_redis_rate_limiter()
    if redis_limiter:
        logger.info("Redis rate limiting enabled")

    try:
        yield
    finally:
        # Always tear down on shutdown, even if the app raised — otherwise the
        # asyncpg pool leaks (and under pytest, where each test gets its own event
        # loop, a leaked pool bound to a closed loop breaks every later test).
        logger.info("Shutting down application")
        if redis_limiter:
            try:
                await redis_limiter.close()
            except Exception:
                logger.exception("Failed to close Redis rate limiter")
        await close_db_pool()


app = FastAPI(
    title="RAG Eval Observability API",
    description="FastAPI backend for RAG evaluation and observability",
    version="0.1.0",
    lifespan=lifespan,
)

if settings.OTEL_ENABLED:
    try:
        from opentelemetry import trace
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor

        resource = Resource.create(
            {
                "service.name": settings.OTEL_SERVICE_NAME,
            }
        )
        provider = TracerProvider(resource=resource)
        provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
        trace.set_tracer_provider(provider)
        FastAPIInstrumentor.instrument_app(app)
        logger.info(
            "OpenTelemetry enabled",
            service_name=settings.OTEL_SERVICE_NAME,
        )
    except ImportError:
        logger.warning(
            "OTEL_ENABLED is true but OpenTelemetry packages are missing; "
            "install with: uv sync --extra otel",
        )

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE", "PATCH"],
    allow_headers=["Content-Type", "Authorization", "X-Request-ID", "X-API-Key"],
    expose_headers=["X-Request-ID"],
)


@app.middleware("http")
async def optional_api_key_middleware(request: Request, call_next):
    """When API_KEY is set, require Authorization: Bearer <key> or X-API-Key header."""
    if not settings.API_KEY.strip():
        return await call_next(request)

    path = request.url.path
    if (
        path in ("/", "/api/v1/health", "/api/v1/metrics", "/api/v1/metrics/prometheus")
        or request.method == "OPTIONS"
    ):
        return await call_next(request)

    auth = (request.headers.get("Authorization") or "").strip()
    bearer = ""
    if auth.lower().startswith("bearer "):
        bearer = auth[7:].strip()
    header_key = (request.headers.get("X-API-Key") or "").strip()

    # Constant-time comparison so a wrong key can't be recovered by timing.
    def _matches(candidate: str) -> bool:
        return bool(candidate) and secrets.compare_digest(candidate, settings.API_KEY)

    if _matches(bearer) or _matches(header_key):
        return await call_next(request)

    return JSONResponse(
        status_code=401,
        content={"detail": "Invalid or missing API key"},
    )


@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    """Rate limiting middleware."""
    # Skip rate limiting for health, metrics endpoints, and OPTIONS (CORS preflight)
    if (
        request.url.path in ["/api/v1/health", "/api/v1/metrics", "/api/v1/metrics/prometheus", "/"]
        or request.method == "OPTIONS"
    ):
        return await call_next(request)

    # Get client IP
    client_ip = request.client.host if request.client else "unknown"
    # Try to get real IP from proxy headers
    forwarded_for = request.headers.get("X-Forwarded-For")
    if forwarded_for:
        client_ip = forwarded_for.split(",")[0].strip()

    # Check rate limit (use Redis if available, otherwise in-memory)
    redis_limiter = get_redis_rate_limiter()
    if redis_limiter:
        # Use Redis-based distributed rate limiting
        is_allowed, remaining = await redis_limiter.is_allowed(client_ip)
        max_requests = redis_limiter.max_requests
        window_seconds = redis_limiter.window_seconds
    else:
        # Fall back to in-memory rate limiting
        rate_limiter = get_rate_limiter()
        is_allowed, remaining = rate_limiter.is_allowed(client_ip)
        max_requests = rate_limiter.max_requests
        window_seconds = rate_limiter.window_seconds

    if not is_allowed:
        logger.warning(
            "Rate limit exceeded",
            client_ip=client_ip,
            path=request.url.path,
        )
        return JSONResponse(
            status_code=429,
            content={
                "error": "Rate limit exceeded",
                "message": f"Too many requests. Limit: {max_requests} per {window_seconds}s",
            },
            headers={"Retry-After": str(window_seconds)},
        )

    # Process request
    response = await call_next(request)

    # Add rate limit headers
    response.headers["X-RateLimit-Remaining"] = str(remaining)
    response.headers["X-RateLimit-Limit"] = str(max_requests)
    return response


@app.middleware("http")
async def add_request_id_and_timing(request: Request, call_next):
    """Add request ID and timing to all requests."""
    # Get or generate request ID
    request_id = request.headers.get("X-Request-ID")
    if not request_id:
        request_id = str(uuid.uuid4())

    request.state.request_id = request_id
    request.state.start_time = time.time()

    structlog.contextvars.clear_contextvars()
    structlog.contextvars.bind_contextvars(request_id=request_id)

    # Correlate logs with the active trace (no-op when OTel is disabled), so a
    # log line, its distributed trace, and the query audit row all share an id.
    from app.core.tracing import current_trace_id

    trace_id = current_trace_id()
    if trace_id:
        structlog.contextvars.bind_contextvars(trace_id=trace_id)

    # Process request
    response = await call_next(request)

    # Calculate latency
    latency_ms = int((time.time() - request.state.start_time) * 1000)

    # Add request ID to response
    response.headers["X-Request-ID"] = request_id

    # Extract route path
    route = request.url.path
    # Try to get route from FastAPI's scope if available
    if hasattr(request, "scope") and request.scope:
        route_obj = request.scope.get("route")
        if route_obj and hasattr(route_obj, "path"):
            route = route_obj.path

    log_request(
        request_id=request_id,
        route=route,
        method=request.method,
        status_code=response.status_code,
        latency_ms=latency_ms,
    )

    # Record metrics
    metrics = get_metrics()
    metrics.record_request(
        route=route,
        status_code=response.status_code,
        latency_ms=latency_ms,
    )

    return response


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Global exception handler with structured logging."""
    request_id = getattr(request.state, "request_id", "unknown")
    logger.error(
        "Unhandled exception",
        request_id=request_id,
        path=request.url.path,
        method=request.method,
        error=str(exc),
        exc_info=exc,
    )

    # Get origin from request headers for CORS
    origin = request.headers.get("origin")
    headers = {}
    if origin and origin in settings.cors_origins_list:
        headers["Access-Control-Allow-Origin"] = origin
        headers["Access-Control-Allow-Credentials"] = "true"

    return JSONResponse(
        status_code=500,
        content={
            "error": "Internal server error",
            "request_id": request_id,
            "detail": str(exc) if settings.DEBUG else "Internal server error",
        },
        headers=headers,
    )


app.include_router(router, prefix="/api/v1")


@app.get("/")
async def root():
    """Root endpoint."""
    return {"message": "RAG Eval Observability API", "version": "0.1.0"}
