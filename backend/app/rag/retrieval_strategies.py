"""
Retrieval strategies for different RAG models.

This module provides different retrieval strategies:
- Vector Similarity Search (default)
- Hybrid Search (Vector + BM25)
- Reranking (uses reranking model to improve results)
- Multi-Query (generates multiple query variations)
"""

import json
import re
from abc import ABC, abstractmethod
from collections.abc import Callable
from typing import Any

import structlog

from app.core.tracing import span
from app.db.session import get_db_pool
from app.llm.openai_client import OpenAIError, get_llm_client
from app.rag.types import RetrievedChunk, RetrieveError

logger = structlog.get_logger()


class RetrievalStrategy(ABC):
    """Base class for retrieval strategies."""

    @abstractmethod
    async def retrieve(
        self,
        query: str,
        top_k: int,
        filters: dict[str, Any] | None = None,
    ) -> list[RetrievedChunk]:
        """
        Retrieve chunks based on the strategy.

        Args:
            query: Search query text
            top_k: Number of results to return
            filters: Optional filters dict

        Returns:
            List of RetrievedChunk objects, sorted by relevance
        """
        pass


class VectorSimilarityStrategy(RetrievalStrategy):
    """Vector similarity search strategy (default)."""

    async def retrieve(
        self,
        query: str,
        top_k: int,
        filters: dict[str, Any] | None = None,
    ) -> list[RetrievedChunk]:
        """Retrieve chunks using vector similarity search."""
        logger.info(
            "VectorSimilarityStrategy.retrieve called", query_length=len(query), top_k=top_k
        )
        if top_k <= 0:
            raise ValueError("top_k must be positive")

        # Generate embedding for query
        try:
            openai_client = get_llm_client()
            embedding_response = await openai_client.create_embedding(query)
            query_embedding = embedding_response.embedding
        except OpenAIError as e:
            logger.error("Failed to generate query embedding", error=str(e))
            raise RetrieveError(f"Failed to generate embedding: {str(e)}") from e

        # Build query with optional filters
        pool = await get_db_pool()
        embedding_str = "[" + ",".join(map(str, query_embedding)) + "]"

        # Base query with vector similarity
        base_query = """
            SELECT
                c.id as chunk_id,
                c.document_id,
                c.chunk_index,
                c.content,
                d.title,
                d.source,
                1 - (c.embedding <=> $1::vector) as similarity
            FROM chunks c
            INNER JOIN documents d ON c.document_id = d.id
            WHERE c.embedding IS NOT NULL
        """

        params: list[Any] = [embedding_str]
        param_index = 2

        # Apply filters
        if filters:
            if "source" in filters:
                base_query += f" AND d.source = ${param_index}"
                params.append(filters["source"])
                param_index += 1

            if "title" in filters:
                if filters["title"] is None:
                    base_query += " AND d.title IS NULL"
                else:
                    base_query += f" AND d.title = ${param_index}"
                    params.append(filters["title"])
                    param_index += 1

        # Order by similarity (highest first) and limit
        base_query += f"""
            ORDER BY c.embedding <=> $1::vector
            LIMIT ${param_index}
        """

        params.append(top_k)

        try:
            with span("db.vector_search", **{"rag.top_k": top_k, "db.system": "postgresql"}):
                async with pool.acquire() as conn:
                    rows = await conn.fetch(base_query, *params)

            results = []
            for row in rows:
                results.append(
                    RetrievedChunk(
                        chunk_id=row["chunk_id"],
                        document_id=row["document_id"],
                        title=row["title"],
                        source=row["source"],
                        chunk_index=row["chunk_index"],
                        content=row["content"],
                        score=float(row["similarity"]),
                    )
                )

            logger.info(
                "Vector similarity retrieval completed",
                query_length=len(query),
                top_k=top_k,
                results_count=len(results),
            )

            return results

        except Exception as e:
            logger.error("Vector similarity retrieval error", error=str(e), exc_info=True)
            raise RetrieveError(f"Failed to retrieve chunks: {str(e)}") from e


