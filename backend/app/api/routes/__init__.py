"""API routes, split by resource. `router` aggregates every sub-router."""

from fastapi import APIRouter

from . import (
    analytics,
    chat,
    documents,
    eval,
    health,
    ingest,
    metrics,
    query,
    search,
)

router = APIRouter()
router.include_router(health.router)
router.include_router(search.router)
router.include_router(documents.router)
router.include_router(chat.router)
router.include_router(ingest.router)
router.include_router(query.router)
router.include_router(analytics.router)
router.include_router(eval.router)
router.include_router(metrics.router)
