from typing import Any

import structlog

from app.core.tracing import observe_stage
from app.rag.retrieval_strategies import get_retrieval_strategy
from app.rag.types import RetrievedChunk, RetrieveError

logger = structlog.get_logger()


async def retrieve(
    query: str,
    top_k: int = 5,
    filters: dict[str, Any] | None = None,
    rag_model: str = "vector-similarity",
) -> list[RetrievedChunk]:
    """
    Retrieve similar chunks using the specified RAG model strategy.

    Args:
        query: Search query text
        top_k: Number of results to return (default: 5)
        filters: Optional filters dict with keys:
            - source: Filter by exact source match
            - title: Filter by exact title match
        rag_model: RAG model to use (default: "vector-similarity")

    Returns:
        List of RetrievedChunk objects, sorted by relevance (highest first)

    Raises:
        RetrieveError: On retrieval errors
    """
    try:
        logger.info(
            "Getting retrieval strategy",
            rag_model=rag_model,
        )
        strategy = get_retrieval_strategy(rag_model)
        logger.info(
            "Retrieval strategy obtained",
            rag_model=rag_model,
            strategy_type=type(strategy).__name__,
        )
        with observe_stage(
            "retrieve",
            span_name="rag.retrieve",
            **{
                "rag.model": rag_model,
                "rag.strategy": type(strategy).__name__,
                "rag.top_k": top_k,
                "rag.filtered": bool(filters),
            },
        ) as span:
            chunks = await strategy.retrieve(query, top_k, filters)
            span.set("rag.result_count", len(chunks))
            if chunks:
                # Top similarity score is the cheapest production signal for a
                # weak retrieval (a likely-hallucination early warning).
                span.set("rag.top_score", chunks[0].score)
            return chunks
    except ValueError as e:
        logger.error("Invalid RAG model", rag_model=rag_model, error=str(e))
        raise RetrieveError(f"Invalid RAG model: {str(e)}") from e
    except Exception as e:
        logger.error("Retrieval error", error=str(e), exc_info=True)
        raise RetrieveError(f"Failed to retrieve chunks: {str(e)}") from e
