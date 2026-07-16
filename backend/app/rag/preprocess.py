"""
Production-grade text normalization before chunking.

Goals: stable Unicode, sane line endings, removal of control noise from PDF/DOCX extraction,
fewer degenerate chunks caused by excessive whitespace or repeated OCR paragraphs.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field

from app.core.config import settings


@dataclass
class PreprocessReport:
    """Structured preprocessing outcome for logs and API responses."""

    text: str
    original_character_count: int
    normalized_character_count: int
    steps_applied: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def character_delta(self) -> int:
        return self.normalized_character_count - self.original_character_count


_CONTROL_REMOVE_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def preprocess_ingest_text(raw_text: str) -> PreprocessReport:
    """
    Normalize document text prior to chunking.

    Conservative by default: structure-friendly for both plain text and markdown.
    """
    steps: list[str] = []
    warnings: list[str] = []

    original_character_count = len(raw_text)
    text = raw_text

    if original_character_count > settings.MAX_INGEST_PAYLOAD_SIZE:
        # Caller should reject earlier; avoid pointless work.
        return PreprocessReport(
            text=text,
            original_character_count=original_character_count,
            normalized_character_count=len(text),
            steps_applied=[],
            warnings=["payload_already_over_limit"],
        )

    # UTF-8 BOM
    if text.startswith("\ufeff"):
        text = text[1:]
        steps.append("removed_utf8_bom")

    # Unicode canonical composition (stable graphemes across platforms)
    nfc = unicodedata.normalize("NFC", text)
    if nfc != text:
        steps.append("unicode_nfc")
    text = nfc

    # Newlines
    if "\r" in text:
        text = text.replace("\r\n", "\n").replace("\r", "\n")
        steps.append("normalized_crlf")

    # Strip control characters (keep TAB / LF); common in PDF extracts
    cleaned_controls = _CONTROL_REMOVE_RE.sub("", text)
    if cleaned_controls != text:
        removed = len(text) - len(cleaned_controls)
        steps.append(f"stripped_control_chars:{removed}")
        text = cleaned_controls

    # Per-line trailing whitespace ( preserves intentional leading indent )
    lines = text.split("\n")
    stripped_lines = [ln.rstrip() for ln in lines]
    if stripped_lines != lines:
        steps.append("stripped_trailing_line_whitespace")
    text = "\n".join(stripped_lines)

    # Collapse long runs of blank lines (PDF noise / pagination)
    max_run = settings.INGEST_COLLAPSE_BLANK_LINES_TO
    if max_run >= 1:
        pattern = rf"\n{{{max_run + 1},}}"
        collapsed = re.sub(pattern, "\n" * max_run, text)
        if collapsed != text:
            steps.append(f"collapsed_blank_line_runs_to_max_{max_run}")
        text = collapsed

    # Merge consecutive duplicate paragraphs (common in PDF/OCR extracts)
    if settings.INGEST_DEDUPE_CONSECUTIVE_PARAGRAPHS:
        blocks = text.split("\n\n")
        deduped: list[str] = []
        prev_norm: str | None = None
        skipped = 0
        for block in blocks:
            norm = block.strip()
            if norm and prev_norm == norm:
                skipped += 1
                continue
            deduped.append(block)
            prev_norm = norm if norm else prev_norm

        if skipped:
            steps.append(f"deduped_consecutive_paragraphs:{skipped}")
            text = "\n\n".join(deduped)

    text = text.strip()
    normalized_character_count = len(text)

    if normalized_character_count == 0:
        warnings.append("empty_after_preprocessing")

    if (
        normalized_character_count < original_character_count * 0.5
        and original_character_count > 500
    ):
        warnings.append("large_fraction_removed_review_source_quality")

    return PreprocessReport(
        text=text,
        original_character_count=original_character_count,
        normalized_character_count=normalized_character_count,
        steps_applied=steps,
        warnings=warnings,
    )