class HybridSearchStrategy(RetrievalStrategy):
    """
    Hybrid search strategy combining vector similarity and BM25 keyword search.

    Uses Reciprocal Rank Fusion (RRF) to combine results from both methods.
    """

    async def retrieve(
        self,
        query: str,
        top_k: int,
        filters: dict[str, Any] | None = None,
    ) -> list[RetrievedChunk]:
        """Retrieve chunks using hybrid search (vector + BM25)."""
        logger.info("HybridSearchStrategy.retrieve called", query_length=len(query), top_k=top_k)
        if top_k <= 0:
            raise ValueError("top_k must be positive")

        # Generate embedding for query
        try:
            openai_client = get_llm_client()
            embedding_response = await openai_client.create_embedding(query)
            query_embedding = embedding_response.embedding
        except OpenAIError as e:
            logger.error("Failed to generate query embedding", error=str(e))
            raise RetrieveError(f"Failed to generate embedding: {str(e)}") from e

        pool = await get_db_pool()
        embedding_str = "[" + ",".join(map(str, query_embedding)) + "]"

        # Retrieve more results from each method, then combine
        # We'll fetch 2x top_k from each method to have enough candidates
        fetch_k = min(top_k * 2, 50)

        # Build filter conditions for vector query
        vector_filter_conditions = []
        vector_params: list[Any] = [embedding_str]
        vector_param_index = 2

        if filters:
            if "source" in filters:
                vector_filter_conditions.append(f"d.source = ${vector_param_index}")
                vector_params.append(filters["source"])
                vector_param_index += 1

            if "title" in filters:
                if filters["title"] is None:
                    vector_filter_conditions.append("d.title IS NULL")
                else:
                    vector_filter_conditions.append(f"d.title = ${vector_param_index}")
                    vector_params.append(filters["title"])
                    vector_param_index += 1

        vector_filter_clause = (
            " AND " + " AND ".join(vector_filter_conditions) if vector_filter_conditions else ""
        )

        # Vector similarity query
        vector_params.append(fetch_k)
        vector_query = f"""
            SELECT
                c.id as chunk_id,
                c.document_id,
                c.chunk_index,
                c.content,
                d.title,
                d.source,
                1 - (c.embedding <=> $1::vector) as similarity,
                ROW_NUMBER() OVER (ORDER BY c.embedding <=> $1::vector) as vector_rank
            FROM chunks c
            INNER JOIN documents d ON c.document_id = d.id
            WHERE c.embedding IS NOT NULL
            {vector_filter_clause}
            ORDER BY c.embedding <=> $1::vector
            LIMIT ${vector_param_index}
        """

        # Build filter conditions for BM25 query (separate parameter list)
        bm25_filter_conditions = []
        bm25_params: list[Any] = [query]  # $1 = query text
        bm25_param_index = 2

        if filters:
            if "source" in filters:
                bm25_filter_conditions.append(f"d.source = ${bm25_param_index}")
                bm25_params.append(filters["source"])
                bm25_param_index += 1

            if "title" in filters:
                if filters["title"] is None:
                    bm25_filter_conditions.append("d.title IS NULL")
                else:
                    bm25_filter_conditions.append(f"d.title = ${bm25_param_index}")
                    bm25_params.append(filters["title"])
                    bm25_param_index += 1

        bm25_filter_clause = (
            " AND " + " AND ".join(bm25_filter_conditions) if bm25_filter_conditions else ""
        )
        bm25_params.append(fetch_k)

        # BM25 keyword search query (using PostgreSQL full-text search)
        bm25_query = f"""
            SELECT
                c.id as chunk_id,
                c.document_id,
                c.chunk_index,
                c.content,
                d.title,
                d.source,
                ts_rank(to_tsvector('english', c.content), plainto_tsquery('english', $1)) as bm25_score,
                ROW_NUMBER() OVER (ORDER BY ts_rank(to_tsvector('english', c.content), plainto_tsquery('english', $1)) DESC) as bm25_rank
            FROM chunks c
            INNER JOIN documents d ON c.document_id = d.id
            WHERE to_tsvector('english', c.content) @@ plainto_tsquery('english', $1)
            {bm25_filter_clause}
            ORDER BY bm25_score DESC
            LIMIT ${bm25_param_index}
        """

        try:
            async with pool.acquire() as conn:
                # Execute both queries with their respective parameter lists
                logger.info(
                    "Hybrid search: executing vector retrieval",
                    query_length=len(query),
                    fetch_k=fetch_k,
                )
                vector_rows = await conn.fetch(vector_query, *vector_params)
                logger.info(
                    "Hybrid search: executing BM25 lexical retrieval",
                    query_length=len(query),
                    fetch_k=fetch_k,
                )
                bm25_rows = await conn.fetch(bm25_query, *bm25_params)

                logger.info(
                    "Hybrid search: retrieval complete, fusing results",
                    vector_results_count=len(vector_rows),
                    bm25_results_count=len(bm25_rows),
                )

                # Combine results using Reciprocal Rank Fusion (RRF)
                # RRF score = sum(1 / (k + rank)) for each method
                k = 60  # RRF constant

                chunk_scores: dict[str, dict[str, Any]] = {}

                # Process vector results
                for rank, row in enumerate(vector_rows, start=1):
                    chunk_id = row["chunk_id"]
                    rrf_score = 1.0 / (k + rank)

                    if chunk_id not in chunk_scores:
                        chunk_scores[chunk_id] = {
                            "chunk_id": row["chunk_id"],
                            "document_id": row["document_id"],
                            "title": row["title"],
                            "source": row["source"],
                            "chunk_index": row["chunk_index"],
                            "content": row["content"],
                            "vector_score": float(row["similarity"]),
                            "rrf_score": rrf_score,
                        }
                    else:
                        chunk_scores[chunk_id]["rrf_score"] += rrf_score

                # Process BM25 results
                for rank, row in enumerate(bm25_rows, start=1):
                    chunk_id = row["chunk_id"]
                    rrf_score = 1.0 / (k + rank)

                    if chunk_id not in chunk_scores:
                        chunk_scores[chunk_id] = {
                            "chunk_id": row["chunk_id"],
                            "document_id": row["document_id"],
                            "title": row["title"],
                            "source": row["source"],
                            "chunk_index": row["chunk_index"],
                            "content": row["content"],
                            "vector_score": 0.0,
                            "rrf_score": rrf_score,
                        }
                    else:
                        chunk_scores[chunk_id]["rrf_score"] += rrf_score

                # Sort by RRF score and take top_k
                sorted_chunks = sorted(
                    chunk_scores.values(),
                    key=lambda x: x["rrf_score"],
                    reverse=True,
                )[:top_k]

                results = [
                    RetrievedChunk(
                        chunk_id=chunk["chunk_id"],
                        document_id=chunk["document_id"],
                        title=chunk["title"],
                        source=chunk["source"],
                        chunk_index=chunk["chunk_index"],
                        content=chunk["content"],
                        score=chunk["rrf_score"],  # Use RRF score as final score
                    )
                    for chunk in sorted_chunks
                ]

                logger.info(
                    "Hybrid search: RRF fusion complete, passing fused top-k to generation",
                    vector_results_count=len(vector_rows),
                    bm25_results_count=len(bm25_rows),
                    fused_results_count=len(results),
                    top_k=top_k,
                    fusion_method="RRF",
                    query_length=len(query),
                )

                return results

        except Exception as e:
            logger.error("Hybrid search retrieval error", error=str(e), exc_info=True)
            raise RetrieveError(f"Failed to retrieve chunks: {str(e)}") from e


