import json
from typing import Any

import asyncpg
import structlog

from app.db.session import get_db_pool

logger = structlog.get_logger()


async def get_document_by_id(document_id: str) -> dict | None:
    """Get a document by ID."""
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        try:
            row = await conn.fetchrow(
                """
                SELECT
                    id,
                    source,
                    title,
                    created_at,
                    (original_file IS NOT NULL AND octet_length(original_file) > 0)
                        AS original_available
                FROM documents
                WHERE id = $1
                """,
                document_id,
            )
        except asyncpg.exceptions.UndefinedColumnError:
            row = await conn.fetchrow(
                """
                SELECT id, source, title, created_at
                FROM documents
                WHERE id = $1
                """,
                document_id,
            )
            if not row:
                return None
            legacy = dict(row)
            legacy["original_available"] = False
            return legacy
        if row:
            return dict(row)
        return None


async def fetch_document_original(document_id: str) -> tuple[bytes, str] | None:
    """Return stored binary and media type if present."""
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        try:
            row = await conn.fetchrow(
                """
                SELECT original_file, original_media_type
                FROM documents
                WHERE id = $1 AND original_file IS NOT NULL AND octet_length(original_file) > 0
                """,
                document_id,
            )
        except asyncpg.exceptions.UndefinedColumnError:
            return None
    if not row or row["original_file"] is None:
        return None
    blob = row["original_file"]
    data = bytes(blob) if not isinstance(blob, bytes) else blob
    media_type = row["original_media_type"] or "application/octet-stream"
    return data, media_type


async def search_chunks(
    query_embedding: list[float],
    top_k: int = 5,
    document_id: str | None = None,
) -> list[dict]:
    """Search for similar chunks using vector similarity."""
    pool = await get_db_pool()
    embedding_str = "[" + ",".join(map(str, query_embedding)) + "]"

    if document_id:
        query = """
            SELECT
                id,
                document_id,
                chunk_index,
                content,
                metadata,
                1 - (embedding <=> $1::vector) as similarity
            FROM chunks
            WHERE embedding IS NOT NULL AND document_id = $2
            ORDER BY embedding <=> $1::vector
            LIMIT $3
        """
        params = [embedding_str, document_id, top_k]
    else:
        query = """
            SELECT
                id,
                document_id,
                chunk_index,
                content,
                metadata,
                1 - (embedding <=> $1::vector) as similarity
            FROM chunks
            WHERE embedding IS NOT NULL
            ORDER BY embedding <=> $1::vector
            LIMIT $2
        """
        params = [embedding_str, top_k]

    async with pool.acquire() as conn:
        rows = await conn.fetch(query, *params)
        return [
            {
                "id": row["id"],
                "document_id": row["document_id"],
                "chunk_index": row["chunk_index"],
                "content": row["content"],
                "metadata": json.loads(row["metadata"]) if row["metadata"] else {},
                "similarity": float(row["similarity"]),
            }
            for row in rows
        ]


