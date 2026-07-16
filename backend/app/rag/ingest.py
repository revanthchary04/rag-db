import json
import statistics
from typing import Any

import structlog

from app.core.config import settings
from app.db.session import get_db_pool
from app.llm.openai_client import OpenAIError, get_llm_client
from app.rag.adaptive_chunking import resolve_ingest_chunk_params
from app.rag.chunking import TextChunker, merge_undersized_chunks
from app.rag.preprocess import preprocess_ingest_text

logger = structlog.get_logger()

# Maximum document size (10MB in characters, roughly)
MAX_DOCUMENT_SIZE = 10 * 1024 * 1024


class IngestError(Exception):
    """Base exception for ingestion errors."""

    pass


class DocumentTooLargeError(IngestError):
    """Document exceeds maximum size."""

    pass


async def find_existing_document(source: str, title: str | None) -> dict[str, Any] | None:
    """
    Find existing document by source and title.

    Args:
        source: Document source
        title: Document title

    Returns:
        Document dict if found, None otherwise
    """
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        if title:
            row = await conn.fetchrow(
                """
                SELECT id, source, title, created_at
                FROM documents
                WHERE source = $1 AND title = $2
                ORDER BY created_at DESC
                LIMIT 1
                """,
                source,
                title,
            )
        else:
            row = await conn.fetchrow(
                """
                SELECT id, source, title, created_at
                FROM documents
                WHERE source = $1 AND title IS NULL
                ORDER BY created_at DESC
                LIMIT 1
                """,
                source,
            )

        if row:
            return dict(row)
        return None


def generate_document_id(source: str, title: str | None, version: int = 1) -> str:
    """
    Generate a unique document ID.

    Args:
        source: Document source
        title: Document title
        version: Version number (for idempotency)

    Returns:
        Unique document ID
    """
    if version > 1:
        # Include version in the ID for new versions
        base_id = f"{source}-{title or 'untitled'}-v{version}".lower()
        # Replace invalid characters
        base_id = "".join(c if c.isalnum() or c in "-_" else "-" for c in base_id)
        return base_id
    else:
        # Original document ID
        base_id = f"{source}-{title or 'untitled'}".lower()
        base_id = "".join(c if c.isalnum() or c in "-_" else "-" for c in base_id)
        return base_id


def generate_versioned_source(source: str, version: int) -> str:
    """
    Generate versioned source string.

    Args:
        source: Original source
        version: Version number

    Returns:
        Versioned source string
    """
    if version > 1:
        return f"{source} (v{version})"
    return source


