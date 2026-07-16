from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class HealthResponse(BaseModel):
    """Health check response."""

    ok: bool
    db: bool
    version: str = "0.1.0"


class ChunkResponse(BaseModel):
    """Chunk response model."""

    id: str
    document_id: str
    chunk_index: int
    content: str
    metadata: dict[str, Any] = Field(default_factory=dict)
    similarity: float | None = None
    created_at: str | None = None


class DocumentResponse(BaseModel):
    """Document response model."""

    id: str
    source: str
    title: str | None = None
    created_at: str | None = None
    original_available: bool = False


class DocumentListResponse(BaseModel):
    """Document list response with pagination."""

    documents: list[DocumentResponse]
    total: int
    limit: int
    offset: int


class SearchRequest(BaseModel):
    """Search request model."""

    query: str = Field(..., description="Search query text")
    top_k: int = Field(5, ge=1, le=100, description="Number of results to return")
    document_id: str | None = Field(None, description="Filter by document ID")


class SearchResponse(BaseModel):
    """Search response model."""

    query: str
    chunks: list[ChunkResponse]
    total: int


class IngestRequest(BaseModel):
    """Document ingestion request model."""

    source: str = Field(..., description="Document source identifier")
    title: str | None = Field(None, description="Document title")
    text: str = Field(..., description="Document text content")
    is_markdown: bool = Field(False, description="Whether text is markdown")
    original_file_base64: str | None = Field(
        None,
        description="Optional base64-encoded original PDF bytes for preview (must pair with media type)",
    )
    original_media_type: str | None = Field(
        None,
        description="MIME type for original_file_base64 (supported: application/pdf)",
    )

    @model_validator(mode="after")
    def original_pair(self):
        has_b64 = bool(self.original_file_base64)
        has_type = bool(self.original_media_type)
        if has_b64 ^ has_type:
            raise ValueError(
                "original_file_base64 and original_media_type must both be set or both omitted"
            )
        return self


class IngestPreprocessingSummary(BaseModel):
    """Text normalization stats applied before chunking."""

    original_character_count: int
    normalized_character_count: int
    character_delta: int
    steps_applied: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class IngestChunkingSummary(BaseModel):
    """Chunking configuration and resulting shard statistics."""

    chunks_before_merge: int
    chunks_created: int
    undersized_chunk_merges: int
    chunk_target_size: int
    chunk_overlap: int
    adaptive_chunking: bool
    config_chunk_size: int
    config_chunk_overlap: int
    estimated_target_chunks: int
    min_chunk_characters_applied: int
    merged_chunk_soft_cap_chars: int
    chunk_length_min: int
    chunk_length_max: int
    chunk_length_mean: float
    chunk_length_median: float


class IngestResponse(BaseModel):
    """Document ingestion response model."""

    document_id: str
    chunks_created: int
    replaced_existing: bool = False
    preprocessing: IngestPreprocessingSummary
    chunking: IngestChunkingSummary


class QueryRequest(BaseModel):
    """Query request model."""

    model_config = ConfigDict(populate_by_name=True)

    query: str = Field(..., description="Query text")
    top_k: int = Field(8, ge=1, le=100, description="Number of chunks to retrieve", alias="topK")
    filters: dict[str, Any] | None = Field(None, description="Optional filters (source, title)")
    debug: bool = Field(False, description="Include debug information in response")
    rag_model: str = Field(
        "vector-similarity",
        description="RAG model to use: vector-similarity, hybrid-search, reranking, multi-query",
    )


class CitationResponse(BaseModel):
    """Citation response model."""

    chunk_id: str
    document_id: str
    title: str | None
    source: str
    chunk_index: int


class QueryResponse(BaseModel):
    """Query response model."""

    answer: str
    citations: list[CitationResponse]
    used_chunk_ids: list[str]
    latency_ms: int
    token_usage: dict[str, int] | None = None
    debug: dict[str, Any] | None = None
    rag_model: str | None = None
    retrieved_chunk_count: int = 0
    request_id: str | None = None
    """HTTP request correlation id (same as ``X-Request-ID`` response header)."""
    query_log_id: str | None = None
    """Primary key of the matching row in ``queries`` when audit logging succeeds."""


class ChatThreadCreate(BaseModel):
    """Create a persisted chat thread."""

    title: str | None = Field(
        None, description="Optional title (defaults may be derived client-side)"
    )


