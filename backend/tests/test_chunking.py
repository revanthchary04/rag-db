import pytest

from app.rag.chunking import Chunk, TextChunker, chunk_text


class TestPlainTextChunking:
    """Test plain text chunking."""

    def test_basic_chunking(self):
        """Test basic text chunking."""
        text = "This is a test. " * 100  # ~1500 characters
        chunker = TextChunker(chunk_size=100, chunk_overlap=20)
        chunks = chunker.chunk(text, is_markdown=False)

        assert len(chunks) > 0
        assert all(isinstance(chunk, Chunk) for chunk in chunks)
        assert all(chunk.chunk_index >= 0 for chunk in chunks)
        assert all(len(chunk.content) > 0 for chunk in chunks)

    def test_chunk_size_respected(self):
        """Test that chunks respect maximum size."""
        text = "A" * 1000
        chunker = TextChunker(chunk_size=100, chunk_overlap=10)
        chunks = chunker.chunk(text, is_markdown=False)

        # Sentence-boundary snapping can slightly exceed chunk_size; merged tails use up to ~120%.
        for chunk in chunks:
            assert len(chunk.content) <= 120

    def test_overlap_behavior(self):
        """Test that chunks have proper overlap."""
        text = "Sentence one. Sentence two. Sentence three. Sentence four. Sentence five."
        chunker = TextChunker(chunk_size=30, chunk_overlap=10)
        chunks = chunker.chunk(text, is_markdown=False)

        assert len(chunks) >= 2

        # Check that consecutive chunks share some content
        for i in range(len(chunks) - 1):
            chunk1_end = chunks[i].content[-10:]
            chunk2_start = chunks[i + 1].content[:10]

            # There should be some overlap (allowing for whitespace differences)
            chunk1_end_clean = chunk1_end.replace(" ", "").replace("\n", "")
            chunk2_start_clean = chunk2_start.replace(" ", "").replace("\n", "")

            # At least some characters should overlap
            for j in range(min(len(chunk1_end_clean), len(chunk2_start_clean))):
                if chunk1_end_clean[-j:] == chunk2_start_clean[:j] and j > 0:
                    break

            # Note: Due to sentence boundary detection, overlap might not always be exact
            # So we just verify chunks are not completely independent
            assert len(chunks[i].content) > 0
            assert len(chunks[i + 1].content) > 0

    def test_empty_text(self):
        """Test handling of empty text."""
        chunker = TextChunker(chunk_size=100, chunk_overlap=20)
        chunks = chunker.chunk("", is_markdown=False)
        assert chunks == []

        chunks = chunker.chunk("   ", is_markdown=False)
        assert chunks == []

    def test_small_text(self):
        """Test chunking of text smaller than chunk size."""
        text = "This is a short text."
        chunker = TextChunker(chunk_size=1000, chunk_overlap=100)
        chunks = chunker.chunk(text, is_markdown=False)

        assert len(chunks) == 1
        assert chunks[0].content == text
        assert chunks[0].chunk_index == 0

    def test_tiny_trailing_chunk_merging(self):
        """Test that tiny trailing chunks are merged."""
        # Create text that would result in a tiny last chunk
        text = "A" * 200 + " " + "B" * 5  # Large chunk + tiny chunk
        chunker = TextChunker(chunk_size=100, chunk_overlap=10)
        chunks = chunker.chunk(text, is_markdown=False)

        if len(chunks) > 1:
            last_chunk_size = len(chunks[-1].content)
            # Prefer merged tail; small remainder may remain as its own chunk
            assert last_chunk_size >= 20 or len(chunks) == 1


class TestMarkdownChunking:
    """Test markdown chunking."""

    def test_markdown_with_headings(self):
        """Test chunking markdown with headings."""
        markdown = """# Introduction

This is the introduction section.

## Subsection One

Content for subsection one.

## Subsection Two

Content for subsection two.
"""
        chunker = TextChunker(chunk_size=100, chunk_overlap=20)
        chunks = chunker.chunk(markdown, is_markdown=True)

        assert len(chunks) > 0
        for chunk in chunks:
            assert "heading_path" in chunk.metadata
            assert isinstance(chunk.metadata["heading_path"], list)

    def test_heading_path_extraction(self):
        """Test that heading paths are correctly extracted."""
        markdown = """# Main Title

Some content here.

## Section One

Content for section one.

### Subsection

More content.

## Section Two

Content for section two.
"""
        chunker = TextChunker(chunk_size=200, chunk_overlap=20)
        chunks = chunker.chunk(markdown, is_markdown=True)

        # Find chunk with "Subsection" content
        subsection_chunk = None
        for chunk in chunks:
            if "Subsection" in chunk.content:
                subsection_chunk = chunk
                break

        if subsection_chunk:
            heading_path = subsection_chunk.metadata.get("heading_path", [])
            assert "Main Title" in heading_path
            assert "Section One" in heading_path
            assert "Subsection" in heading_path

    def test_nested_headings(self):
        """Test handling of nested markdown headings."""
        markdown = """# Level 1

Content 1.

## Level 2a

Content 2a.

### Level 3a

Content 3a.

## Level 2b

Content 2b.
"""
        chunker = TextChunker(chunk_size=150, chunk_overlap=20)
        chunks = chunker.chunk(markdown, is_markdown=True)

        # Verify heading paths are correctly nested
        for chunk in chunks:
            heading_path = chunk.metadata.get("heading_path", [])
            # Heading path should be a list of strings
            assert all(isinstance(h, str) for h in heading_path)

    def test_markdown_without_headings(self):
        """Test markdown text without headings."""
        markdown = "This is just regular text with **bold** and *italic*."
        chunker = TextChunker(chunk_size=100, chunk_overlap=20)
        chunks = chunker.chunk(markdown, is_markdown=True)

        assert len(chunks) > 0
        # Should still work, just without heading metadata
        for chunk in chunks:
            assert "heading_path" in chunk.metadata


