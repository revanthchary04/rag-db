"""API tests for Postgres chat threads/messages and observability linkage."""

from __future__ import annotations

import uuid
from unittest.mock import patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.config import settings
from app.db.session import get_db_pool
from app.main import app
from app.rag.answer import AnswerResponse


@pytest.mark.asyncio
async def test_chat_thread_crud_and_message_sequence():
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            r = await client.post("/api/v1/chat/threads", json={"title": "intro"})
            assert r.status_code == 200
            tid = r.json()["id"]

            m1 = await client.post(
                f"/api/v1/chat/threads/{tid}/messages",
                json={"role": "user", "content": "hello"},
            )
            assert m1.status_code == 200
            assert m1.json()["seq"] == 1

            m2 = await client.post(
                f"/api/v1/chat/threads/{tid}/messages",
                json={"role": "assistant", "content": "world"},
            )
            assert m2.status_code == 200
            assert m2.json()["seq"] == 2

            lst = await client.get(f"/api/v1/chat/threads/{tid}/messages")
            assert lst.status_code == 200
            msgs = lst.json()["messages"]
            assert [x["seq"] for x in msgs] == [1, 2]

            rm = await client.delete(f"/api/v1/chat/threads/{tid}")
            assert rm.status_code == 200


@pytest.mark.asyncio
async def test_chat_append_observability_fields_roundtrip():
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            tid = (await client.post("/api/v1/chat/threads", json={})).json()["id"]

            pool = await get_db_pool()
            async with pool.acquire() as conn:
                query_log_id = await conn.fetchval(
                    """
                    INSERT INTO queries (id, query_text, rag_model)
                    VALUES ($1, $2, $3)
                    RETURNING id
                    """,
                    str(uuid.uuid4()),
                    "fixture-query",
                    "vector-similarity",
                )
            assert query_log_id is not None
            qid_str = str(query_log_id)

            payload = {
                "role": "assistant",
                "content": "answer",
                "request_id": "req-chat-test",
                "query_log_id": qid_str,
                "eval_run_id": "eval-run-99",
                "eval_case_id": "weather-q3",
            }
            pr = await client.post(f"/api/v1/chat/threads/{tid}/messages", json=payload)
            assert pr.status_code == 200
            row = pr.json()
            assert row["request_id"] == "req-chat-test"
            assert row["query_log_id"] == qid_str
            assert row["eval_run_id"] == "eval-run-99"
            assert row["eval_case_id"] == "weather-q3"

            stored = (await client.get(f"/api/v1/chat/threads/{tid}/messages")).json()["messages"][
                0
            ]
            assert stored["request_id"] == "req-chat-test"
            assert stored["query_log_id"] == qid_str


@pytest.mark.asyncio
async def test_chat_retention_prunes_stale_threads(monkeypatch):
    import app.db.chat_queries as cq

    monkeypatch.setattr(cq.settings, "CHAT_RETENTION_DAYS", 1)

    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            tid = (await client.post("/api/v1/chat/threads", json={})).json()["id"]

            pool = await get_db_pool()
            async with pool.acquire() as conn:
                await conn.execute(
                    "UPDATE chat_threads SET updated_at = NOW() - INTERVAL '30 days' WHERE id = $1",
                    tid,
                )

            lst = await client.get("/api/v1/chat/threads")
            assert lst.status_code == 200
            ids = {t["id"] for t in lst.json()["threads"]}
            assert tid not in ids


@pytest.mark.asyncio
async def test_chat_blocked_when_api_key_configured(monkeypatch):
    monkeypatch.setattr(settings, "API_KEY", "integration-test-secret-key")

    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            r = await client.post("/api/v1/chat/threads", json={})
            assert r.status_code == 401


@pytest.mark.asyncio
async def test_non_stream_query_includes_request_and_query_log_ids():
    async def fake_prep(*_a, **_kw):
        return (None, [], "vector-similarity")

    async def fake_answer(**_kw):
        return AnswerResponse(
            answer="ok",
            citations=[],
            used_chunk_ids=[],
            latency_ms=3,
            token_usage={"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
        )

    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            with (
                patch("app.api.routes.query._prepare_rag_retrieval", side_effect=fake_prep),
                patch("app.rag.answer.generate_answer", side_effect=fake_answer),
            ):
                r = await client.post("/api/v1/query", json={"query": "hello"})
                assert r.status_code == 200
                data = r.json()
                assert data["answer"] == "ok"
                assert data.get("request_id")
                assert data.get("query_log_id")


@pytest.mark.asyncio
async def test_patch_chat_thread_rejects_empty_title():
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            tid = (await client.post("/api/v1/chat/threads", json={"title": "x"})).json()["id"]
            r = await client.patch(
                "/api/v1/chat/threads/" + tid,
                json={"title": ""},
            )
            assert r.status_code == 422


@pytest.mark.asyncio
async def test_append_message_rejects_unknown_query_log_id():
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            tid = (await client.post("/api/v1/chat/threads", json={})).json()["id"]
            fake_qid = str(uuid.uuid4())
            r = await client.post(
                f"/api/v1/chat/threads/{tid}/messages",
                json={
                    "role": "assistant",
                    "content": "x",
                    "query_log_id": fake_qid,
                },
            )
            assert r.status_code == 400
            assert "query_log_id" in r.json().get("detail", "").lower()


@pytest.mark.asyncio
async def test_patch_chat_thread_title():
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            tid = (await client.post("/api/v1/chat/threads", json={"title": "old"})).json()["id"]
            r = await client.patch(
                "/api/v1/chat/threads/" + tid,
                json={"title": "Renamed thread"},
            )
            assert r.status_code == 200
            assert r.json()["title"] == "Renamed thread"


@pytest.mark.asyncio
async def test_assistant_message_sets_empty_thread_title():
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            tid = (await client.post("/api/v1/chat/threads", json={"title": None})).json()["id"]
            await client.post(
                f"/api/v1/chat/threads/{tid}/messages",
                json={"role": "user", "content": "hello"},
            )
            await client.post(
                f"/api/v1/chat/threads/{tid}/messages",
                json={"role": "assistant", "content": "First assistant reply here"},
            )
            threads = (await client.get("/api/v1/chat/threads")).json()["threads"]
            row = next(t for t in threads if t["id"] == tid)
            assert row["title"]
            assert "First assistant" in row["title"]


@pytest.mark.asyncio
async def test_delete_all_chat_threads():
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            await client.post("/api/v1/chat/threads", json={"title": "a"})
            await client.post("/api/v1/chat/threads", json={"title": "b"})
            before = await client.get("/api/v1/chat/threads")
            assert len(before.json()["threads"]) >= 2

            r = await client.delete("/api/v1/chat/threads")
            assert r.status_code == 200
            body = r.json()
            assert body["deleted_count"] >= 2
            assert "message" in body

            after = await client.get("/api/v1/chat/threads")
            assert after.json()["threads"] == []

            empty = await client.delete("/api/v1/chat/threads")
            assert empty.status_code == 200
            assert empty.json()["deleted_count"] == 0