class RerankingStrategy(RetrievalStrategy):
    """
    Reranking strategy that uses a reranking model to improve retrieval accuracy.

    First retrieves more candidates using vector similarity, then reranks them.
    """

    async def retrieve(
        self,
        query: str,
        top_k: int,
        filters: dict[str, Any] | None = None,
    ) -> list[RetrievedChunk]:
        """Retrieve chunks using reranking strategy."""
        logger.info("RerankingStrategy.retrieve called", query_length=len(query), top_k=top_k)
        # First, use vector similarity to get more candidates
        vector_strategy = VectorSimilarityStrategy()

        # Fetch more candidates for reranking (typically 3-5x the desired top_k)
        candidate_k = min(top_k * 4, 50)
        logger.info(
            "Reranking: initial retrieval for candidates",
            query_length=len(query),
            candidate_k=candidate_k,
            top_k=top_k,
        )
        candidates = await vector_strategy.retrieve(query, candidate_k, filters)
        logger.info(
            "Reranking: initial retrieval complete",
            candidates_count=len(candidates),
        )

        if not candidates:
            return []

        # Use OpenAI to rerank the candidates
        # We'll use the chat completion API to score relevance
        try:
            logger.info(
                "Reranking: applying reranker model",
                candidates_count=len(candidates),
            )
            openai_client = get_llm_client()

            # Create a prompt for reranking
            rerank_prompt = f"""You are a relevance scorer. Given a query and a list of document chunks, rank them by relevance.

Query: {query}

Chunks:
"""
            for i, chunk in enumerate(candidates, start=1):
                rerank_prompt += f"\n[{i}] {chunk.content[:200]}...\n"

            rerank_prompt += "\nReturn ONLY a JSON array of chunk indices (1-indexed) ordered by relevance (most relevant first). Example: [3, 1, 5, 2, 4]"

            messages = [
                {
                    "role": "system",
                    "content": "You are a relevance scorer. Return only a JSON array of chunk indices ordered by relevance.",
                },
                {
                    "role": "user",
                    "content": rerank_prompt,
                },
            ]

            completion_response = await openai_client.create_chat_completion(
                messages=messages,
                temperature=0.0,  # Deterministic ranking
                max_tokens=200,
            )

            # Parse the ranked indices
            # Extract JSON array from response (handle cases where LLM adds extra text)
            content = completion_response.content.strip()
            # Try to find JSON array in the response
            json_match = re.search(r"\[[\d,\s]+\]", content)
            if json_match:
                ranked_indices = json.loads(json_match.group())
            else:
                # Fallback: try parsing the whole content
                ranked_indices = json.loads(content)

            # Reorder candidates based on ranking
            reranked = []
            for idx in ranked_indices:
                if 1 <= idx <= len(candidates):
                    reranked.append(candidates[idx - 1])

            # Take top_k
            results = reranked[:top_k]

            logger.info(
                "Reranking: reranker pass complete",
                query_length=len(query),
                top_k=top_k,
                initial_candidates_count=len(candidates),
                reranked_results_count=len(results),
                reranking_applied=True,
            )

            return results

        except Exception as e:
            logger.warning(
                "Reranking failed, falling back to vector similarity",
                error=str(e),
            )
            # Fallback to vector similarity if reranking fails
            return candidates[:top_k]


