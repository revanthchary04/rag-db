"""Tests for single query log (observability) endpoint."""

import uuid

import pytest
from httpx import ASGITransport, AsyncClient

from app.db.session import get_db_pool
from app.main import app


@pytest.mark.asyncio
async def test_query_log_detail_found_and_missing():
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        qid = str(uuid.uuid4())
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO queries (id, query_text, rag_model, latency_ms, citations_count)
                VALUES ($1, $2, $3, $4, $5)
                """,
                qid,
                "test-query-text",
                "vector-similarity",
                99,
                2,
            )

        async with AsyncClient(transport=transport, base_url="http://test") as client:
            r = await client.get(f"/api/v1/analytics/query-log/{qid}")
            assert r.status_code == 200
            data = r.json()
            assert data["id"] == qid
            assert data["query_text"] == "test-query-text"
            assert data["latency_ms"] == 99

            miss = await client.get(f"/api/v1/analytics/query-log/{uuid.uuid4()}")
            assert miss.status_code == 404
