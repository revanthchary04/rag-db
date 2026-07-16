"""Tests for POST /api/v1/query/stream SSE endpoint."""

import json
from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.mark.asyncio
async def test_query_stream_returns_sse_events():
    async def fake_answer_stream(*args, **kwargs):
        yield {"type": "delta", "text": "Hello "}
        yield {"type": "delta", "text": "world"}
        yield {
            "type": "done",
            "answer": "Hello world",
            "citations": [],
            "used_chunk_ids": [],
            "latency_ms": 12,
            "token_usage": None,
            "rag_model": "vector-similarity",
            "retrieved_chunk_count": 0,
        }

    with (
        patch(
            "app.api.routes.query.generate_answer_stream",
            side_effect=fake_answer_stream,
        ),
        patch(
            "app.api.routes.query._prepare_rag_retrieval",
            new_callable=AsyncMock,
            return_value=(None, [], "vector-similarity"),
        ),
    ):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            async with client.stream(
                "POST",
                "/api/v1/query/stream",
                json={"query": "hi", "topK": 5},
            ) as response:
                assert response.status_code == 200
                raw = await response.aread()

    text = raw.decode()
    assert "delta" in text
    assert "done" in text


@pytest.mark.asyncio
async def test_query_stream_done_payload_includes_request_id_and_query_log_id():
    async def fake_answer_stream(*args, **kwargs):
        yield {
            "type": "done",
            "answer": "Hello world",
            "citations": [],
            "used_chunk_ids": [],
            "latency_ms": 12,
            "token_usage": None,
            "rag_model": "vector-similarity",
            "retrieved_chunk_count": 0,
        }

    with (
        patch(
            "app.api.routes.query.generate_answer_stream",
            side_effect=fake_answer_stream,
        ),
        patch(
            "app.api.routes.query._prepare_rag_retrieval",
            new_callable=AsyncMock,
            return_value=(None, [], "vector-similarity"),
        ),
        patch(
            "app.api.routes.query.log_query",
            new_callable=AsyncMock,
            return_value="test-query-log-row-id",
        ),
    ):
        async with app.router.lifespan_context(app):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                async with client.stream(
                    "POST",
                    "/api/v1/query/stream",
                    json={"query": "hi", "topK": 5},
                ) as response:
                    assert response.status_code == 200
                    raw = await response.aread()

    text = raw.decode()
    done_obj = None
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if line.startswith("data: "):
            obj = json.loads(line.removeprefix("data: ").strip())
            if obj.get("type") == "done":
                done_obj = obj
                break
    assert done_obj is not None
    assert done_obj.get("request_id")
    assert done_obj.get("query_log_id") == "test-query-log-row-id"
