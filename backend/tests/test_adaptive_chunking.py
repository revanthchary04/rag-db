"""Unit tests for adaptive ingest chunk sizing."""

from unittest.mock import patch

from app.core.config import settings
from app.rag.adaptive_chunking import resolve_ingest_chunk_params


def test_adaptive_disabled_uses_config():
    with patch.object(settings, "INGEST_ADAPTIVE_CHUNKING", False):
        r = resolve_ingest_chunk_params(50_000)
    assert r.adaptive is False
    assert r.chunk_size == settings.CHUNK_SIZE
    assert r.chunk_overlap <= r.chunk_size - 1


def test_adaptive_short_doc_uses_small_target():
    with patch.object(settings, "INGEST_ADAPTIVE_CHUNKING", True):
        r = resolve_ingest_chunk_params(800)
    assert r.adaptive is True
    assert r.chunk_size <= settings.INGEST_ADAPTIVE_CHUNK_MAX
    assert r.chunk_overlap < r.chunk_size
    assert r.estimated_target_chunks >= 1


def test_adaptive_long_doc_caps_at_max():
    with patch.object(settings, "INGEST_ADAPTIVE_CHUNKING", True):
        r = resolve_ingest_chunk_params(500_000)
    assert r.chunk_size == settings.INGEST_ADAPTIVE_CHUNK_MAX
    assert r.chunk_overlap < r.chunk_size


def test_adaptive_zero_chars_falls_back_to_base():
    with patch.object(settings, "INGEST_ADAPTIVE_CHUNKING", True):
        r = resolve_ingest_chunk_params(0)
    assert r.chunk_size == settings.CHUNK_SIZE


def test_overlap_never_exceeds_chunk_minus_one():
    with patch.object(settings, "INGEST_ADAPTIVE_CHUNKING", True):
        for n in (1, 50, 200, 900, 4000, 30_000):
            r = resolve_ingest_chunk_params(n)
            assert r.chunk_overlap <= max(0, r.chunk_size - 1), n
