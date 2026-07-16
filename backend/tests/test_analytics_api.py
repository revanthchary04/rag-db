"""Tests for read-only analytics endpoints."""

import uuid

import pytest
from httpx import ASGITransport, AsyncClient

from app.db.session import get_db_pool
from app.main import app


@pytest.mark.asyncio
async def test_chat_query_links_joins_queries():
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            tid = (await client.post("/api/v1/chat/threads", json={})).json()["id"]

            pool = await get_db_pool()
            async with pool.acquire() as conn:
                qid = await conn.fetchval(
                    """
                    INSERT INTO queries (id, query_text, rag_model)
                    VALUES ($1, $2, $3)
                    RETURNING id
                    """,
                    str(uuid.uuid4()),
                    "joined-query-text",
                    "vector-similarity",
                )
                assert qid is not None

            await client.post(
                f"/api/v1/chat/threads/{tid}/messages",
                json={
                    "role": "assistant",
                    "content": "reply",
                    "query_log_id": str(qid),
                },
            )

            r = await client.get("/api/v1/analytics/chat-query-links?limit=10")
            assert r.status_code == 200
            data = r.json()
            assert len(data["links"]) >= 1
            row = next(x for x in data["links"] if x["thread_id"] == tid)
            assert row["query_text"] == "joined-query-text"
            assert row["query_log_id"] == str(qid)
