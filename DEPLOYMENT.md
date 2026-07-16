# Production Deployment Guide

This guide covers deploying the RAG Eval Observability system to production.

**Operational add-ons:** after baseline deploy, use **[docs/RUNBOOK.md](./docs/RUNBOOK.md)** (incidents and example SLOs) and **[docs/HARDENING.md](./docs/HARDENING.md)** (`API_KEY`, rate limits, tenancy, and the threat model).

## Overview

The system consists of:

- **Frontend**: Next.js app (deploy to Vercel)
- **Backend**: FastAPI API (deploy via Docker)
- **Database**: PostgreSQL with pgvector (managed service or Docker)

## Prerequisites

1. Docker and Docker Compose installed
2. OpenAI API key
3. PostgreSQL database (with pgvector extension)
4. (Optional) Redis for distributed rate limiting

## Environment Variables

Create a `.env` file based on `.env.example` with production values:

### Required Variables

```bash
# Database
DATABASE_URL=postgresql://user:password@host:5432/ragdb

# OpenAI (required)
OPENAI_API_KEY=your-production-api-key
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
OPENAI_CHAT_MODEL=gpt-4-turbo-preview
EMBEDDING_DIMENSION=1536

# Environment
ENVIRONMENT=production

# CORS (set your production frontend URL)
CORS_ALLOW_ORIGINS=https://yourdomain.com,https://your-vercel-app.vercel.app
```

### Optional Variables

```bash
# Rate limiting
RATE_LIMIT_REQUESTS=100
RATE_LIMIT_WINDOW=60

# Redis (for distributed rate limiting)
REDIS_URL=redis://redis-host:6379/0
REDIS_ENABLED=true
```

## Frontend Deployment (Vercel)

1. **Connect your repository** to Vercel
2. **Set environment variables** in Vercel dashboard:
   - `NEXT_PUBLIC_API_BASE_URL=https://your-api-domain.com`
3. **Deploy** - Vercel will automatically build and deploy

The frontend will use `NEXT_PUBLIC_API_BASE_URL` to connect to your backend API.

## Backend Deployment

### Option 1: Docker Compose (Recommended for single server)

1. **Set environment variables** in `.env` file
2. **Build and start** services:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

This will:

- Start PostgreSQL with pgvector
- Run database migrations automatically (via `docker/init/`)
- Start the FastAPI backend

### Option 2: Docker Image (For container orchestration)

1. **Build the image**:

```bash
docker build -f backend/Dockerfile -t rag-api:latest .
```

2. **Run the container**:

```bash
docker run -d \
  --name rag-api \
  -p 8000:8000 \
  -e DATABASE_URL=postgresql://user:pass@host:5432/ragdb \
  -e OPENAI_API_KEY=your-key \
  -e CORS_ALLOW_ORIGINS=https://yourdomain.com \
  rag-api:latest
```

### Option 3: Cloud Platform (AWS, GCP, Azure)

1. **Build and push** Docker image to container registry
2. **Deploy** to your platform's container service (ECS, Cloud Run, AKS, etc.)
3. **Set environment variables** in platform configuration
4. **Configure** managed PostgreSQL with pgvector
5. **Set up** load balancer/reverse proxy

## Database Setup

### Using Docker Compose

The database schema is automatically initialized via `docker/init/02-create-schema.sql` when the PostgreSQL container starts.

### Using Managed PostgreSQL

1. **Enable pgvector extension**:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

2. **Run schema migration** manually:

```bash
psql $DATABASE_URL < docker/init/02-create-schema.sql
```

Or use the migration script if available.

## Rate Limiting

### In-Memory (Default)

The default rate limiter works per-instance. Each application instance maintains its own rate limit state. This is fine for:

- Single instance deployments
- Low-traffic applications
- Development/testing

### Redis-Based (Distributed)

For production with multiple instances, use Redis-based rate limiting:

1. **Install Redis** (or use managed Redis service)
2. **Install Redis Python package**:

```bash
cd backend
uv sync --extra redis
```

3. **Set environment variables**:

```bash
REDIS_URL=redis://redis-host:6379/0
REDIS_ENABLED=true
```

4. **Add Redis to docker-compose.prod.yml** (if using Docker Compose):

```yaml
services:
  redis:
    image: redis:7-alpine
    ports:
      - '6379:6379'
    restart: unless-stopped

  api:
    depends_on:
      - redis
    environment:
      REDIS_URL: redis://redis:6379/0
      REDIS_ENABLED: true
```

## Health Checks

The API provides health check endpoints:

- `GET /api/v1/health` - Health check with DB connectivity
- `GET /` - Root endpoint

Use these for:

- Container health checks
- Load balancer probes
- Monitoring systems

## Monitoring

### Metrics Endpoint

`GET /api/v1/metrics` provides:

- Request counts and status codes
- Latency buckets
- Token usage (OpenAI)
- Uptime

**Note**: Metrics are in-memory and reset on restart. For production, consider:

- Prometheus exporter
- Datadog/New Relic integration
- Custom metrics aggregation

### Logging

Structured logging is enabled via `structlog`. Logs include:

- Request IDs
- Timestamps
- Error details
- Performance metrics

Configure log aggregation (e.g., CloudWatch, Stackdriver, ELK) for production.

## Security Considerations

1. **API Keys**: Store in environment variables, never commit to git
2. **CORS**: Set `CORS_ALLOW_ORIGINS` to your production frontend URLs only
3. **Database**: Use strong passwords and restrict network access
4. **Rate Limiting**: Configure appropriate limits for your use case
5. **HTTPS**: Use TLS/SSL for all production traffic
6. **Secrets Management**: Use secret management services (AWS Secrets Manager, etc.)

## Scaling Considerations

### Horizontal Scaling

When running multiple API instances:

1. **Use Redis** for distributed rate limiting
2. **Use shared database** (managed PostgreSQL)
3. **Configure load balancer** with health checks
4. **Set up metrics aggregation** (metrics are per-instance)

### Database Connection Pooling

Connection pooling is configured in `backend/app/db/session.py`:

- Min connections: 5
- Max connections: 20
- Adjust based on your load

### Worker Processes

In `docker-compose.prod.yml`, the API uses 4 workers:

```yaml
command: uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4
```

Adjust based on your server resources.

## Troubleshooting

### Database Connection Issues

- Verify `DATABASE_URL` is correct
- Check network connectivity
- Ensure pgvector extension is enabled
- Check database user permissions

### Rate Limiting Not Working

- Verify `RATE_LIMIT_REQUESTS` and `RATE_LIMIT_WINDOW` are set
- Check Redis connection if using distributed rate limiting
- Review logs for rate limit errors

### CORS Errors

- Verify `CORS_ALLOW_ORIGINS` includes your frontend URL
- Check that frontend is using correct `NEXT_PUBLIC_API_BASE_URL`
- Ensure CORS headers are present in responses

### OpenAI API Errors

- Verify `OPENAI_API_KEY` is valid
- Check API rate limits and quotas
- Review error logs for specific error messages

## Production Checklist

- [ ] Environment variables configured
- [ ] Database migrations run
- [ ] CORS origins set correctly
- [ ] Health checks configured
- [ ] Rate limiting configured (Redis if multiple instances)
- [ ] Monitoring/logging set up
- [ ] HTTPS/TLS configured
- [ ] Secrets stored securely
- [ ] Backup strategy for database
- [ ] Load balancer configured (if multiple instances)

## Support

For issues or questions, check:

- `README.md` - General documentation
- `backend/README.md` - Backend-specific docs
- GitHub Issues - Known issues and bug reports