async def ingest_document(
    source: str,
    title: str | None,
    text: str,
    is_markdown: bool = False,
    original_bytes: bytes | None = None,
    original_media_type: str | None = None,
) -> dict[str, Any]:
    """
    Ingest a document into the database.

    If INGEST_REPLACE_IF_EXISTS is true and a row already exists for (source, title),
    old chunks are removed and new ones are written (same document id, canonical source).

    Otherwise, if a document with the same (source, title) already exists, a new row
    is created with a versioned source string.

    Args:
        source: Document source
        title: Document title (optional)
        text: Document text content
        is_markdown: Whether the text is markdown

    Returns:
        Dict with document_id and chunks_created

    Raises:
        DocumentTooLargeError: If document exceeds maximum size
        IngestError: On other ingestion errors
    """
    # Validate document size
    if len(text) > MAX_DOCUMENT_SIZE:
        raise DocumentTooLargeError(
            f"Document size ({len(text)} chars) exceeds maximum ({MAX_DOCUMENT_SIZE} chars)"
        )

    # Resolve document identity: replace in place, new versioned row, or new doc
    existing = await find_existing_document(source, title)
    replace_existing = bool(existing and settings.INGEST_REPLACE_IF_EXISTS)

    if replace_existing:
        assert existing is not None
        document_id = str(existing["id"])
        versioned_source = source
        logger.info(
            "Replacing chunks for existing document",
            source=source,
            title=title,
            document_id=document_id,
        )
    elif existing:
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            version_rows = await conn.fetch(
                """
                SELECT source
                FROM documents
                WHERE source = $1 OR source LIKE $1 || ' (v%'
                ORDER BY created_at DESC
                """,
                source,
            )
            versions = []
            for row in version_rows:
                source_str = row["source"]
                if source_str == source:
                    versions.append(1)
                elif " (v" in source_str:
                    try:
                        v = int(source_str.split(" (v")[1].rstrip(")"))
                        versions.append(v)
                    except (ValueError, IndexError):
                        pass
            version = max(versions) + 1 if versions else 2

        logger.info(
            "Document already exists, creating new version",
            source=source,
            title=title,
            version=version,
        )
        document_id = generate_document_id(source, title, version)
        versioned_source = generate_versioned_source(source, version)
    else:
        document_id = generate_document_id(source, title, 1)
        versioned_source = generate_versioned_source(source, 1)

    preprocess_report = preprocess_ingest_text(text)
    if preprocess_report.warnings:
        logger.info(
            "ingest_preprocess_warnings",
            document_id=document_id,
            warnings=preprocess_report.warnings,
            steps=preprocess_report.steps_applied,
        )

    normalized_text = preprocess_report.text
    if not normalized_text.strip():
        raise IngestError(
            "No usable text after preprocessing (empty or whitespace-only). "
            "Check extraction quality or disable aggressive cleaners upstream."
        )

    chunk_params = resolve_ingest_chunk_params(len(normalized_text))
    chunker = TextChunker(
        chunk_size=chunk_params.chunk_size,
        chunk_overlap=chunk_params.chunk_overlap,
    )
    chunks = chunker.chunk(normalized_text, is_markdown=is_markdown)

    if not chunks:
        raise IngestError("No chunks generated from document")

    raw_chunk_count = len(chunks)
    soft_cap = max(
        chunk_params.chunk_size,
        int(chunk_params.chunk_size * settings.INGEST_MERGED_CHUNK_SOFT_CAP_RATIO),
    )
    chunks, undersized_merges = merge_undersized_chunks(
        chunks,
        settings.INGEST_MIN_CHUNK_CHARS,
        soft_cap,
    )

    lengths = [len(c.content) for c in chunks]
    chunk_summary = {
        "chunks_before_merge": raw_chunk_count,
        "chunks_created": len(chunks),
        "undersized_chunk_merges": undersized_merges,
        "chunk_target_size": chunk_params.chunk_size,
        "chunk_overlap": chunk_params.chunk_overlap,
        "adaptive_chunking": chunk_params.adaptive,
        "config_chunk_size": chunk_params.config_chunk_size,
        "config_chunk_overlap": chunk_params.config_chunk_overlap,
        "estimated_target_chunks": chunk_params.estimated_target_chunks,
        "min_chunk_characters_applied": settings.INGEST_MIN_CHUNK_CHARS,
        "merged_chunk_soft_cap_chars": soft_cap,
        "chunk_length_min": min(lengths) if lengths else 0,
        "chunk_length_max": max(lengths) if lengths else 0,
        "chunk_length_mean": round(statistics.mean(lengths), 1) if lengths else 0.0,
        "chunk_length_median": float(statistics.median(lengths)) if lengths else 0.0,
    }

    logger.info(
        "ingest_chunked",
        document_id=document_id,
        chunks_count=len(chunks),
        undersized_merges=undersized_merges,
        preprocess_steps=len(preprocess_report.steps_applied),
        adaptive_chunking=chunk_params.adaptive,
        resolved_chunk_size=chunk_params.chunk_size,
        resolved_chunk_overlap=chunk_params.chunk_overlap,
    )

    # Get embeddings for all chunks (batched)
    openai_client = get_llm_client()
    chunk_texts = [chunk.content for chunk in chunks]

    try:
        embedding_responses = await openai_client.create_embeddings(chunk_texts)
    except OpenAIError as e:
        logger.error("Failed to generate embeddings", error=str(e))
        raise IngestError(f"Failed to generate embeddings: {str(e)}") from e

    if len(embedding_responses) != len(chunks):
        raise IngestError(
            f"Embedding count mismatch: expected {len(chunks)}, got {len(embedding_responses)}"
        )

    # Insert document and chunks in a transaction
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            try:
                if replace_existing:
                    await conn.execute(
                        "DELETE FROM chunks WHERE document_id = $1",
                        document_id,
                    )
                    if original_bytes is not None:
                        await conn.execute(
                            """
                            UPDATE documents
                            SET source = $2,
                                title = $3,
                                original_file = $4,
                                original_media_type = $5
                            WHERE id = $1
                            """,
                            document_id,
                            versioned_source,
                            title,
                            original_bytes,
                            original_media_type,
                        )
                    else:
                        await conn.execute(
                            """
                            UPDATE documents
                            SET source = $2, title = $3
                            WHERE id = $1
                            """,
                            document_id,
                            versioned_source,
                            title,
                        )
                else:
                    await conn.execute(
                        """
                        INSERT INTO documents (
                            id, source, title, original_file, original_media_type
                        )
                        VALUES ($1, $2, $3, $4, $5)
                        ON CONFLICT (id) DO UPDATE
                        SET source = EXCLUDED.source,
                            title = EXCLUDED.title,
                            original_file = COALESCE(
                                EXCLUDED.original_file,
                                documents.original_file
                            ),
                            original_media_type = COALESCE(
                                EXCLUDED.original_media_type,
                                documents.original_media_type
                            )
                        """,
                        document_id,
                        versioned_source,
                        title,
                        original_bytes,
                        original_media_type,
                    )

                # Insert chunks
                for i, (chunk, embedding_response) in enumerate(zip(chunks, embedding_responses)):
                    embedding = embedding_response.embedding
                    embedding_str = "[" + ",".join(map(str, embedding)) + "]"

                    chunk_id = f"{document_id}-{i}"

                    # Convert metadata dict to JSON string for JSONB column
                    metadata_json = json.dumps(chunk.metadata) if chunk.metadata else "{}"

                    await conn.execute(
                        """
                        INSERT INTO chunks (
                            id, document_id, chunk_index, content, metadata, embedding
                        )
                        VALUES ($1, $2, $3, $4, $5::jsonb, $6::vector)
                        ON CONFLICT (id) DO UPDATE
                        SET content = EXCLUDED.content,
                            metadata = EXCLUDED.metadata,
                            embedding = EXCLUDED.embedding
                        """,
                        chunk_id,
                        document_id,
                        chunk.chunk_index,
                        chunk.content,
                        metadata_json,
                        embedding_str,
                    )

                logger.info(
                    "Successfully ingested document",
                    document_id=document_id,
                    chunks_created=len(chunks),
                    replaced_existing=replace_existing,
                    preprocess_character_delta=preprocess_report.character_delta,
                )

                return {
                    "document_id": document_id,
                    "chunks_created": len(chunks),
                    "replaced_existing": replace_existing,
                    "preprocessing": {
                        "original_character_count": preprocess_report.original_character_count,
                        "normalized_character_count": preprocess_report.normalized_character_count,
                        "character_delta": preprocess_report.character_delta,
                        "steps_applied": preprocess_report.steps_applied,
                        "warnings": preprocess_report.warnings,
                    },
                    "chunking": chunk_summary,
                }

            except Exception as e:
                logger.error(
                    "Failed to ingest document",
                    document_id=document_id,
                    error=str(e),
                    exc_info=True,
                )
                raise IngestError(f"Failed to ingest document: {str(e)}") from e