class ChatThreadUpdate(BaseModel):
    """Partial update for a chat thread."""

    title: str = Field(..., min_length=1, max_length=200, description="New thread title")


class ChatThreadResponse(BaseModel):
    """Chat thread summary."""

    id: str
    title: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    message_count: int = 0


class ChatThreadListResponse(BaseModel):
    threads: list[ChatThreadResponse]


class ChatMessageAppend(BaseModel):
    """Append one message to a thread."""

    role: Literal["user", "assistant", "system"]
    content: str = Field(..., min_length=1)
    citations: list[dict[str, Any]] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    latency_ms: int | None = None
    cost_usd: float | None = None
    rag_model: str | None = None
    request_id: str | None = Field(None, description="Correlates with logs and queries.request_id")
    query_log_id: str | None = Field(
        None, description="FK to queries.id when this turn used /query"
    )
    eval_run_id: str | None = Field(None, description="Opaque batch id from automated eval runs")
    eval_case_id: str | None = Field(None, description="Case key/slug inside eval_run_id")


class ChatMessageResponse(BaseModel):
    """Stored chat message."""

    id: str
    thread_id: str
    role: str
    content: str
    citations: list[dict[str, Any]] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    latency_ms: int | None = None
    cost_usd: float | None = None
    rag_model: str | None = None
    seq: int
    created_at: str | None = None
    request_id: str | None = None
    query_log_id: str | None = None
    eval_run_id: str | None = None
    eval_case_id: str | None = None


class ChatMessagesListResponse(BaseModel):
    messages: list[ChatMessageResponse]


class ChatQueryLinkItem(BaseModel):
    """Join of ``chat_messages`` and ``queries`` on ``query_log_id``."""

    message_id: str
    thread_id: str
    role: str
    query_log_id: str
    message_request_id: str | None = None
    message_created_at: str | None = None
    query_text: str
    query_rag_model: str
    query_request_id: str | None = None
    query_logged_at: str | None = None


class ChatQueryLinksResponse(BaseModel):
    links: list[ChatQueryLinkItem]


class EvalRunSummaryResponse(BaseModel):
    """One persisted eval harness run (list view, no per-case rows)."""

    id: str
    created_at: str
    finished_at: str
    status: str
    dataset_path: str
    use_llm_judge: bool
    total_cases: int
    successful: int
    failed: int
    hit_at_1: float
    hit_at_3: float
    hit_at_5: float
    hit_at_8: float
    mrr: float
    llm_judge_correctness_rate: float | None = None
    llm_judge_faithfulness_rate: float | None = None
    config_json: dict[str, Any] = Field(default_factory=dict)


class EvalCaseResultResponse(BaseModel):
    """Single case outcome from a persisted eval run."""

    id: str
    case_index: int
    case_id: str
    query: str
    expected_sources: list[str] = Field(default_factory=list)
    retrieved_sources: list[str] = Field(default_factory=list)
    answer: str = ""
    hit_at_1: bool
    hit_at_3: bool
    hit_at_5: bool
    hit_at_8: bool
    mrr: float
    llm_judge_correctness: bool | None = None
    llm_judge_faithfulness: bool | None = None
    llm_judge_reasoning: str | None = None
    error: str | None = None
    citations: list[dict[str, Any]] = Field(default_factory=list)


class EvalRunDetailResponse(EvalRunSummaryResponse):
    """Eval run including all case results."""

    error_message: str | None = None
    cases: list[EvalCaseResultResponse] = Field(default_factory=list)


class EvalRunListResponse(BaseModel):
    runs: list[EvalRunSummaryResponse]


class QueryLogDetailResponse(BaseModel):
    """Single audit row from ``queries`` (observability drill-down)."""

    id: str
    query_text: str
    rag_model: str
    top_k: int | None = None
    request_id: str | None = None
    client_ip: str | None = None
    user_agent: str | None = None
    latency_ms: int | None = None
    token_usage: dict[str, Any] | None = None
    cost_usd: float | None = None
    citations_count: int | None = None
    answer_length: int | None = None
    created_at: str | None = None


class QueryLogsListResponse(BaseModel):
    """Paged list of ``queries`` rows for the query-log explorer."""

    logs: list[QueryLogDetailResponse]