async def get_chunks_by_document_id(document_id: str) -> list[dict]:
    """Get all chunks for a document."""
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, document_id, chunk_index, content, metadata, created_at
            FROM chunks
            WHERE document_id = $1
            ORDER BY chunk_index
            """,
            document_id,
        )
        return [
            {
                "id": row["id"],
                "document_id": row["document_id"],
                "chunk_index": row["chunk_index"],
                "content": row["content"],
                "metadata": json.loads(row["metadata"]) if row["metadata"] else {},
                "created_at": row["created_at"].isoformat() if row["created_at"] else None,
            }
            for row in rows
        ]


async def list_documents(limit: int = 100, offset: int = 0) -> list[dict]:
    """List documents with pagination."""
    import asyncio
    import time

    start_time = time.time()
    logger.info("list_documents called", limit=limit, offset=offset)

    try:
        pool = await get_db_pool()
        pool_acquire_time = time.time()
        logger.info("Pool acquired", elapsed_ms=(pool_acquire_time - start_time) * 1000)

        # Use context manager for proper connection handling
        async with pool.acquire() as conn:
            conn_acquire_time = time.time()
            logger.info(
                "Connection acquired", elapsed_ms=(conn_acquire_time - pool_acquire_time) * 1000
            )

            # Add timeout for query execution (10 seconds)
            try:
                rows = await asyncio.wait_for(
                    conn.fetch(
                        """
                        SELECT
                            id,
                            source,
                            title,
                            created_at,
                            (original_file IS NOT NULL AND octet_length(original_file) > 0)
                                AS original_available
                        FROM documents
                        LIMIT $1 OFFSET $2
                        """,
                        limit,
                        offset,
                    ),
                    timeout=10.0,
                )
                include_original_col = True
            except asyncpg.exceptions.UndefinedColumnError:
                rows = await asyncio.wait_for(
                    conn.fetch(
                        """
                        SELECT id, source, title, created_at
                        FROM documents
                        LIMIT $1 OFFSET $2
                        """,
                        limit,
                        offset,
                    ),
                    timeout=10.0,
                )
                include_original_col = False
            query_time = time.time()
            logger.info(
                "Query executed",
                elapsed_ms=(query_time - conn_acquire_time) * 1000,
                row_count=len(rows),
            )

            result = [
                {
                    "id": row["id"],
                    "source": row["source"],
                    "title": row["title"],
                    "created_at": row["created_at"].isoformat() if row["created_at"] else None,
                    "original_available": (
                        bool(row["original_available"]) if include_original_col else False
                    ),
                }
                for row in rows
            ]
            processing_time = time.time()

            logger.info(
                "list_documents completed",
                pool_acquire_ms=(pool_acquire_time - start_time) * 1000,
                conn_acquire_ms=(conn_acquire_time - pool_acquire_time) * 1000,
                query_ms=(query_time - conn_acquire_time) * 1000,
                processing_ms=(processing_time - query_time) * 1000,
                total_ms=(processing_time - start_time) * 1000,
                document_count=len(result),
            )

            return result
    except TimeoutError as e:
        logger.error("Database operation timed out", error=str(e))
        raise RuntimeError(f"Database query timed out: {str(e)}")
    except Exception as e:
        logger.error("list_documents error", error=str(e), exc_info=True)
        raise


async def count_documents() -> int:
    """Get total document count."""
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        count = await conn.fetchval("SELECT COUNT(*) FROM documents")
        return count or 0


async def delete_document(document_id: str) -> bool:
    """Delete a document and all its chunks (chunks are deleted via CASCADE)."""
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        # Use RETURNING so success does not depend on asyncpg command-tag string formatting.
        row = await conn.fetchrow(
            "DELETE FROM documents WHERE id = $1 RETURNING id",
            document_id,
        )
        return row is not None


async def log_query(
    query_text: str,
    rag_model: str,
    top_k: int | None = None,
    request_id: str | None = None,
    client_ip: str | None = None,
    user_agent: str | None = None,
    latency_ms: int | None = None,
    token_usage: dict | None = None,
    citations_count: int = 0,
    answer_length: int | None = None,
) -> str | None:
    """
    Log a query to the database for monitoring and analytics.

    Returns the new ``queries.id`` row primary key, or None if logging failed.
    Errors are swallowed so callers can still return the HTTP response.
    """
    import uuid
    from decimal import Decimal

    try:
        # Calculate cost from token usage
        cost_usd = None
        if token_usage:
            # Pricing for gpt-4-turbo-preview:
            # - Input: $0.01 per 1K tokens
            # - Output: $0.03 per 1K tokens
            # - Embeddings: $0.00002 per 1K tokens (text-embedding-3-small)
            input_tokens = token_usage.get("prompt_tokens", 0) or 0
            output_tokens = token_usage.get("completion_tokens", 0) or 0
            embedding_tokens = token_usage.get("embedding_total_tokens", 0) or 0

            input_cost = (input_tokens / 1000) * 0.01
            output_cost = (output_tokens / 1000) * 0.03
            embedding_cost = (embedding_tokens / 1000) * 0.00002

            cost_usd = Decimal(str(input_cost + output_cost + embedding_cost)).quantize(
                Decimal("0.000001")
            )

        pool = await get_db_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                INSERT INTO queries (
                    id, query_text, rag_model, top_k, request_id, client_ip, user_agent,
                    latency_ms, token_usage, cost_usd, citations_count, answer_length
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                RETURNING id
                """,
                str(uuid.uuid4()),
                query_text,
                rag_model,
                top_k,
                request_id,
                client_ip,
                user_agent,
                latency_ms,
                json.dumps(token_usage) if token_usage else None,
                float(cost_usd) if cost_usd else None,
                citations_count,
                answer_length,
            )
            return str(row["id"]) if row else None
    except Exception as e:
        # Log error but don't fail the query
        logger.warning(
            "Failed to log query to database",
            error=str(e),
            query_preview=query_text[:100] if query_text else None,
            exc_info=True,
        )
        return None


