import structlog
from fastapi import APIRouter, HTTPException, Request

from app.db.queries import (
    search_chunks,
)
from app.schemas import (
    ChunkResponse,
    SearchRequest,
    SearchResponse,
)

logger = structlog.get_logger()

router = APIRouter()


@router.post("/search", response_model=SearchResponse)
async def search_chunks_endpoint(
    request: Request,
    search_request: SearchRequest,
):
    """Search for similar chunks using vector similarity."""
    request_id = getattr(request.state, "request_id", "unknown")

    try:
        # Generate embedding for the query
        from app.llm.openai_client import get_llm_client

        openai_client = get_llm_client()
        embedding_response = await openai_client.create_embedding(search_request.query)
        query_embedding = embedding_response.embedding

        # Search for similar chunks
        chunks = await search_chunks(
            query_embedding=query_embedding,
            top_k=search_request.top_k,
            document_id=search_request.document_id,
        )

        logger.info(
            "Search completed",
            request_id=request_id,
            query=search_request.query,
            results_count=len(chunks),
        )

        return SearchResponse(
            query=search_request.query,
            chunks=[
                ChunkResponse(
                    id=chunk["id"],
                    document_id=chunk["document_id"],
                    chunk_index=chunk["chunk_index"],
                    content=chunk["content"],
                    metadata=chunk["metadata"],
                    similarity=chunk["similarity"],
                )
                for chunk in chunks
            ],
            total=len(chunks),
        )

    except ValueError as e:
        # Validation errors are 4xx
        logger.warning(
            "Validation error",
            request_id=request_id,
            error=str(e),
        )
        raise HTTPException(
            status_code=400,
            detail=str(e),
        )

    except Exception as e:
        from app.llm.openai_client import OpenAIError

        if isinstance(e, OpenAIError):
            logger.error(
                "OpenAI API error",
                request_id=request_id,
                error=str(e),
            )
            raise HTTPException(
                status_code=503,
                detail="Failed to generate embedding",
            )

        logger.error(
            "Search error",
            request_id=request_id,
            error=str(e),
            exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail="Internal server error",
        )