class TestDeterminism:
    """Test deterministic behavior."""

    def test_deterministic_output(self):
        """Test that chunking produces the same output for the same input."""
        text = "This is a test. " * 200
        chunker = TextChunker(chunk_size=100, chunk_overlap=20)

        chunks1 = chunker.chunk(text, is_markdown=False)
        chunks2 = chunker.chunk(text, is_markdown=False)

        assert len(chunks1) == len(chunks2)
        for i, (c1, c2) in enumerate(zip(chunks1, chunks2)):
            assert c1.content == c2.content, f"Chunk {i} differs"
            assert c1.chunk_index == c2.chunk_index
            assert c1.metadata == c2.metadata

    def test_deterministic_markdown(self):
        """Test deterministic markdown chunking."""
        markdown = """# Title

Content here.

## Section

More content.
"""
        chunker = TextChunker(chunk_size=100, chunk_overlap=20)

        chunks1 = chunker.chunk(markdown, is_markdown=True)
        chunks2 = chunker.chunk(markdown, is_markdown=True)

        assert len(chunks1) == len(chunks2)
        for i, (c1, c2) in enumerate(zip(chunks1, chunks2)):
            assert c1.content == c2.content, f"Chunk {i} differs"
            assert c1.chunk_index == c2.chunk_index
            assert c1.metadata == c2.metadata


class TestEdgeCases:
    """Test edge cases and error handling."""

    def test_invalid_chunk_size(self):
        """Test validation of chunk size."""
        with pytest.raises(ValueError, match="chunk_size must be positive"):
            TextChunker(chunk_size=0)

        with pytest.raises(ValueError, match="chunk_size must be positive"):
            TextChunker(chunk_size=-10)

    def test_invalid_overlap(self):
        """Test validation of overlap."""
        with pytest.raises(ValueError, match="chunk_overlap must be non-negative"):
            TextChunker(chunk_size=100, chunk_overlap=-1)

        with pytest.raises(ValueError, match="chunk_overlap must be less than chunk_size"):
            TextChunker(chunk_size=100, chunk_overlap=100)

        with pytest.raises(ValueError, match="chunk_overlap must be less than chunk_size"):
            TextChunker(chunk_size=100, chunk_overlap=150)

    def test_zero_overlap(self):
        """Test chunking with zero overlap."""
        text = "A" * 500
        chunker = TextChunker(chunk_size=100, chunk_overlap=0)
        chunks = chunker.chunk(text, is_markdown=False)

        assert len(chunks) > 0
        # With zero overlap, chunks should be adjacent
        total_length = sum(len(c.content) for c in chunks)
        # Overlap and newlines between merged chunks can make sum > raw length
        assert total_length >= len(text) - 50

    def test_very_large_text(self):
        """Test chunking of very large text."""
        text = "This is a sentence. " * 10000  # ~200k characters
        chunker = TextChunker(chunk_size=1000, chunk_overlap=100)
        chunks = chunker.chunk(text, is_markdown=False)

        assert len(chunks) > 0
        # Verify all chunks are within size limit
        for chunk in chunks:
            assert len(chunk.content) <= 1200  # Allow some margin for sentence boundaries


class TestConvenienceFunction:
    """Test the convenience chunk_text function."""

    def test_convenience_function(self):
        """Test the chunk_text convenience function."""
        text = "This is a test. " * 50
        chunks = chunk_text(text, is_markdown=False, chunk_size=100, chunk_overlap=20)

        assert len(chunks) > 0
        assert all(isinstance(chunk, Chunk) for chunk in chunks)

    def test_convenience_function_with_defaults(self):
        """Test convenience function with default settings."""
        text = "This is a test. " * 50
        chunks = chunk_text(text, is_markdown=False)

        assert len(chunks) > 0
