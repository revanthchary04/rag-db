"""Unit tests for ingest preprocessing."""

from unittest.mock import patch

from app.rag.preprocess import preprocess_ingest_text


def test_preprocess_removes_bom_and_normalizes_newlines():
    raw = "\ufeffLine one\r\nLine two\rDuplicate\n\nDuplicate body\n\nDuplicate body"
    with patch("app.rag.preprocess.settings.INGEST_DEDUPE_CONSECUTIVE_PARAGRAPHS", True):
        report = preprocess_ingest_text(raw)
    assert not report.text.startswith("\ufeff")
    assert "\r" not in report.text
    assert "removed_utf8_bom" in report.steps_applied
    assert "normalized_crlf" in report.steps_applied
    assert any(s.startswith("deduped_consecutive_paragraphs") for s in report.steps_applied)


def test_preprocess_strips_controls():
    raw = "Hello\x00\x07world"
    report = preprocess_ingest_text(raw)
    assert "\x00" not in report.text
    assert "Hello" in report.text and "world" in report.text


def test_preprocess_collapses_blank_lines():
    raw = "a\n\n\n\n\nb"
    report = preprocess_ingest_text(raw)
    assert "\n\n\n" not in report.text


def test_preprocess_whitespace_only_warns_and_empty():
    raw = "   \n\t  "
    report = preprocess_ingest_text(raw)
    assert report.normalized_character_count == 0
    assert "empty_after_preprocessing" in report.warnings
