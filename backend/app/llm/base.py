"""Provider-neutral LLM client seam.

The RAG pipeline (retrieval strategies, answer generation, ingestion) never
imports a vendor SDK directly — it talks to whatever satisfies the ``LLMClient``
protocol below. Today the only implementation is ``OpenAIClient``, but the seam
is the point: this repo is *about* measuring what happens when you change a
model, so swapping the embedding or chat provider must be a one-file change, not
a grep-and-replace across the pipeline.

To add a provider:

1. Implement a class whose methods match ``LLMClient`` (structural typing means
   you don't strictly need to subclass it, but doing so gives you a mypy check).
2. Return it from a settings-driven branch in
   ``app.llm.openai_client.get_llm_client`` (e.g. ``if settings.LLM_PROVIDER ==
   "anthropic": ...``).

The response value types (``EmbeddingResponse``, ``ChatCompletionResponse``,
``TokenUsage``) are deliberately vendor-neutral dataclasses so a new provider
normalizes into the same shapes the rest of the code already consumes.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import TYPE_CHECKING, Protocol, runtime_checkable

if TYPE_CHECKING:
    from app.llm.openai_client import (
        ChatCompletionResponse,
        EmbeddingResponse,
        TokenUsage,
    )


@runtime_checkable
class LLMClient(Protocol):
    """Minimal async interface the RAG pipeline depends on.

    Any provider that implements these four methods is a drop-in. Kept
    intentionally small: embeddings (single + batch) and chat (buffered +
    streaming) are the only LLM capabilities the pipeline uses.
    """

    async def create_embedding(self, text: str, model: str | None = None) -> EmbeddingResponse: ...

    async def create_embeddings(
        self, texts: list[str], model: str | None = None
    ) -> list[EmbeddingResponse]: ...

    async def create_chat_completion(
        self,
        messages: list[dict[str, str]],
        model: str | None = None,
        temperature: float = 0.7,
        max_tokens: int | None = None,
    ) -> ChatCompletionResponse: ...

    def stream_chat_completion(
        self,
        messages: list[dict[str, str]],
        model: str | None = None,
        temperature: float = 0.7,
        max_tokens: int | None = None,
    ) -> AsyncIterator[str | TokenUsage]: ...
