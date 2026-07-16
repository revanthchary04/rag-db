"""Read-only analytics helpers (joins across feature tables)."""

from __future__ import annotations

from typing import Any

from app.db.session import get_db_pool


async def list_chat_query_links(limit: int = 50) -> list[dict[str, Any]]:
    """
    Rows where a chat message references ``queries.id`` via ``query_log_id``.

    Newest assistant/user messages with audit linkage first.
    """
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT
              cm.id AS message_id,
              cm.thread_id,
              cm.role,
              cm.query_log_id,
              cm.request_id AS message_request_id,
              cm.created_at AS message_created_at,
              q.query_text,
              q.rag_model AS query_rag_model,
              q.request_id AS query_request_id,
              q.created_at AS query_logged_at
            FROM chat_messages cm
            INNER JOIN queries q ON q.id = cm.query_log_id
            ORDER BY cm.created_at DESC
            LIMIT $1
            """,
            limit,
        )

    out: list[dict[str, Any]] = []
    for r in rows:
        out.append(
            {
                "message_id": r["message_id"],
                "thread_id": r["thread_id"],
                "role": r["role"],
                "query_log_id": r["query_log_id"],
                "message_request_id": r["message_request_id"],
                "message_created_at": r["message_created_at"].isoformat()
                if r["message_created_at"]
                else None,
                "query_text": r["query_text"],
                "query_rag_model": r["query_rag_model"],
                "query_request_id": r["query_request_id"],
                "query_logged_at": r["query_logged_at"].isoformat()
                if r["query_logged_at"]
                else None,
            }
        )
    return out
