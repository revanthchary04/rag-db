# RAG Eval Backend

FastAPI backend for RAG evaluation and observability.

## Local Setup

### Prerequisites

- Python 3.11+
- [uv](https://github.com/astral-sh/uv) package manager
- PostgreSQL with pgvector extension (or use Docker Compose)

### Installation

1. Install dependencies:

```bash
uv sync
```

2. Set up environment variables:

```bash
cp .env.example .env
# Edit .env with your configuration
```

3. Start PostgreSQL (using Docker Compose):

```bash
# From project root
docker compose up -d postgres
```

4. Run migrations:

```bash
# From project root, or from backend/ (backend/Makefile mirrors this)
make migrate
```

5. Seed database (optional):

```bash
make seed
```

## Running

### Development Server

```bash
make api-dev
# or
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Production Server

```bash
make api
# or
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### Using Docker Compose

```bash
# From project root
docker compose up -d
```

This starts both PostgreSQL and the API service.

## Environment Variables

Required environment variables (see `.env.example`):

```bash
# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ragdb

# OpenAI
OPENAI_API_KEY=your-api-key-here
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
OPENAI_CHAT_MODEL=gpt-4o-mini
EMBEDDING_DIMENSION=1536

# Optional: OpenAI API settings
OPENAI_MAX_RETRIES=3
OPENAI_TIMEOUT=60

# Optional: Chunking
CHUNK_SIZE=1000
CHUNK_OVERLAP=200

# Optional: CORS Configuration
# CORS_ALLOW_ORIGINS takes precedence over CORS_ORIGINS (legacy)
# Always includes http://localhost:3000 for local development
# Comma-separated list of allowed origins for browser requests
CORS_ALLOW_ORIGINS=http://localhost:3000,https://your-vercel-domain.vercel.app
# Legacy (fallback if CORS_ALLOW_ORIGINS not set)
CORS_ORIGINS=http://localhost:3000,http://localhost:3001

# Optional: Request limits
MAX_INGEST_PAYLOAD_SIZE=10485760  # 10MB
MAX_QUERY_LENGTH=5000
MAX_CONTEXT_CHARS=50000
MAX_CONTEXT_TOKENS=12000

# Optional: Rate limiting
RATE_LIMIT_REQUESTS=100
RATE_LIMIT_WINDOW=60

# Optional: Environment
ENVIRONMENT=development
DEBUG=false
```

## API Endpoints

### Health Check

```bash
curl http://localhost:8000/api/v1/health
```

**Response:**

```json
{
  "ok": true,
  "db": true,
  "version": "0.1.0"
}
```

### Ingest Document

```bash
curl -X POST http://localhost:8000/api/v1/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "source": "document-source",
    "title": "Document Title",
    "text": "Document content here...",
    "is_markdown": false
  }'
```

**Response:**

```json
{
  "document_id": "source-title",
  "chunks_created": 5
}
```

### Query RAG System

```bash
curl -X POST http://localhost:8000/api/v1/query \
  -H "Content-Type: application/json" \
  -d '{
    "query": "What is RAG?",
    "top_k": 8,
    "filters": {
      "source": "optional-source"
    },
    "debug": false
  }'
```

**Response:**

```json
{
  "answer": "RAG stands for Retrieval-Augmented Generation [1]...",
  "citations": [
    {
      "chunk_id": "chunk-1",
      "document_id": "doc-1",
      "title": "RAG Guide",
      "source": "docs",
      "chunk_index": 0
    }
  ],
  "used_chunk_ids": ["chunk-1"],
  "latency_ms": 1250,
  "token_usage": {
    "prompt_tokens": 500,
    "completion_tokens": 150,
    "total_tokens": 650
  }
}
```

### Search Chunks

```bash
curl -X POST http://localhost:8000/api/v1/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "What is vector similarity?",
    "top_k": 5,
    "document_id": "optional-doc-id"
  }'
```

### List Documents

```bash
curl http://localhost:8000/api/v1/documents?limit=100&offset=0
```

### Get Metrics

```bash
curl http://localhost:8000/api/v1/metrics
```

## Testing

```bash
make api-test
# or
uv run pytest
```

**Note:** OpenAI API calls are mocked, so no network access is needed. Most tests
run against mocks, but the `*_api.py` DB-integration tests need a real Postgres and
a `DATABASE_URL` pointing at it.

That Postgres must be migrated to Alembic head, not just seeded from `docker/init`.
`docker/init/*.sql` alone leaves the schema drifted (e.g. missing the
`chat_messages_query_log_id_fkey` FK from migration 005), and tests that assert on
those constraints will fail. Bring a local DB up to head the same way CI does:

```bash
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ragdb
uv run --extra dev python scripts/apply_init_sql.py
uv run --extra dev alembic upgrade head
uv run --extra dev pytest
```

Both setup steps are idempotent, so re-running them on an existing dev DB is safe.

## CORS Configuration

The API is configured to accept direct browser requests from specified origins. CORS is enabled with the following settings:

### Configuration

- **Allowed Origins**: Configured via `CORS_ALLOW_ORIGINS` environment variable (comma-separated)
  - Always includes `http://localhost:3000` for local development
  - Supports Vercel production domains and other custom origins
- **Allowed Methods**: `GET`, `POST`
- **Allowed Headers**: `Content-Type`, `Authorization`, `X-Request-Id`
- **Exposed Headers**: `X-Request-ID` (for request correlation)

### Request ID Middleware

All requests automatically include an `X-Request-ID` header:

- If the client provides `X-Request-Id`, it is used
- If missing, a UUID is generated automatically
- The request ID is:
  - Added to response headers (`X-Request-ID`)
  - Included in all structured logs
  - Available for request correlation and debugging

### Example Configuration

**Local Development:**

```bash
CORS_ALLOW_ORIGINS=http://localhost:3000
```

**Production (Vercel):**

```bash
CORS_ALLOW_ORIGINS=http://localhost:3000,https://your-app.vercel.app
```

**Multiple Domains:**

```bash
CORS_ALLOW_ORIGINS=http://localhost:3000,https://app.example.com,https://staging.example.com
```

### Testing CORS

You can test CORS configuration using curl:

```bash
# Preflight request
curl -X OPTIONS http://localhost:8000/api/v1/health \
  -H "Origin: http://localhost:3000" \
  -H "Access-Control-Request-Method: GET" \
  -v

# Actual request
curl http://localhost:8000/api/v1/health \
  -H "Origin: http://localhost:3000" \
  -v
```

Check for `Access-Control-Allow-Origin` header in the response.

## Features

- Async/await endpoints for better performance
- Structured logging with request ID correlation
- Error handling middleware
- Database connection pooling
- Health check with DB connectivity
- Vector similarity search using pgvector
- Request timing and metrics collection
- Token usage tracking
- Rate limiting (per-instance, in-memory)
- Context truncation and sanitization
- Payload size limits
- CORS support for direct browser requests

## Metrics

### GET /api/v1/metrics

Returns application metrics in JSON format:

```json
{
  "uptime_seconds": 3600,
  "routes": {
    "/api/v1/query": {
      "request_count": 100,
      "status_counts": { "200": 95, "500": 5 },
      "latency_buckets": {
        "<100ms": 10,
        "100-500ms": 50,
        "500ms-1s": 30,
        "1s-5s": 10,
        ">5s": 0
      },
      "avg_latency_ms": 450.5,
      "total_latency_ms": 45050
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

### Metrics Limitations

**Important:** The metrics system has the following limitations:

1. **In-memory storage**: All metrics are stored in memory and will be lost on application restart
2. **Single instance only**: Metrics are not shared across multiple application instances
3. **No persistence**: Historical metrics are not saved to disk or database
4. **No aggregation**: Each instance maintains its own metrics independently

For production deployments with multiple instances, consider:

- Using a dedicated metrics service (Prometheus, Datadog, etc.)
- Implementing distributed metrics collection
- Persisting metrics to a time-series database

## Deployment

### Container-Based Deployment

The backend includes a `Dockerfile` for containerized deployment.

#### Building the Image

```bash
docker build -f backend/Dockerfile -t rag-api:latest .
```

#### Running with Docker Compose

```bash
docker compose up -d
```

This starts:

- PostgreSQL with pgvector extension
- FastAPI backend service

#### Environment Variables for Production

Set these in your deployment environment:

```bash
DATABASE_URL=postgresql://user:pass@postgres:5432/ragdb
OPENAI_API_KEY=your-production-key
ENVIRONMENT=production
CORS_ALLOW_ORIGINS=https://yourdomain.com,https://your-vercel-app.vercel.app
```

#### Docker Compose Production Override

Create `docker compose.prod.yml`:

```yaml
version: '3.8'

services:
  api:
    environment:
      ENVIRONMENT: production
      CORS_ALLOW_ORIGINS: https://yourdomain.com,https://your-vercel-app.vercel.app
    command: uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
    # Remove --reload in production
```

Run with:

```bash
docker compose -f docker compose.yml -f docker compose.prod.yml up -d
```

#### Health Checks

The API includes health check endpoints:

- `GET /api/v1/health` - Health check with DB connectivity
- `GET /` - Root endpoint

Use these for container health checks and load balancer probes.

#### Rate Limiting Notes

The rate limiter is **per-instance** and **in-memory**. For production with multiple instances:

- Use a shared rate limiter (e.g., Redis-based)
- Or rely on API gateway rate limiting

#### Scaling Considerations

- Database connection pooling is configured
- Each instance maintains its own metrics (not aggregated)
- Rate limiting is per-instance
- Use a shared cache/queue for distributed deployments
