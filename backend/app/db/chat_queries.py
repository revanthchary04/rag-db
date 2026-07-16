"""Persisted chat threads and messages."""

from __future__ import annotations

import json
from datetime import timedelta
from typing import Any

import structlog

from app.core.config import settings
from app.db.session import get_db_pool

logger = structlog.get_logger()


async def prune_old_chat_threads() -> None:
    """Delete threads older than CHAT_RETENTION_DAYS when that setting is positive."""
    days = settings.CHAT_RETENTION_DAYS
    if days <= 0:
        return
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            "DELETE FROM chat_threads WHERE updated_at < NOW() - $1::interval",
            timedelta(days=days),
        )


async def create_chat_thread(title: str | None = None) -> dict[str, Any]:
    await prune_old_chat_threads()
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO chat_threads (title)
            VALUES ($1)
            RETURNING id, title, created_at, updated_at
            """,
            title,
        )
        assert row is not None
        return _thread_row(row)


async def list_chat_threads(limit: int = 50, offset: int = 0) -> list[dict[str, Any]]:
    await prune_old_chat_threads()
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, title, created_at, updated_at,
                   (SELECT COUNT(*) FROM chat_messages m WHERE m.thread_id = chat_threads.id)::int
                   AS message_count
            FROM chat_threads
            ORDER BY updated_at DESC
            LIMIT $1 OFFSET $2
            """,
            limit,
            offset,
        )
        return [_thread_row(r) | {"message_count": r["message_count"]} for r in rows]


async def get_chat_thread(thread_id: str) -> dict[str, Any] | None:
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT id, title, created_at, updated_at,
                   (SELECT COUNT(*) FROM chat_messages m WHERE m.thread_id = chat_threads.id)::int
                   AS message_count
            FROM chat_threads
            WHERE id = $1
            """,
            thread_id,
        )
        if not row:
            return None
        return _thread_row(row) | {"message_count": row["message_count"]}


async def update_chat_thread_title(thread_id: str, *, title: str) -> dict[str, Any] | None:
    """Set thread title; returns updated row or None if thread missing."""
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            UPDATE chat_threads SET title = $2, updated_at = NOW()
            WHERE id = $1
            RETURNING id, title, created_at, updated_at
            """,
            thread_id,
            title.strip(),
        )
        if not row:
            return None
        return _thread_row(row)


async def delete_chat_thread(thread_id: str) -> bool:
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "DELETE FROM chat_threads WHERE id = $1 RETURNING id",
            thread_id,
        )
        return row is not None


async def delete_all_chat_threads() -> int:
    """Delete every thread; messages cascade. Returns number of threads removed."""
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        n = await conn.fetchval(
            "WITH d AS (DELETE FROM chat_threads RETURNING 1) SELECT COUNT(*)::int FROM d"
        )
    return int(n or 0)


async def append_chat_message(
    thread_id: str,
    *,
    role: str,
    content: str,
    citations: list[dict[str, Any]] | None = None,
    metadata: dict[str, Any] | None = None,
    latency_ms: int | None = None,
    cost_usd: float | None = None,
    rag_model: str | None = None,
    request_id: str | None = None,
    query_log_id: str | None = None,
    eval_run_id: str | None = None,
    eval_case_id: str | None = None,
) -> dict[str, Any]:
    pool = await get_db_pool()
    cite_json = json.dumps(citations or [])
    meta_json = json.dumps(metadata or {})
    async with pool.acquire() as conn:
        async with conn.transaction():
            seq = await conn.fetchval(
                "SELECT COALESCE(MAX(seq), 0) + 1 FROM chat_messages WHERE thread_id = $1",
                thread_id,
            )
            row = await conn.fetchrow(
                """
                INSERT INTO chat_messages (
                    thread_id, role, content, citations, metadata,
                    latency_ms, cost_usd, rag_model, seq,
                    request_id, query_log_id, eval_run_id, eval_case_id
                )
                VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13)
                RETURNING id, thread_id, role, content, citations, metadata,
                          latency_ms, cost_usd, rag_model, seq, created_at,
                          request_id, query_log_id, eval_run_id, eval_case_id
                """,
                thread_id,
                role,
                content,
                cite_json,
                meta_json,
                latency_ms,
                cost_usd,
                rag_model,
                seq,
                request_id,
                query_log_id,
                eval_run_id,
                eval_case_id,
            )
            await conn.execute(
                "UPDATE chat_threads SET updated_at = NOW() WHERE id = $1",
                thread_id,
            )
            if role == "assistant":
                trow = await conn.fetchrow(
                    "SELECT title FROM chat_threads WHERE id = $1 FOR UPDATE",
                    thread_id,
                )
                cur_title = ((trow["title"] or "") if trow else "").strip()
                if not cur_title:
                    snippet = " ".join(content.split()).strip()
                    if len(snippet) > 72:
                        snippet = snippet[:72].rstrip() + "…"
                    if not snippet:
                        snippet = "Chat"
                    await conn.execute(
                        "UPDATE chat_threads SET title = $2, updated_at = NOW() WHERE id = $1",
                        thread_id,
                        snippet,
                    )
        assert row is not None
        return _message_row(row)


async def list_chat_messages(thread_id: str) -> list[dict[str, Any]]:
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, thread_id, role, content, citations, metadata,
                   latency_ms, cost_usd, rag_model, seq, created_at,
                   request_id, query_log_id, eval_run_id, eval_case_id
            FROM chat_messages
            WHERE thread_id = $1
            ORDER BY seq ASC
            """,
            thread_id,
        )
        return [_message_row(r) for r in rows]


def _thread_row(row: Any) -> dict[str, Any]:
    return {
        "id": row["id"],
        "title": row["title"],
        "created_at": row["created_at"].isoformat() if row["created_at"] else None,
        "updated_at": row["updated_at"].isoformat() if row["updated_at"] else None,
    }


def _message_row(row: Any) -> dict[str, Any]:
    citations = row["citations"]
    if isinstance(citations, str):
        citations = json.loads(citations)
    metadata = row["metadata"]
    if isinstance(metadata, str):
        metadata = json.loads(metadata)
    cost = row["cost_usd"]
    return {
        "id": row["id"],
        "thread_id": row["thread_id"],
        "role": row["role"],
        "content": row["content"],
        "citations": citations if isinstance(citations, list) else [],
        "metadata": metadata if isinstance(metadata, dict) else {},
        "latency_ms": row["latency_ms"],
        "cost_usd": float(cost) if cost is not None else None,
        "rag_model": row["rag_model"],
        "seq": row["seq"],
        "created_at": row["created_at"].isoformat() if row["created_at"] else None,
        "request_id": row["request_id"],
        "query_log_id": row["query_log_id"],
        "eval_run_id": row["eval_run_id"],
        "eval_case_id": row["eval_case_id"],
    }
