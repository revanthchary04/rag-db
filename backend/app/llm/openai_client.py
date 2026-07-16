import asyncio
import json
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any

import httpx
import structlog

from app.core.config import settings
from app.core.tracing import observe_stage, record_stage_latency
from app.llm.base import LLMClient

logger = structlog.get_logger()


@dataclass
class TokenUsage:
    """Token usage information."""

    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0


@dataclass
class EmbeddingResponse:
    """Embedding response with metadata."""

    embedding: list[float]
    token_usage: TokenUsage | None = None


@dataclass
class ChatCompletionResponse:
    """Chat completion response with metadata."""

    content: str
    token_usage: TokenUsage | None = None
    finish_reason: str | None = None


class OpenAIError(Exception):
    """Base exception for OpenAI client errors."""

    pass


class OpenAIRateLimitError(OpenAIError):
    """Rate limit error (429)."""

    pass


class OpenAITransientError(OpenAIError):
    """Transient error (5xx, timeouts)."""

    pass


class OpenAIClient(LLMClient):
    """OpenAI implementation of the provider-neutral ``LLMClient`` seam.

    Adds retry logic, error normalization, tracing spans, and token accounting
    on top of the raw OpenAI HTTP API. Subclassing ``LLMClient`` makes mypy
    verify this stays a valid implementation of the pipeline's interface.
    """

    def __init__(
        self,
        api_key: str | None = None,
        embedding_model: str | None = None,
        chat_model: str | None = None,
        max_retries: int | None = None,
        timeout: int | None = None,
    ):
        """
        Initialize OpenAI client.

        Args:
            api_key: OpenAI API key (defaults to settings.OPENAI_API_KEY)
            embedding_model: Embedding model name (defaults to settings.OPENAI_EMBEDDING_MODEL)
            chat_model: Chat model name (defaults to settings.OPENAI_CHAT_MODEL)
            max_retries: Maximum retry attempts (defaults to settings.OPENAI_MAX_RETRIES)
            timeout: Request timeout in seconds (defaults to settings.OPENAI_TIMEOUT)
        """
        # Strip ALL whitespace (incl. embedded newlines / carriage returns). A
        # stray line break from a copy-pasted key or secret makes an illegal HTTP
        # header value ("Illegal header value"); keys never contain whitespace.
        self.api_key = "".join((api_key or settings.OPENAI_API_KEY or "").split())
        self.embedding_model = embedding_model or settings.OPENAI_EMBEDDING_MODEL
        self.chat_model = chat_model or settings.OPENAI_CHAT_MODEL
        self.max_retries = max_retries or settings.OPENAI_MAX_RETRIES
        self.timeout = timeout or settings.OPENAI_TIMEOUT

        if not self.api_key:
            raise ValueError("OpenAI API key is required")

        self.base_url = "https://api.openai.com/v1"
        self.headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        # Request throttling disabled - single queries only make 2 API calls
        # (1 embedding + 1 chat completion), which shouldn't hit rate limits
        # If rate limits are hit, it's likely due to multiple concurrent requests
        # or a very low account tier limit

    async def _request_with_retry(
        self,
        method: str,
        url: str,
        json_data: dict[str, Any],
        operation: str,
    ) -> dict[str, Any]:
        """
        Make HTTP request with exponential backoff retry and throttling.

        Args:
            method: HTTP method
            url: Request URL
            json_data: Request JSON data
            operation: Operation name for logging

        Returns:
            Response JSON data

        Raises:
            OpenAIRateLimitError: On 429 rate limit errors
            OpenAITransientError: On 5xx or timeout errors
            OpenAIError: On other errors
        """
        last_exception: Exception | None = None

        for attempt in range(self.max_retries + 1):
            try:
                # Use timeout from settings with explicit timeout object
                timeout_config = httpx.Timeout(
                    self.timeout, connect=10.0, read=self.timeout, write=10.0
                )
                async with httpx.AsyncClient(timeout=timeout_config) as client:
                    response = await client.request(
                        method=method,
                        url=url,
                        headers=self.headers,
                        json=json_data,
                    )

                    # Success
                    if response.status_code == 200:
                        return response.json()

                    # Rate limit (429) - handle carefully
                    if response.status_code == 429:
                        retry_after = self._get_retry_after(response)

                        # For rate limits, respect the Retry-After header if provided
                        # If not provided, use shorter wait times based on operation type
                        if retry_after:
                            wait_time = retry_after
                        else:
                            # For embeddings, use shorter wait (embeddings have higher rate limits)
                            # For chat completions, use longer wait
                            if "embedding" in operation.lower():
                                wait_time = 5  # 5 seconds for embeddings
                            else:
                                wait_time = 10  # 10 seconds for chat completions

                        # Only retry once for rate limits
                        if attempt == 0:
                            logger.warning(
                                "Rate limit hit, waiting before retry",
                                operation=operation,
                                wait_time=wait_time,
                                retry_after_header=retry_after,
                            )
                            await asyncio.sleep(wait_time)
                            continue
                        else:
                            # Already retried once, fail fast with clear message
                            raise OpenAIRateLimitError(
                                "Rate limit exceeded after retry. Please wait a moment before trying again. "
                                "If this persists, you may need to upgrade your OpenAI account tier."
                            )

                    # Server errors (5xx) - retry with backoff
                    if 500 <= response.status_code < 600:
                        wait_time = 2**attempt

                        if attempt < self.max_retries:
                            logger.warning(
                                "Server error, retrying",
                                operation=operation,
                                attempt=attempt + 1,
                                status_code=response.status_code,
                                wait_time=wait_time,
                            )
                            await asyncio.sleep(wait_time)
                            continue
                        else:
                            raise OpenAITransientError(
                                f"Server error {response.status_code} after {self.max_retries} retries"
                            )

                    # Client errors (4xx except 429) - don't retry
                    error_data = response.json() if response.content else {}
                    error_message = error_data.get("error", {}).get(
                        "message", f"HTTP {response.status_code}"
                    )
                    raise OpenAIError(f"{operation} failed: {error_message}")

            except httpx.TimeoutException as e:
                wait_time = 2**attempt

                if attempt < self.max_retries:
                    logger.warning(
                        "Request timeout, retrying",
                        operation=operation,
                        attempt=attempt + 1,
                        wait_time=wait_time,
                    )
                    await asyncio.sleep(wait_time)
                    last_exception = e
                    continue
                else:
                    raise OpenAITransientError(
                        f"Request timeout after {self.max_retries} retries"
                    ) from e

            except httpx.RequestError as e:
                # Network errors - retry with backoff
                wait_time = 2**attempt

                if attempt < self.max_retries:
                    logger.warning(
                        "Network error, retrying",
                        operation=operation,
                        attempt=attempt + 1,
                        wait_time=wait_time,
                        error=str(e),
                    )
                    await asyncio.sleep(wait_time)
                    last_exception = e
                    continue
                else:
                    raise OpenAITransientError(
                        f"Network error after {self.max_retries} retries: {str(e)}"
                    ) from e

        # If we exhausted retries, raise the last exception
        if last_exception:
            raise OpenAITransientError(
                f"Request failed after {self.max_retries} retries"
            ) from last_exception

        raise OpenAIError("Unexpected error in retry logic")

    def _get_retry_after(self, response: httpx.Response) -> float | None:
        """Extract Retry-After header value."""
        retry_after = response.headers.get("Retry-After")
        if retry_after:
            try:
                return float(retry_after)
            except ValueError:
                pass
        return None

    def _parse_token_usage(self, usage_data: dict[str, Any] | None) -> TokenUsage | None:
        """Parse token usage from API response."""
        if not usage_data:
            return None

        return TokenUsage(
            prompt_tokens=usage_data.get("prompt_tokens", 0),
            completion_tokens=usage_data.get("completion_tokens", 0),
            total_tokens=usage_data.get("total_tokens", 0),
        )

    async def create_embedding(self, text: str, model: str | None = None) -> EmbeddingResponse:
        """
        Create embedding for a single text.

        Args:
            text: Text to embed
            model: Model name (defaults to configured embedding model)

        Returns:
            EmbeddingResponse with embedding and token usage
        """
        responses = await self.create_embeddings([text], model=model)
        if not responses:
            raise OpenAIError("No embedding response received")
        return responses[0]

    async def create_embeddings(
        self, texts: list[str], model: str | None = None
    ) -> list[EmbeddingResponse]:
        """
        Create embeddings for multiple texts (batch).

        Args:
            texts: List of texts to embed
            model: Model name (defaults to configured embedding model)

        Returns:
            List of EmbeddingResponse objects
        """
        if not texts:
            return []

        model_name = model or self.embedding_model
        url = f"{self.base_url}/embeddings"

        # OpenAI supports up to 2048 inputs per request
        # We'll batch them if needed
        batch_size = 2048
        all_responses = []

        for i in range(0, len(texts), batch_size):
            batch = texts[i : i + batch_size]

            json_data = {
                "model": model_name,
                "input": batch,
            }

            with observe_stage(
                "embedding",
                span_name="openai.embedding",
                **{
                    "gen_ai.system": "openai",
                    "gen_ai.request.model": model_name,
                    "gen_ai.embedding.batch_size": len(batch),
                },
            ) as emb_span:
                response_data = await self._request_with_retry(
                    method="POST",
                    url=url,
                    json_data=json_data,
                    operation="create_embeddings",
                )
                usage_preview = response_data.get("usage") or {}
                emb_span.set("gen_ai.usage.total_tokens", usage_preview.get("total_tokens"))

            # Parse response
            embeddings_data = response_data.get("data", [])
            usage_data = response_data.get("usage")

            token_usage = self._parse_token_usage(usage_data)

            # Create responses for each embedding
            batch_responses = []
            for emb_data in embeddings_data:
                batch_responses.append(
                    EmbeddingResponse(
                        embedding=emb_data.get("embedding", []),
                        token_usage=token_usage,  # Shared token usage for batch
                    )
                )

            all_responses.extend(batch_responses)

            # Record token usage metrics
            if token_usage:
                try:
                    from app.core.metrics import get_metrics

                    metrics = get_metrics()
                    metrics.record_embedding_tokens(
                        prompt_tokens=token_usage.prompt_tokens,
                        total_tokens=token_usage.total_tokens,
                    )
                except Exception:
                    # Don't fail if metrics recording fails
                    pass

        return all_responses

    async def create_chat_completion(
        self,
        messages: list[dict[str, str]],
        model: str | None = None,
        temperature: float = 0.7,
        max_tokens: int | None = None,
    ) -> ChatCompletionResponse:
        """
        Create chat completion.

        Args:
            messages: List of message dicts with 'role' and 'content'
            model: Model name (defaults to configured chat model)
            temperature: Sampling temperature (0-2)
            max_tokens: Maximum tokens to generate

        Returns:
            ChatCompletionResponse with content and token usage
        """
        model_name = model or self.chat_model
        url = f"{self.base_url}/chat/completions"

        json_data = {
            "model": model_name,
            "messages": messages,
            "temperature": temperature,
        }

        if max_tokens:
            json_data["max_tokens"] = max_tokens

        with observe_stage(
            "chat_completion",
            span_name="openai.chat",
            **{
                "gen_ai.system": "openai",
                "gen_ai.request.model": model_name,
                "gen_ai.request.temperature": temperature,
            },
        ) as chat_span:
            response_data = await self._request_with_retry(
                method="POST",
                url=url,
                json_data=json_data,
                operation="create_chat_completion",
            )

            # Parse response
            choices = response_data.get("choices", [])
            if not choices:
                raise OpenAIError("No choices in chat completion response")

            choice = choices[0]
            message = choice.get("message", {})
            usage_data = response_data.get("usage")

            token_usage = self._parse_token_usage(usage_data)
            chat_span.set("gen_ai.response.finish_reason", choice.get("finish_reason"))
            if token_usage:
                chat_span.set("gen_ai.usage.prompt_tokens", token_usage.prompt_tokens)
                chat_span.set("gen_ai.usage.completion_tokens", token_usage.completion_tokens)
                chat_span.set("gen_ai.usage.total_tokens", token_usage.total_tokens)

        # Record token usage metrics
        if token_usage:
            try:
                from app.core.metrics import get_metrics

                metrics = get_metrics()
                metrics.record_chat_tokens(
                    prompt_tokens=token_usage.prompt_tokens,
                    completion_tokens=token_usage.completion_tokens,
                    total_tokens=token_usage.total_tokens,
                )
            except Exception:
                # Don't fail if metrics recording fails
                pass

        return ChatCompletionResponse(
            content=message.get("content", ""),
            token_usage=token_usage,
            finish_reason=choice.get("finish_reason"),
        )

    async def stream_chat_completion(
        self,
        messages: list[dict[str, str]],
        model: str | None = None,
        temperature: float = 0.7,
        max_tokens: int | None = None,
    ) -> AsyncIterator[str | TokenUsage]:
        """
        Stream chat completion (SSE from OpenAI).

        Yields text fragments (str) and optionally a final TokenUsage when the
        stream includes usage (stream_options.include_usage). Records chat token
        metrics when usage is present.
        """
        model_name = model or self.chat_model
        url = f"{self.base_url}/chat/completions"

        json_data: dict[str, Any] = {
            "model": model_name,
            "messages": messages,
            "temperature": temperature,
            "stream": True,
            "stream_options": {"include_usage": True},
        }
        if max_tokens:
            json_data["max_tokens"] = max_tokens

        read_timeout = max(float(self.timeout), 120.0)
        timeout = httpx.Timeout(self.timeout, read=read_timeout)

        # NOTE: no long-lived span here — spanning an async generator across
        # ``yield`` boundaries can detach the OTel context on partial consumption
        # (client disconnect). We record stage latency manually instead; the
        # server span from FastAPIInstrumentor still covers the stream.
        stream_start = time.perf_counter()
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                async with client.stream(
                    "POST",
                    url,
                    headers=self.headers,
                    json=json_data,
                ) as response:
                    if response.status_code == 429:
                        body = (await response.aread()).decode("utf-8", errors="replace")
                        raise OpenAIRateLimitError(f"Rate limited: {body}")
                    if response.status_code >= 400:
                        body = (await response.aread()).decode("utf-8", errors="replace")
                        if 500 <= response.status_code < 600:
                            raise OpenAITransientError(
                                f"OpenAI error {response.status_code}: {body}"
                            )
                        raise OpenAIError(f"OpenAI error {response.status_code}: {body}")

                    async for line in response.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        data = line[len("data:") :].strip()
                        if data == "[DONE]":
                            break
                        try:
                            chunk = json.loads(data)
                        except json.JSONDecodeError:
                            continue

                        for choice in chunk.get("choices") or []:
                            delta = choice.get("delta") or {}
                            content = delta.get("content")
                            if content:
                                yield content

                        usage_data = chunk.get("usage")
                        if usage_data:
                            token_usage = self._parse_token_usage(usage_data)
                            if token_usage:
                                try:
                                    from app.core.metrics import get_metrics

                                    metrics = get_metrics()
                                    metrics.record_chat_tokens(
                                        prompt_tokens=token_usage.prompt_tokens,
                                        completion_tokens=token_usage.completion_tokens,
                                        total_tokens=token_usage.total_tokens,
                                    )
                                except Exception:
                                    pass
                                yield token_usage
        finally:
            record_stage_latency(
                "chat_completion_stream", (time.perf_counter() - stream_start) * 1000.0
            )


# Global client instance (can be overridden for testing)
_client: OpenAIClient | None = None


def get_llm_client() -> LLMClient:
    """Get the process-wide LLM client (the provider-neutral seam).

    Prefer this in pipeline code. To support another provider, branch here on a
    settings value and return an alternative ``LLMClient`` implementation — no
    call site changes required. See ``app/llm/base.py``.
    """
    return get_openai_client()


def get_openai_client() -> OpenAIClient:
    """Get or create the global OpenAI client instance."""
    global _client
    if _client is None:
        _client = OpenAIClient()
    return _client


def set_openai_client(client: LLMClient | None) -> None:
    """Override the global LLM client (used by tests and benchmarks)."""
    global _client
    _client = client  # type: ignore[assignment]
