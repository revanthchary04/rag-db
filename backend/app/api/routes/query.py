import json
from collections.abc import AsyncIterator

import structlog
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from app.core.config import settings
from app.db.queries import (
    list_documents,
    log_query,
)
from app.llm.openai_client import OpenAIRateLimitError
from app.rag.answer import AnswerError, generate_answer_stream
from app.rag.types import RetrievedChunk, RetrieveError
from app.schemas import (
    CitationResponse,
    QueryRequest,
    QueryResponse,
)

logger = structlog.get_logger()

router = APIRouter()


async def _prepare_rag_retrieval(
    query_request: QueryRequest,
    request_id: str,
) -> tuple[str | None, list[RetrievedChunk], str]:
    """Meta-query detection, optional document list context, and chunk retrieval."""
    from app.rag.retrieve import retrieve

    query_lower = query_request.query.lower()
    is_meta_query = any(
        phrase in query_lower
        for phrase in [
            "what documents",
            "which documents",
            "list documents",
            "show documents",
            "documents have been",
            "documents are",
            "documents available",
            "documents in",
            "documents stored",
            "documents ingested",
        ]
    )

    document_list_context = None
    if is_meta_query:
        logger.info(
            "Meta-query detected",
            request_id=request_id,
            query=query_request.query,
        )
        try:
            documents = await list_documents(limit=100, offset=0)
            if documents:
                doc_list = []
                for doc in documents:
                    doc_info = f"- {doc.get('title') or doc.get('source', 'Untitled')}"
                    if doc.get("source") and doc.get("title") != doc.get("source"):
                        doc_info += f" (source: {doc['source']})"
                    doc_list.append(doc_info)
                document_list_context = (
                    f"Available documents in the system ({len(documents)} total):\n"
                    + "\n".join(doc_list)
                )
                logger.info(
                    "Document list context created",
                    request_id=request_id,
                    document_count=len(documents),
                    context_length=len(document_list_context),
                    context_preview=document_list_context[:200],
                )
            else:
                logger.warning(
                    "No documents found for meta-query",
                    request_id=request_id,
                )
        except Exception as e:
            logger.warning(
                "Failed to fetch document list for meta-query",
                request_id=request_id,
                error=str(e),
                exc_info=True,
            )
    else:
        logger.debug(
            "Not a meta-query",
            request_id=request_id,
            query=query_request.query,
        )

    rag_model = query_request.rag_model or "vector-similarity"
    logger.info(
        "Retrieving chunks",
        request_id=request_id,
        rag_model=rag_model,
        query_request_rag_model=query_request.rag_model,
    )
    retrieved_chunks = await retrieve(
        query=query_request.query,
        top_k=query_request.top_k,
        filters=query_request.filters,
        rag_model=rag_model,
    )
    return document_list_context, retrieved_chunks, rag_model