class MultiQueryStrategy(RetrievalStrategy):
    """
    Multi-query strategy that generates multiple query variations and combines results.

    Uses LLM to generate query variations, then retrieves for each and combines.
    """

    async def retrieve(
        self,
        query: str,
        top_k: int,
        filters: dict[str, Any] | None = None,
    ) -> list[RetrievedChunk]:
        """Retrieve chunks using multi-query strategy."""
        logger.info("MultiQueryStrategy.retrieve called", query_length=len(query), top_k=top_k)
        # Generate query variations using LLM
        logger.info("Multi-query: generating query variations", original_query=query)
        try:
            openai_client = get_llm_client()

            variation_prompt = f"""Generate 3 different variations of the following search query. Each variation should approach the question from a different angle or use different terminology.

Original query: {query}

Return ONLY a JSON array of 3 query strings. Example: ["query 1", "query 2", "query 3"]"""

            messages = [
                {
                    "role": "system",
                    "content": "You are a query variation generator. Return only a JSON array of query strings.",
                },
                {
                    "role": "user",
                    "content": variation_prompt,
                },
            ]

            completion_response = await openai_client.create_chat_completion(
                messages=messages,
                temperature=0.7,
                max_tokens=200,
            )

            # Extract JSON array from response
            content = completion_response.content.strip()
            json_match = re.search(r"\[.*?\]", content, re.DOTALL)
            if json_match:
                query_variations = json.loads(json_match.group())
            else:
                query_variations = json.loads(content)

            # Add original query
            all_queries = [query] + query_variations

            logger.info(
                "Generated query variations",
                original_query=query,
                variations=query_variations,
            )

        except Exception as e:
            logger.warning(
                "Failed to generate query variations, using original query only",
                error=str(e),
            )
            all_queries = [query]

        # Retrieve for each query variation
        logger.info(
            "Multi-query: retrieving for each query variation",
            query_count=len(all_queries),
            queries=all_queries,
        )
        vector_strategy = VectorSimilarityStrategy()

        # Fetch more per query to have enough candidates
        per_query_k = min(top_k * 2, 20)

        all_candidates: dict[str, RetrievedChunk] = {}

        for i, q in enumerate(all_queries, start=1):
            try:
                logger.info(
                    "Multi-query: retrieving for query variation",
                    variation_number=i,
                    query=q,
                    per_query_k=per_query_k,
                )
                candidates = await vector_strategy.retrieve(q, per_query_k, filters)
                logger.info(
                    "Multi-query: retrieval complete for variation",
                    variation_number=i,
                    candidates_count=len(candidates),
                )

                # Combine candidates, keeping best score for each chunk
                for candidate in candidates:
                    chunk_id = candidate.chunk_id
                    if chunk_id not in all_candidates:
                        all_candidates[chunk_id] = candidate
                    else:
                        # Keep the candidate with the higher score
                        if candidate.score > all_candidates[chunk_id].score:
                            all_candidates[chunk_id] = candidate

            except Exception as e:
                logger.warning(
                    "Failed to retrieve for query variation",
                    query=q,
                    error=str(e),
                )
                continue

        logger.info(
            "Multi-query: merging and deduplicating results",
            total_unique_candidates=len(all_candidates),
        )
        # Sort by score and take top_k
        sorted_candidates = sorted(
            all_candidates.values(),
            key=lambda x: x.score,
            reverse=True,
        )[:top_k]

        logger.info(
            "Multi-query: merge complete",
            final_results_count=len(sorted_candidates),
            top_k=top_k,
        )

        logger.info(
            "Multi-query retrieval completed",
            query_length=len(query),
            top_k=top_k,
            query_variations_count=len(all_queries),
            unique_candidates=len(all_candidates),
            results_count=len(sorted_candidates),
        )

        return sorted_candidates


def get_retrieval_strategy(rag_model: str) -> RetrievalStrategy:
    """
    Get the appropriate retrieval strategy for the given RAG model.

    Args:
        rag_model: RAG model name (vector-similarity, hybrid-search, reranking, multi-query)

    Returns:
        RetrievalStrategy instance

    Raises:
        ValueError: If rag_model is not supported
    """
    strategies: dict[str, Callable[[], RetrievalStrategy]] = {
        "vector-similarity": VectorSimilarityStrategy,
        "hybrid-search": HybridSearchStrategy,
        "reranking": RerankingStrategy,
        "multi-query": MultiQueryStrategy,
    }

    strategy_factory = strategies.get(rag_model)
    if not strategy_factory:
        raise ValueError(
            f"Unsupported RAG model: {rag_model}. Supported models: {', '.join(strategies.keys())}"
        )

    logger.info(
        "Creating retrieval strategy instance",
        rag_model=rag_model,
        strategy_class=getattr(strategy_factory, "__name__", rag_model),
    )
    return strategy_factory()
