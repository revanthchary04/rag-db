# API Contract

This document describes the API contract between the frontend and the FastAPI backend. All endpoints are prefixed with `/api/v1`.

**Base URL**: `http://localhost:8000/api/v1` (configurable via `NEXT_PUBLIC_API_BASE_URL`)

## Endpoints

### Health Check

**GET** `/health`

Check API and database connectivity.

#### Response

```json
{
  "status": "healthy" | "unhealthy",
  "database": "connected" | "disconnected",
  "version": "0.1.0"
}
```

#### Example

```json
{
  "status": "healthy",
  "database": "connected",
  "version": "0.1.0"
}
```

---

### Ingest Document

**POST** `/ingest`

Ingest a document into the RAG system. The document will be chunked, embedded, and stored in the database.

#### Request Body

```json
{
  "source": "string (required)",
  "title": "string (optional)",
  "text": "string (required, max 10MB)",
  "is_markdown": "boolean (optional, default: false)"
}
```

#### Response

```json
{
  "document_id": "string",
  "chunks_created": "number"
}
```

#### Example Request

```json
{
  "source": "doc-001",
  "title": "Introduction to RAG",
  "text": "# Introduction\n\nRetrieval-Augmented Generation...",
  "is_markdown": true
}
```

#### Example Response

```json
{
  "document_id": "doc-001-v1",
  "chunks_created": 5
}
```

#### Error Responses

- **400 Bad Request**: Source or text is empty

  ```json
  {
    "detail": "Source cannot be empty"
  }
  ```

- **413 Payload Too Large**: Text exceeds maximum size (10MB)

  ```json
  {
    "detail": "Payload size (10485761 chars) exceeds maximum (10485760 chars)"
  }
  ```

- **500 Internal Server Error**: Ingestion failed
  ```json
  {
    "detail": "Failed to ingest document: <error message>"
  }
  ```

---

### Query RAG System

**POST** `/query`

Query the RAG system with a natural language question. Returns an answer with citations.

#### Request Body

```json
{
  "query": "string (required, max 5000 chars)",
  "top_k": "number (optional, default: 8, min: 1, max: 100)",
  "filters": {
    "source": "string (optional)",
    "title": "string (optional)"
  },
  "debug": "boolean (optional, default: false)"
}
```

#### Response

```json
{
  "answer": "string",
  "citations": [
    {
      "chunk_id": "string",
      "document_id": "string",
      "title": "string | null",
      "source": "string",
      "chunk_index": "number"
    }
  ],
  "used_chunk_ids": ["string"],
  "latency_ms": "number",
  "token_usage": {
    "prompt_tokens": "number",
    "completion_tokens": "number",
    "total_tokens": "number"
  },
  "debug": {
    "retrieved_chunks": [
      {
        "chunk_id": "string",
        "document_id": "string",
        "title": "string | null",
        "source": "string",
        "chunk_index": "number",
        "content_snippet": "string (first 200 chars)",
        "score": "number"
      }
    ],
    "retrieved_count": "number"
  }
}
```

**Note**: The `debug` field is only included when `debug: true` in the request.

#### Example Request

```json
{
  "query": "What is RAG?",
  "top_k": 5,
  "filters": {
    "source": "sample-docs"
  },
  "debug": true
}
```

#### Example Response

```json
{
  "answer": "RAG (Retrieval-Augmented Generation) is a technique that enhances LLMs by providing access to external knowledge sources. [1]",
  "citations": [
    {
      "chunk_id": "doc-001-0",
      "document_id": "doc-001",
      "title": "Introduction to RAG",
      "source": "sample-docs",
      "chunk_index": 0
    }
  ],
  "used_chunk_ids": ["doc-001-0"],
  "latency_ms": 1234,
  "token_usage": {
    "prompt_tokens": 500,
    "completion_tokens": 150,
    "total_tokens": 650
  },
  "debug": {
    "retrieved_chunks": [
      {
        "chunk_id": "doc-001-0",
        "document_id": "doc-001",
        "title": "Introduction to RAG",
        "source": "sample-docs",
        "chunk_index": 0,
        "content_snippet": "RAG (Retrieval-Augmented Generation) is a technique...",
        "score": 0.9234
      }
    ],
    "retrieved_count": 1
  }
}
```

