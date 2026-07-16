"""Shared types for RAG retrieval."""

from dataclasses import dataclass


@dataclass
class RetrievedChunk:
    """Retrieved chunk with metadata and similarity score."""

    chunk_id: str
    document_id: str
    title: str | None
    source: str
    chunk_index: int
    content: str
    score: float
    """
    Score represents cosine similarity (1 - cosine_distance).
    Range: 0.0 to 1.0, where:
    - 1.0 = identical vectors (cosine distance = 0)
    - 0.0 = orthogonal vectors (cosine distance = 1)
    Higher scores indicate greater semantic similarity.
    """


class RetrieveError(Exception):
    """Base exception for retrieval errors."""

    pass
