import re
from dataclasses import dataclass
from typing import Any

from app.core.config import settings


@dataclass
class Chunk:
    """Represents a text chunk with metadata."""

    chunk_index: int
    content: str
    metadata: dict[str, Any]


class TextChunker:
    """Production-friendly text chunker with markdown support."""

    def __init__(
        self,
        chunk_size: int | None = None,
        chunk_overlap: int | None = None,
    ):
        """
        Initialize chunker.

        Args:
            chunk_size: Maximum characters per chunk (defaults to settings.CHUNK_SIZE)
            chunk_overlap: Overlap between chunks in characters (defaults to settings.CHUNK_OVERLAP)
        """
        self.chunk_size = settings.CHUNK_SIZE if chunk_size is None else chunk_size
        self.chunk_overlap = settings.CHUNK_OVERLAP if chunk_overlap is None else chunk_overlap

        if self.chunk_size <= 0:
            raise ValueError("chunk_size must be positive")
        if self.chunk_overlap < 0:
            raise ValueError("chunk_overlap must be non-negative")
        if self.chunk_overlap >= self.chunk_size:
            raise ValueError("chunk_overlap must be less than chunk_size")

    def chunk(self, text: str, is_markdown: bool = False) -> list[Chunk]:
        """
        Chunk text into smaller pieces.

        Args:
            text: Text to chunk
            is_markdown: Whether the text is markdown (enables heading extraction)

        Returns:
            List of Chunk objects
        """
        if not text.strip():
            return []

        if is_markdown:
            return self._chunk_markdown(text)
        else:
            return self._chunk_plain_text(text)

    def _chunk_plain_text(self, text: str) -> list[Chunk]:
        """Chunk plain text with overlap."""
        chunks = []
        start = 0
        chunk_index = 0

        while start < len(text):
            end = min(start + self.chunk_size, len(text))

            # If we're not at the end, try to break at a sentence boundary
            if end < len(text):
                # Look for sentence endings (., !, ?) followed by space
                sentence_end = self._find_sentence_boundary(text, start, end)
                if sentence_end > start:
                    end = sentence_end + 1

            chunk_content = text[start:end].strip()

            # Skip empty chunks
            if not chunk_content:
                break

            chunks.append(
                Chunk(
                    chunk_index=chunk_index,
                    content=chunk_content,
                    metadata={},
                )
            )

            # Move start position with overlap
            if end >= len(text):
                break

            # Calculate next start position with overlap
            next_start = end - self.chunk_overlap
            # Ensure we make progress
            if next_start <= start:
                next_start = start + 1

            start = next_start
            chunk_index += 1

        # Merge tiny trailing chunk if appropriate
        if len(chunks) > 1:
            last_chunk = chunks[-1]
            if len(last_chunk.content) < self.chunk_size * 0.3:  # Less than 30% of chunk size
                # Merge with previous chunk if combined size is reasonable
                prev_chunk = chunks[-2]
                combined = prev_chunk.content + "\n\n" + last_chunk.content
                if len(combined) <= self.chunk_size * 1.2:  # Within 120% of chunk size
                    chunks[-2] = Chunk(
                        chunk_index=prev_chunk.chunk_index,
                        content=combined,
                        metadata=prev_chunk.metadata,
                    )
                    chunks.pop()

        return chunks

    def _chunk_markdown(self, text: str) -> list[Chunk]:
        """Chunk markdown text with heading awareness."""
        # Parse markdown to extract sections with headings
        sections = self._parse_markdown_sections(text)

        if not sections:
            # Fallback to plain text chunking if no sections found
            return self._chunk_plain_text(text)

        chunks = []
        chunk_index = 0
        current_chunk_content: list[str] = []
        current_metadata: dict[str, Any] = {"heading_path": []}
        current_size = 0

        for section in sections:
            section_text = section["content"]
            heading_path = section["heading_path"]

            # If section itself is too large, chunk it separately
            if len(section_text) > self.chunk_size:
                # Finalize current chunk if it has content
                if current_chunk_content:
                    chunks.append(
                        Chunk(
                            chunk_index=chunk_index,
                            content="\n\n".join(current_chunk_content),
                            metadata=current_metadata.copy(),
                        )
                    )
                    chunk_index += 1
                    current_chunk_content = []
                    current_size = 0

                # Chunk the large section using plain text chunking
                section_chunks = self._chunk_plain_text(section_text)
                for sc in section_chunks:
                    sc.metadata["heading_path"] = heading_path.copy()
                    sc.chunk_index = chunk_index
                    chunks.append(sc)
                    chunk_index += 1
                continue

            # If adding this section would exceed chunk size, finalize current chunk
            if current_size > 0 and current_size + len(section_text) + 2 > self.chunk_size:
                # Finalize current chunk
                chunks.append(
                    Chunk(
                        chunk_index=chunk_index,
                        content="\n\n".join(current_chunk_content),
                        metadata=current_metadata.copy(),
                    )
                )
                chunk_index += 1

                # Start new chunk with overlap
                overlap_text = self._get_overlap_text("\n\n".join(current_chunk_content))
                current_chunk_content = [overlap_text] if overlap_text else []
                current_metadata = {"heading_path": heading_path.copy()}
                current_size = len(overlap_text)

            # Add section to current chunk
            current_chunk_content.append(section_text)
            current_metadata["heading_path"] = heading_path
            current_size += len(section_text) + 2  # +2 for "\n\n"

        # Add final chunk
        if current_chunk_content:
            chunks.append(
                Chunk(
                    chunk_index=chunk_index,
                    content="\n\n".join(current_chunk_content),
                    metadata=current_metadata,
                )
            )

        # Handle tiny trailing chunks
        if len(chunks) > 1:
            last_chunk = chunks[-1]
            if len(last_chunk.content) < self.chunk_size * 0.3:
                prev_chunk = chunks[-2]
                combined = prev_chunk.content + "\n\n" + last_chunk.content
                if len(combined) <= self.chunk_size * 1.2:
                    # Merge metadata (prefer more specific heading path)
                    merged_metadata = prev_chunk.metadata.copy()
                    if last_chunk.metadata.get("heading_path"):
                        merged_metadata["heading_path"] = last_chunk.metadata["heading_path"]

                    chunks[-2] = Chunk(
                        chunk_index=prev_chunk.chunk_index,
                        content=combined,
                        metadata=merged_metadata,
                    )
                    chunks.pop()

        return chunks

    def _parse_markdown_sections(self, text: str) -> list[dict[str, Any]]:
        """Parse markdown into sections with heading paths."""
        sections = []
        lines = text.split("\n")
        current_heading_path: list[str] = []
        current_content: list[str] = []

        for line in lines:
            # Check for heading (markdown headers: #, ##, ###, etc.)
            heading_match = re.match(r"^(#{1,6})\s+(.+)$", line.strip())
            if heading_match:
                # Save previous section if it has content
                if current_content:
                    sections.append(
                        {
                            "content": "\n".join(current_content).strip(),
                            "heading_path": current_heading_path.copy(),
                        }
                    )
                    current_content = []

                # Update heading path
                level = len(heading_match.group(1))
                heading_text = heading_match.group(2).strip()

                # Trim heading path to current level
                current_heading_path = current_heading_path[: level - 1]
                current_heading_path.append(heading_text)
            else:
                current_content.append(line)

        # Add final section
        if current_content:
            sections.append(
                {
                    "content": "\n".join(current_content).strip(),
                    "heading_path": current_heading_path.copy(),
                }
            )

        return sections

    def _find_sentence_boundary(self, text: str, start: int, end: int) -> int:
        """Find the last sentence boundary before end position."""
        # Look backwards from end for sentence endings
        search_start = max(start, end - 200)  # Look back up to 200 chars
        search_text = text[search_start:end]

        # Find last sentence ending (., !, ?) followed by space or newline
        pattern = r"[.!?][\s\n]+"
        matches = list(re.finditer(pattern, search_text))
        if matches:
            last_match = matches[-1]
            return search_start + last_match.end() - 1

        return end

    def _get_overlap_text(self, text: str) -> str:
        """Get overlap text from the end of a chunk."""
        if not text or self.chunk_overlap == 0:
            return ""

        # Get last chunk_overlap characters
        overlap = text[-self.chunk_overlap :]

        # Try to start at a sentence boundary
        sentence_start = re.search(r"[.!?][\s\n]+", overlap)
        if sentence_start:
            return overlap[sentence_start.end() :].strip()

        # Try to start at a word boundary
        word_start = re.search(r"\s+", overlap)
        if word_start:
            return overlap[word_start.end() :].strip()

        return overlap.strip()


