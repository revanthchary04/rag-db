import re

import structlog
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse, Response

from app.db.queries import (
    count_documents,
    delete_document,
    fetch_document_original,
    get_chunks_by_document_id,
    get_document_by_id,
    list_documents,
)
from app.schemas import (
    ChunkResponse,
    DocumentListResponse,
    DocumentResponse,
)

logger = structlog.get_logger()

router = APIRouter()


def _safe_inline_filename(title: str | None, doc_id: str, media_type: str) -> str:
    base = (title or doc_id).strip() or "document"
    safe = re.sub(r"[^a-zA-Z0-9._\- ]+", "-", base).strip(".- ")[:120] or "document"
    ext = ".pdf" if "pdf" in media_type.lower() else ""
    return f"{safe}{ext}"


@router.get("/documents", response_model=DocumentListResponse)
async def list_documents_endpoint(
    request: Request,
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    include_total: bool = Query(False, description="Include total count (slower)"),
):
    """List documents with pagination."""
    import time

    endpoint_start = time.time()
    request_id = getattr(request.state, "request_id", "unknown")

    try:
        # Fetch documents first (no ordering for faster query)
        list_start = time.time()
        documents = await list_documents(limit=limit, offset=offset)
        list_time = (time.time() - list_start) * 1000

        # Only fetch total count if explicitly requested (frontend doesn't need it)
        count_time = 0.0
        if include_total:
            count_start = time.time()
            total = await count_documents()
            count_time = (time.time() - count_start) * 1000
        else:
            # Use a lightweight approximation - if we got fewer than limit, that's the total
            # Otherwise, we don't know the exact total without counting
            total = len(documents) if len(documents) < limit else len(documents) + offset

        response_start = time.time()
        response = DocumentListResponse(
            documents=[
                DocumentResponse(
                    id=doc["id"],
                    source=doc["source"],
                    title=doc["title"],
                    created_at=doc["created_at"],
                    original_available=doc.get("original_available", False),
                )
                for doc in documents
            ],
            total=total,
            limit=limit,
            offset=offset,
        )
        response_time = (time.time() - response_start) * 1000
        total_time = (time.time() - endpoint_start) * 1000

        logger.info(
            "list_documents_endpoint timing",
            request_id=request_id,
            list_documents_ms=list_time,
            count_ms=count_time,
            response_build_ms=response_time,
            total_ms=total_time,
            document_count=len(documents),
            include_total=include_total,
        )

        return response
    except Exception as e:
        logger.error(
            "List documents error",
            request_id=request_id,
            error=str(e),
            exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail="Internal server error",
        )


@router.get("/documents/{document_id}", response_model=DocumentResponse)
async def get_document_endpoint(
    request: Request,
    document_id: str,
):
    """Get a document by ID."""
    document = await get_document_by_id(document_id)
    if not document:
        raise HTTPException(
            status_code=404,
            detail=f"Document {document_id} not found",
        )

    return DocumentResponse(
        id=document["id"],
        source=document["source"],
        title=document["title"],
        created_at=document["created_at"].isoformat() if document["created_at"] else None,
        original_available=bool(document.get("original_available", False)),
    )


@router.get("/documents/{document_id}/original")
async def get_document_original_endpoint(
    document_id: str,
):
    """Serve stored original binary (e.g. PDF) for inline preview."""
    document = await get_document_by_id(document_id)
    if not document:
        raise HTTPException(
            status_code=404,
            detail=f"Document {document_id} not found",
        )

    blob = await fetch_document_original(document_id)
    if not blob:
        raise HTTPException(
            status_code=404,
            detail="No original file is stored for this document (re-ingest from PDF to enable preview)",
        )

    data, media_type = blob
    filename = _safe_inline_filename(document.get("title"), document_id, media_type)
    return Response(
        content=data,
        media_type=media_type,
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


@router.get("/documents/{document_id}/chunks", response_model=list[ChunkResponse])
async def get_document_chunks_endpoint(
    request: Request,
    document_id: str,
):
    """Get all chunks for a document."""
    request_id = getattr(request.state, "request_id", "unknown")

    # Verify document exists
    document = await get_document_by_id(document_id)
    if not document:
        raise HTTPException(
            status_code=404,
            detail=f"Document {document_id} not found",
        )

    try:
        chunks = await get_chunks_by_document_id(document_id)
        return [
            ChunkResponse(
                id=chunk["id"],
                document_id=chunk["document_id"],
                chunk_index=chunk["chunk_index"],
                content=chunk["content"],
                metadata=chunk["metadata"],
                created_at=chunk["created_at"],
            )
            for chunk in chunks
        ]
    except Exception as e:
        logger.error(
            "Get document chunks error",
            request_id=request_id,
            document_id=document_id,
            error=str(e),
            exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail="Internal server error",
        )


@router.delete("/documents/{document_id}")
async def delete_document_endpoint(
    request: Request,
    document_id: str,
):
    """Delete a document and all its chunks."""
    request_id = getattr(request.state, "request_id", "unknown")

    # Verify document exists
    document = await get_document_by_id(document_id)
    if not document:
        raise HTTPException(
            status_code=404,
            detail=f"Document {document_id} not found",
        )

    try:
        deleted = await delete_document(document_id)
        if not deleted:
            raise HTTPException(
                status_code=500,
                detail="Failed to delete document",
            )

        logger.info(
            "Document deleted",
            request_id=request_id,
            document_id=document_id,
        )

        return JSONResponse(
            status_code=200,
            content={
                "message": "Document deleted successfully",
                "document_id": document_id,
            },
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Delete document error",
            request_id=request_id,
            document_id=document_id,
            error=str(e),
            exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail="Internal server error",
        )