@router.post("/query", response_model=QueryResponse)
async def query_endpoint(
    request: Request,
    query_request: QueryRequest,
):
    """Query the RAG system with natural language question."""
    request_id = getattr(request.state, "request_id", "unknown")

    # Validate query length
    if len(query_request.query) > settings.MAX_QUERY_LENGTH:
        logger.warning(
            "Query too long",
            request_id=request_id,
            query_length=len(query_request.query),
            max_length=settings.MAX_QUERY_LENGTH,
        )
        raise HTTPException(
            status_code=400,
            detail=f"Query exceeds maximum length of {settings.MAX_QUERY_LENGTH} characters",
        )

    if not query_request.query.strip():
        raise HTTPException(
            status_code=400,
            detail="Query cannot be empty",
        )

    try:
        from app.rag.answer import generate_answer

        document_list_context, retrieved_chunks, rag_model = await _prepare_rag_retrieval(
            query_request,
            request_id,
        )

        # Generate answer from retrieved chunks (with document list context if meta-query)
        answer_response = await generate_answer(
            query=query_request.query,
            retrieved_chunks=retrieved_chunks,
            document_list_context=document_list_context,
        )

        # Build response
        response_data = {
            "answer": answer_response.answer,
            "citations": [
                CitationResponse(
                    chunk_id=citation["chunk_id"],
                    document_id=citation["document_id"],
                    title=citation["title"],
                    source=citation["source"],
                    chunk_index=citation["chunk_index"],
                )
                for citation in answer_response.citations
            ],
            "used_chunk_ids": answer_response.used_chunk_ids,
            "latency_ms": answer_response.latency_ms,
            "token_usage": answer_response.token_usage,
            "rag_model": rag_model,
            "retrieved_chunk_count": len(retrieved_chunks),
        }

        # Log response data for debugging
        logger.info(
            "Response data built",
            request_id=request_id,
            answer_length=len(answer_response.answer) if answer_response.answer else 0,
            answer_preview=answer_response.answer[:100] if answer_response.answer else None,
            answer_is_empty=not answer_response.answer or len(answer_response.answer.strip()) == 0,
        )

        # Add debug information if requested
        if query_request.debug:
            response_data["debug"] = {
                "retrieved": [
                    {
                        "chunk_id": chunk.chunk_id,
                        "document_id": chunk.document_id,
                        "title": chunk.title,
                        "source": chunk.source,
                        "chunk_index": chunk.chunk_index,
                        "content_snippet": chunk.content[:200]
                        + ("..." if len(chunk.content) > 200 else ""),
                        "score": chunk.score,
                    }
                    for chunk in retrieved_chunks
                ],
            }

        logger.info(
            "Query completed",
            request_id=request_id,
            query_length=len(query_request.query),
            retrieved_count=len(retrieved_chunks),
            citations_count=len(answer_response.citations),
            latency_ms=answer_response.latency_ms,
        )

        query_log_id: str | None = None
        try:
            client_ip = request.client.host if request.client else None
            user_agent = request.headers.get("user-agent")
            query_log_id = await log_query(
                query_text=query_request.query,
                rag_model=rag_model,
                top_k=query_request.top_k,
                request_id=request_id,
                client_ip=client_ip,
                user_agent=user_agent,
                latency_ms=answer_response.latency_ms,
                token_usage=answer_response.token_usage,
                citations_count=len(answer_response.citations),
                answer_length=len(answer_response.answer) if answer_response.answer else None,
            )
        except Exception as e:
            logger.warning(
                "Failed to log query",
                request_id=request_id,
                error=str(e),
            )

        response_data["request_id"] = request_id
        response_data["query_log_id"] = query_log_id

        return QueryResponse(**response_data)

    except RetrieveError as e:
        # Check if the underlying error is a rate limit error
        # Only treat as rate limit if it's explicitly an OpenAIRateLimitError
        # Don't check error string as it might contain "rate limit" in other contexts
        is_rate_limit = isinstance(e.__cause__, OpenAIRateLimitError) if e.__cause__ else False

        if is_rate_limit:
            logger.error(
                "OpenAI rate limit error",
                request_id=request_id,
                query=query_request.query,
                error=str(e),
                error_type=type(e.__cause__).__name__ if e.__cause__ else None,
            )
            raise HTTPException(
                status_code=429,
                detail="OpenAI API rate limit exceeded. Please wait a moment and try again.",
            )

        # Log the actual error for debugging
        logger.error(
            "Retrieval error",
            request_id=request_id,
            query=query_request.query,
            query_length=len(query_request.query),
            error=str(e),
            error_type=type(e).__name__,
            cause_type=type(e.__cause__).__name__ if e.__cause__ else None,
            exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail=f"Retrieval error: {str(e)}",
        )

    except AnswerError as e:
        # Check if the underlying error is a rate limit error
        is_rate_limit = isinstance(e.__cause__, OpenAIRateLimitError) if e.__cause__ else False

        if is_rate_limit:
            logger.error(
                "OpenAI rate limit error during answer generation",
                request_id=request_id,
                query=query_request.query,
                error=str(e),
                error_type=type(e.__cause__).__name__ if e.__cause__ else None,
            )
            raise HTTPException(
                status_code=429,
                detail="OpenAI API rate limit exceeded. Please wait a moment and try again.",
            )

        logger.error(
            "Answer generation error",
            request_id=request_id,
            query=query_request.query,
            query_length=len(query_request.query),
            error=str(e),
            error_type=type(e).__name__,
            cause_type=type(e.__cause__).__name__ if e.__cause__ else None,
            exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail=f"Answer generation error: {str(e)}",
        )

    except Exception as e:
        logger.error(
            "Unexpected query error",
            request_id=request_id,
            error=str(e),
            exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail="Internal server error during query",
        )