async def get_query_logs(
    limit: int = 100,
    offset: int = 0,
    rag_model: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
) -> list[dict]:
    """
    Get query logs with optional filtering.

    Args:
        limit: Maximum number of logs to return
        offset: Number of logs to skip
        rag_model: Filter by RAG model
        start_date: Filter by start date (ISO format)
        end_date: Filter by end date (ISO format)

    Returns:
        List of query log dictionaries
    """
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        query = """
            SELECT
                id, query_text, rag_model, top_k, request_id, client_ip, user_agent,
                latency_ms, token_usage, cost_usd, citations_count, answer_length, created_at
            FROM queries
            WHERE 1=1
        """
        params: list[Any] = []
        param_count = 0

        if rag_model:
            param_count += 1
            query += f" AND rag_model = ${param_count}"
            params.append(rag_model)

        if start_date:
            param_count += 1
            query += f" AND created_at >= ${param_count}::timestamp"
            params.append(start_date)

        if end_date:
            param_count += 1
            query += f" AND created_at <= ${param_count}::timestamp"
            params.append(end_date)

        query += (
            " ORDER BY created_at DESC LIMIT $"
            + str(param_count + 1)
            + " OFFSET $"
            + str(param_count + 2)
        )
        params.extend([limit, offset])

        rows = await conn.fetch(query, *params)
        return [
            {
                "id": row["id"],
                "query_text": row["query_text"],
                "rag_model": row["rag_model"],
                "top_k": row["top_k"],
                "request_id": row["request_id"],
                "client_ip": row["client_ip"],
                "user_agent": row["user_agent"],
                "latency_ms": row["latency_ms"],
                "token_usage": json.loads(row["token_usage"]) if row["token_usage"] else None,
                "cost_usd": float(row["cost_usd"]) if row["cost_usd"] else None,
                "citations_count": row["citations_count"],
                "answer_length": row["answer_length"],
                "created_at": row["created_at"].isoformat() if row["created_at"] else None,
            }
            for row in rows
        ]


async def get_query_log_by_id(query_id: str) -> dict | None:
    """Return one row from ``queries`` by primary key, or None."""
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT
                id, query_text, rag_model, top_k, request_id, client_ip, user_agent,
                latency_ms, token_usage, cost_usd, citations_count, answer_length, created_at
            FROM queries
            WHERE id = $1
            """,
            query_id,
        )
    if not row:
        return None
    tu = row["token_usage"]
    if tu is None:
        token_usage = None
    elif isinstance(tu, str):
        token_usage = json.loads(tu) if tu else None
    else:
        token_usage = dict(tu)
    return {
        "id": row["id"],
        "query_text": row["query_text"],
        "rag_model": row["rag_model"],
        "top_k": row["top_k"],
        "request_id": row["request_id"],
        "client_ip": row["client_ip"],
        "user_agent": row["user_agent"],
        "latency_ms": row["latency_ms"],
        "token_usage": token_usage,
        "cost_usd": float(row["cost_usd"]) if row["cost_usd"] is not None else None,
        "citations_count": row["citations_count"],
        "answer_length": row["answer_length"],
        "created_at": row["created_at"].isoformat() if row["created_at"] else None,
    }


async def get_query_stats(
    start_date: str | None = None,
    end_date: str | None = None,
) -> dict:
    """
    Get aggregated query statistics.

    Returns:
        Dictionary with stats including total queries, total cost, average latency, etc.
    """
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        query = """
            SELECT
                COUNT(*) as total_queries,
                SUM(cost_usd) as total_cost,
                AVG(latency_ms) as avg_latency_ms,
                AVG(citations_count) as avg_citations,
                COUNT(DISTINCT client_ip) as unique_ips,
                COUNT(DISTINCT rag_model) as rag_models_used
            FROM queries
            WHERE 1=1
        """
        params: list[Any] = []
        param_count = 0

        if start_date:
            param_count += 1
            query += f" AND created_at >= ${param_count}::timestamp"
            params.append(start_date)

        if end_date:
            param_count += 1
            query += f" AND created_at <= ${param_count}::timestamp"
            params.append(end_date)

        row = await conn.fetchrow(query, *params)

        return {
            "total_queries": row["total_queries"] or 0,
            "total_cost_usd": float(row["total_cost"]) if row["total_cost"] else 0.0,
            "avg_latency_ms": float(row["avg_latency_ms"]) if row["avg_latency_ms"] else None,
            "avg_citations": float(row["avg_citations"]) if row["avg_citations"] else 0.0,
            "unique_ips": row["unique_ips"] or 0,
            "rag_models_used": row["rag_models_used"] or 0,
        }