#### Error Responses

- **400 Bad Request**: Query is empty or too long

  ```json
  {
    "detail": "Query exceeds maximum length of 5000 characters"
  }
  ```

- **500 Internal Server Error**: Retrieval or answer generation failed
  ```json
  {
    "detail": "Retrieval error: <error message>"
  }
  ```
  or
  ```json
  {
    "detail": "Answer generation error: <error message>"
  }
  ```

---

### Get Metrics

**GET** `/metrics`

Get application metrics including request counts, latency, and token usage.

#### Response

```json
{
  "uptime_seconds": "number",
  "routes": {
    "/api/v1/query": {
      "request_count": "number",
      "status_counts": {
        "200": "number",
        "400": "number",
        "500": "number"
      },
      "latency_buckets": {
        "<100ms": "number",
        "100-500ms": "number",
        "500ms-1s": "number",
        "1s-5s": "number",
        ">5s": "number"
      },
      "avg_latency_ms": "number",
      "total_latency_ms": "number",
      "percentiles": {
        "p50_ms": "number",
        "p95_ms": "number",
        "p99_ms": "number"
      }
    }
  },
  "stages": {
    "retrieve": {
      "count": "number",
      "avg_latency_ms": "number",
      "percentiles": { "p50_ms": "number", "p95_ms": "number", "p99_ms": "number" }
    },
    "embedding": { "...": "same shape" },
    "chat_completion": { "...": "same shape" }
  },
  "token_usage": {
    "embedding_prompt_tokens": "number",
    "embedding_total_tokens": "number",
    "chat_prompt_tokens": "number",
    "chat_completion_tokens": "number",
    "chat_total_tokens": "number"
  },
  "note": "string"
}
```

**Latency percentiles** (`percentiles`, `stages[*].percentiles`) are estimated
in-process from a fixed-bucket histogram using the same linear interpolation as
Prometheus `histogram_quantile`, so the JSON numbers agree with what Grafana
computes from the scraped series.

**`stages`** reports per-stage latency for the RAG pipeline (`retrieve`,
`embedding`, `db.vector_search`, `chat_completion`, `chat_completion_stream`),
populated from the OpenTelemetry-instrumented spans. It is empty until the first
query runs.

### Get Prometheus Metrics

**GET** `/metrics/prometheus`

Same in-memory counters in Prometheus text exposition format. Emits real
histogram series — `http_request_latency_ms_bucket{route,le}` /
`_sum` / `_count` and `rag_stage_latency_ms_bucket{stage,le}` — so
`histogram_quantile(0.95, ...)` works directly in Grafana. When
`OTEL_ENABLED=true` (`uv sync --extra otel`), the pipeline also exports a
distributed trace per request (server span → `rag.retrieve` →
`openai.embedding` / `db.vector_search` → `rag.generate` → `openai.chat`) to the
configured OTLP endpoint.

#### Example Response

```json
{
  "uptime_seconds": 3600,
  "routes": {
    "/api/v1/query": {
      "request_count": 42,
      "status_counts": {
        "200": 40,
        "400": 1,
        "500": 1
      },
      "latency_buckets": {
        "<100ms": 0,
        "100-500ms": 5,
        "500ms-1s": 30,
        "1s-5s": 5,
        ">5s": 0
      },
      "avg_latency_ms": 850.5,
      "total_latency_ms": 35721
    },
    "/api/v1/ingest": {
      "request_count": 10,
      "status_counts": {
        "200": 10
      },
      "latency_buckets": {
        "<100ms": 0,
        "100-500ms": 0,
        "500ms-1s": 2,
        "1s-5s": 8,
        ">5s": 0
      },
      "avg_latency_ms": 2500.0,
      "total_latency_ms": 25000
    }
  },
  "token_usage": {
    "embedding_prompt_tokens": 5000,
    "embedding_total_tokens": 5000,
    "chat_prompt_tokens": 10000,
    "chat_completion_tokens": 2000,
    "chat_total_tokens": 12000
  },
  "note": "Metrics are in-memory and reset on restart. Single instance only."
}
```