def merge_two_chunks(left: Chunk, right: Chunk) -> Chunk:
    meta = {**left.metadata, **right.metadata}
    return Chunk(
        chunk_index=left.chunk_index,
        content=left.content + "\n\n" + right.content,
        metadata=meta,
    )


def merge_undersized_chunks(
    chunks: list[Chunk],
    min_chars: int,
    soft_max_chars: int,
) -> tuple[list[Chunk], int]:
    """
    Merge uncomfortably small chunks into neighbors when under soft_max_chars.

    Returns (reindexed_chunks, merge_operations_count).
    """
    if not chunks or min_chars <= 0:
        reindexed = [
            Chunk(chunk_index=i, content=c.content, metadata=dict(c.metadata))
            for i, c in enumerate(chunks)
        ]
        return reindexed, 0

    out: list[Chunk] = [
        Chunk(
            chunk_index=chunks[0].chunk_index,
            content=chunks[0].content,
            metadata=dict(chunks[0].metadata),
        )
    ]
    merges = 0

    for cur in chunks[1:]:
        prev = out[-1]
        prev_small = len(prev.content.strip()) < min_chars
        cur_small = len(cur.content.strip()) < min_chars

        merged = merge_two_chunks(prev, cur)
        if (cur_small or prev_small) and len(merged.content) <= soft_max_chars:
            out[-1] = Chunk(
                chunk_index=prev.chunk_index,
                content=merged.content,
                metadata=merged.metadata,
            )
            merges += 1
        else:
            out.append(
                Chunk(chunk_index=cur.chunk_index, content=cur.content, metadata=dict(cur.metadata))
            )

    while len(out) >= 2 and len(out[-1].content.strip()) < min_chars:
        last = out.pop()
        prev = out[-1]
        merged = merge_two_chunks(prev, last)
        if len(merged.content) <= soft_max_chars:
            out[-1] = Chunk(
                chunk_index=prev.chunk_index,
                content=merged.content,
                metadata=merged.metadata,
            )
            merges += 1
        else:
            out.append(last)
            break

    for i, ch in enumerate(out):
        ch.chunk_index = i

    return out, merges


def chunk_text(
    text: str,
    is_markdown: bool = False,
    chunk_size: int | None = None,
    chunk_overlap: int | None = None,
) -> list[Chunk]:
    """
    Convenience function to chunk text.

    Args:
        text: Text to chunk
        is_markdown: Whether the text is markdown
        chunk_size: Override default chunk size
        chunk_overlap: Override default chunk overlap

    Returns:
        List of Chunk objects
    """
    chunker = TextChunker(chunk_size=chunk_size, chunk_overlap=chunk_overlap)
    return chunker.chunk(text, is_markdown=is_markdown)
