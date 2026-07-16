"""
Resolve per-document chunk size and overlap from normalized character count.

When enabled, targets a reasonable number of chunks for the document length while
respecting min/max bounds. When disabled, uses global CHUNK_SIZE / CHUNK_OVERLAP.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from app.core.config import settings


@dataclass(frozen=True)
class ResolvedChunkParams:
    """Effective chunking parameters for one ingest run."""

    chunk_size: int
    chunk_overlap: int
    adaptive: bool
    character_count: int
    config_chunk_size: int
    config_chunk_overlap: int
    estimated_target_chunks: int


def _clamp_overlap(overlap: int, chunk_size: int) -> int:
    if chunk_size <= 1:
        return 0
    return max(0, min(overlap, chunk_size - 1))


def resolve_ingest_chunk_params(character_count: int) -> ResolvedChunkParams:
    """
    Pick (chunk_size, chunk_overlap) for this document.

    ``character_count`` should be the length of **preprocessed** text.
    """
    base_size = settings.CHUNK_SIZE
    base_overlap = settings.CHUNK_OVERLAP
    n = max(0, character_count)

    if not settings.INGEST_ADAPTIVE_CHUNKING:
        overlap = _clamp_overlap(base_overlap, base_size)
        est = max(1, math.ceil(n / base_size)) if base_size > 0 else 1
        return ResolvedChunkParams(
            chunk_size=base_size,
            chunk_overlap=overlap,
            adaptive=False,
            character_count=n,
            config_chunk_size=base_size,
            config_chunk_overlap=base_overlap,
            estimated_target_chunks=est,
        )

    lo = max(64, settings.INGEST_ADAPTIVE_CHUNK_MIN)
    hi = max(lo + 1, settings.INGEST_ADAPTIVE_CHUNK_MAX)

    if n == 0:
        overlap = _clamp_overlap(base_overlap, base_size)
        return ResolvedChunkParams(
            chunk_size=base_size,
            chunk_overlap=overlap,
            adaptive=True,
            character_count=n,
            config_chunk_size=base_size,
            config_chunk_overlap=base_overlap,
            estimated_target_chunks=1,
        )

    if n <= lo:
        chunk_size = n
    elif n <= lo * 4:
        target = max(2, min(5, math.ceil(n / (lo * 0.9))))
        chunk_size = max(lo, min(hi, math.ceil(n / target)))
    elif n <= 25_000:
        target = max(5, min(12, int(round(4 + 2.2 * math.log1p(n / 1000.0)))))
        chunk_size = max(lo, min(hi, math.ceil(n / target)))
    else:
        target = max(12, min(40, math.ceil(n / float(hi))))
        chunk_size = max(lo, min(hi, math.ceil(n / target)))

    chunk_size = max(1, min(chunk_size, n))

    ratio = settings.INGEST_ADAPTIVE_OVERLAP_RATIO
    overlap = int(round(chunk_size * ratio))
    overlap = min(overlap, base_overlap)
    overlap = _clamp_overlap(overlap, chunk_size)

    estimated_target = max(1, math.ceil(n / chunk_size)) if chunk_size else 1

    return ResolvedChunkParams(
        chunk_size=chunk_size,
        chunk_overlap=overlap,
        adaptive=True,
        character_count=n,
        config_chunk_size=base_size,
        config_chunk_overlap=base_overlap,
        estimated_target_chunks=estimated_target,
    )