#### Error Responses

- **500 Internal Server Error**: Failed to retrieve metrics
  ```json
  {
    "detail": "Failed to retrieve metrics"
  }
  ```

---

## Error Format

FastAPI uses different error formats depending on the error type:

### Standard HTTPException (4xx/5xx)

Most endpoints use FastAPI's `HTTPException`, which returns:

```json
{
  "detail": "Error message here"
}
```

**Status Codes:**

- `400`: Bad Request (validation errors, empty fields)
- `413`: Payload Too Large (document exceeds size limit)
- `429`: Too Many Requests (rate limit exceeded)
- `500`: Internal Server Error (server-side errors)
- `503`: Service Unavailable (external service errors, e.g., OpenAI API)

### Rate Limit Error

When rate limit is exceeded:

```json
{
  "error": "Rate limit exceeded",
  "message": "Too many requests. Limit: 100 per 60s"
}
```

**Headers:**

- `Retry-After`: Number of seconds to wait before retrying
- `X-RateLimit-Remaining`: Number of requests remaining
- `X-RateLimit-Limit`: Maximum number of requests per window

### Global Exception Handler

For unhandled exceptions:

```json
{
  "error": "Internal server error",
  "request_id": "uuid-string"
}
```

### Request ID

All responses include an `X-Request-ID` header with a unique request identifier. If not provided in the request, one is generated automatically.

---

## Additional Endpoints

The following endpoints are available but not currently used by the frontend:

### Search Chunks

**POST** `/search`

Search for similar chunks using vector similarity.

#### Request Body

```json
{
  "query": "string",
  "top_k": "number (default: 5, min: 1, max: 100)",
  "document_id": "string (optional)"
}
```

#### Response

```json
{
  "query": "string",
  "chunks": [
    {
      "id": "string",
      "document_id": "string",
      "chunk_index": "number",
      "content": "string",
      "metadata": {},
      "similarity": "number",
      "created_at": "string (optional)"
    }
  ],
  "total": "number"
}
```

### List Documents

**GET** `/documents?limit=100&offset=0`

List documents with pagination.

#### Query Parameters

- `limit`: Number of documents to return (default: 100, min: 1, max: 1000)
- `offset`: Number of documents to skip (default: 0, min: 0)

#### Response

```json
{
  "documents": [
    {
      "id": "string",
      "source": "string",
      "title": "string | null",
      "created_at": "string | null"
    }
  ],
  "total": "number",
  "limit": "number",
  "offset": "number"
}
```

### Get Document

**GET** `/documents/{document_id}`

Get a document by ID.

#### Response

```json
{
  "id": "string",
  "source": "string",
  "title": "string | null",
  "created_at": "string | null"
}
```

### Get Document Chunks

**GET** `/documents/{document_id}/chunks`

Get all chunks for a document.

#### Response

```json
[
  {
    "id": "string",
    "document_id": "string",
    "chunk_index": "number",
    "content": "string",
    "metadata": {},
    "created_at": "string | null"
  }
]
```

---

## Request/Response Headers

### Request Headers

- `Content-Type`: `application/json` (required for POST requests)
- `X-Request-ID`: Optional request ID for correlation

### Response Headers

- `X-Request-ID`: Request ID for correlation
- `X-RateLimit-Remaining`: Number of requests remaining (rate-limited endpoints)
- `X-RateLimit-Limit`: Maximum number of requests per window (rate-limited endpoints)
- `Retry-After`: Seconds to wait before retrying (429 responses)

---

## Constraints and Limits

- **Max Ingest Payload Size**: 10MB (10,485,760 characters)
- **Max Query Length**: 5,000 characters
- **Max Top K**: 100 chunks
- **Min Top K**: 1 chunk
- **Rate Limit**: 100 requests per 60 seconds per IP (configurable)
- **Request Timeout**: 60 seconds (configurable)

---

## Notes

- All timestamps are in ISO 8601 format
- All numeric IDs are strings
- The `score` field in debug chunks represents cosine similarity (higher is better)
- Metrics are in-memory and reset on application restart
- Rate limiting is per-instance (not distributed)

---

**Last Updated**: 2024-12-08  
**API Version**: 0.1.0