@router.post("/query/stream")
async def query_stream_endpoint(
    request: Request,
    query_request: QueryRequest,
):
    """Stream RAG answer as Server-Sent Events (JSON lines in `data:` fields)."""
    request_id = getattr(request.state, "request_id", "unknown")

    if len(query_request.query) > settings.MAX_QUERY_LENGTH:
        logger.warning(
            "Query too long",
            request_id=request_id,
            query_length=len(query_request.query),
            max_length=settings.MAX_QUERY_LENGTH,
        )
        raise HTTPException(
            status_code=400,
            detail=f"Query exceeds maximum length of {settings.MAX_QUERY_LENGTH} characters",
        )

    if not query_request.query.strip():
        raise HTTPException(
            status_code=400,
            detail="Query cannot be empty",
        )

    try:
        document_list_context, retrieved_chunks, rag_model = await _prepare_rag_retrieval(
            query_request,
            request_id,
        )
    except RetrieveError as e:
        is_rate_limit = isinstance(e.__cause__, OpenAIRateLimitError) if e.__cause__ else False
        if is_rate_limit:
            logger.error(
                "OpenAI rate limit error",
                request_id=request_id,
                query=query_request.query,
                error=str(e),
                error_type=type(e.__cause__).__name__ if e.__cause__ else None,
            )
            raise HTTPException(
                status_code=429,
                detail="OpenAI API rate limit exceeded. Please wait a moment and try again.",
            )
        logger.error(
            "Retrieval error",
            request_id=request_id,
            query=query_request.query,
            error=str(e),
            error_type=type(e).__name__,
            exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail=f"Retrieval error: {str(e)}",
        )

    async def event_gen() -> AsyncIterator[str]:
        try:
            async for event in generate_answer_stream(
                query=query_request.query,
                retrieved_chunks=retrieved_chunks,
                document_list_context=document_list_context,
                rag_model=rag_model,
                retrieved_chunk_count=len(retrieved_chunks),
                include_debug=query_request.debug,
            ):
                if event.get("type") == "done":
                    query_log_id: str | None = None
                    try:
                        client_ip = request.client.host if request.client else None
                        user_agent = request.headers.get("user-agent")
                        ans = event.get("answer") or ""
                        citations = event.get("citations") or []
                        query_log_id = await log_query(
                            query_text=query_request.query,
                            rag_model=rag_model,
                            top_k=query_request.top_k,
                            request_id=request_id,
                            client_ip=client_ip,
                            user_agent=user_agent,
                            latency_ms=event.get("latency_ms"),
                            token_usage=event.get("token_usage"),
                            citations_count=len(citations),
                            answer_length=len(ans) if ans else None,
                        )
                    except Exception as log_err:
                        logger.warning(
                            "Failed to log streamed query",
                            request_id=request_id,
                            error=str(log_err),
                        )
                    event = {
                        **event,
                        "request_id": request_id,
                        "query_log_id": query_log_id,
                    }
                yield f"data: {json.dumps(event)}\n\n"
        except AnswerError as e:
            err_body = {"type": "error", "message": str(e)}
            yield f"data: {json.dumps(err_body)}\n\n"

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
