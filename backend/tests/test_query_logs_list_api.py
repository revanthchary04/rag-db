"""Tests for query logs list (explorer) endpoint."""

import uuid

import pytest
from httpx import ASGITransport, AsyncClient

from app.db.session import get_db_pool
from app.main import app


@pytest.mark.asyncio
async def test_query_logs_list():
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
                "explorer-list-test",
                "hybrid-search",
                42,
                1,
            )

        async with AsyncClient(transport=transport, base_url="http://test") as client:
            r = await client.get("/api/v1/analytics/query-logs?limit=10")
            assert r.status_code == 200
            logs = r.json()["logs"]
            assert any(x["id"] == qid for x in logs)

            f = await client.get("/api/v1/analytics/query-logs?rag_model=hybrid-search&limit=5")
            assert f.status_code == 200
            assert all(x["rag_model"] == "hybrid-search" for x in f.json()["logs"])
