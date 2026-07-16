# Security Considerations

This document outlines security considerations for the RAG Eval Observability platform.

## 🔍 Understanding the Proxy Architecture

**Important**: The Next.js API proxy (`/api/backend/[...path]`) protects the **backend URL** but does **not** protect the **API functionality**.

### What the Proxy Protects ✅
- **Backend URL/IP**: The actual backend URL (`BACKEND_API_BASE_URL`) is server-side only and not visible to clients
- **CORS issues**: Avoids mixed content warnings (HTTPS frontend → HTTP backend)
- **Network topology**: Hides backend infrastructure details

### What the Proxy Does NOT Protect ❌
- **API endpoints**: All endpoints are still publicly accessible through the proxy
- **API functionality**: Anyone can call `/api/backend/api/v1/query`, `/api/backend/api/v1/ingest`, etc.
- **Data access**: Users can query, ingest, and delete documents without authentication

### How Users Can Access the API

Even with the proxy, users can:

1. **Browser DevTools**:
   ```javascript
   // Open DevTools → Network tab → See all API calls
   fetch('/api/backend/api/v1/query', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ query: 'test' })
   })
   ```

2. **Direct HTTP requests**:
   ```bash
   curl https://your-vercel-app.vercel.app/api/backend/api/v1/query \
     -X POST \
     -H "Content-Type: application/json" \
     -d '{"query": "test"}'
   ```

3. **Reverse engineering**: API structure is visible in frontend code

## ✅ Current Security Measures

### Secrets Management
- ✅ **No hardcoded secrets**: All sensitive values (API keys, database URLs) use environment variables
- ✅ **Environment files ignored**: `.env` and `.env.local` files are in `.gitignore`
- ✅ **Example files provided**: `.env.example` files document required variables without exposing secrets
- ✅ **Backend URL hidden**: Backend URL is server-side only (not exposed to clients)

### Input Validation
- ✅ **Query length limits**: Maximum 5,000 characters per query
- ✅ **Payload size limits**: Maximum 10MB for document ingestion
- ✅ **Empty string validation**: Required fields are validated
- ✅ **Pydantic schemas**: Request/response validation using Pydantic

### SQL Injection Protection
- ✅ **Parameterized queries**: All database queries use parameterized statements (`$1`, `$2`, etc.)
- ✅ **asyncpg**: Database library handles parameterization correctly

### Rate Limiting
- ✅ **Per-IP rate limiting**: 100 requests per 60 seconds (configurable)
- ✅ **Redis support**: Optional distributed rate limiting for multi-instance deployments
- ⚠️ **Note**: Rate limiting helps prevent abuse but doesn't restrict access

### CORS Configuration
- ✅ **Configurable origins**: CORS origins are configurable via environment variables
- ✅ **Default localhost**: Includes localhost for development
- ⚠️ **Note**: CORS only affects browser requests, not direct API calls

### File Upload Security
- ✅ **File type validation**: Only PDF and DOCX files accepted
- ✅ **File size limits**: Enforced at multiple levels
- ✅ **Memory-safe processing**: Files processed in-memory with size limits

## ⚠️ Security Considerations

### Authentication & Authorization

**Current Status**: ❌ **No authentication or authorization implemented**

**Impact**: 
- Anyone can access the API through the proxy endpoints
- No user isolation or access control
- API endpoints are publicly accessible (via proxy)
- Rate limiting provides some protection but doesn't restrict access

**When This Is Acceptable**:
- ✅ **Portfolio/demo projects**: Public access is fine for showcasing
- ✅ **Internal tools**: Behind corporate firewall/VPN
- ✅ **Open-source projects**: Users add their own authentication
- ✅ **Low-risk deployments**: When data sensitivity is low

**When This Is NOT Acceptable**:
- ❌ **Production APIs with sensitive data**: Need authentication
- ❌ **Multi-tenant systems**: Need user isolation
- ❌ **Cost-sensitive deployments**: Need to prevent abuse
- ❌ **Regulated industries**: May require authentication/audit trails

**Recommendations**:
1. **For portfolio/demo projects**: Current setup is fine with rate limiting
2. **For production deployments**, add authentication:
   - API key authentication (simple, suitable for server-to-server)
   - JWT tokens (for user-based access)
   - OAuth2 (for third-party integrations)
3. **For open-source use**, document this clearly:
   - Add warnings in README about public API access
   - Recommend deploying behind a reverse proxy with authentication
   - Consider adding optional authentication middleware

**Example Implementation** (Optional):
```python
# backend/app/core/auth.py
from fastapi import HTTPException, Security
from fastapi.security import APIKeyHeader

api_key_header = APIKeyHeader(name="X-API-Key")

async def verify_api_key(api_key: str = Security(api_key_header)):
    if api_key != settings.API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")
    return api_key
```

### File Upload Security

**Current Status**: ⚠️ **Basic validation only**

**Concerns**:
- Only validates file extension, not MIME type or actual file content
- Malicious files could potentially be uploaded if renamed
- PDF/DOCX parsing libraries may have vulnerabilities

**Recommendations**:
1. **Validate MIME type** in addition to extension:
   ```python
   import magic
   mime_type = magic.from_buffer(file_content, mime=True)
   if mime_type not in ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]:
       raise HTTPException(400, "Invalid file type")
   ```
2. **Limit file processing**: Set timeouts and memory limits
3. **Keep dependencies updated**: Regularly update PyPDF2, python-docx
4. **Consider sandboxing**: Process files in isolated containers for production

### Error Message Information Disclosure

**Current Status**: ⚠️ **Some error messages may leak information**

**Concerns**:
- Error messages sometimes include internal details
- Stack traces may be exposed in development mode

**Recommendations**:
1. **Sanitize error messages** in production:
   ```python
   if settings.ENVIRONMENT == "production":
       detail = "Internal server error"
   else:
       detail = str(e)
   ```
2. **Use structured logging** instead of exposing errors to clients
3. **Return generic errors** to clients, log details server-side

### Cross-Site Scripting (XSS)

**Current Status**: ⚠️ **Markdown rendering needs verification**

**Concerns**:
- User-provided content is rendered as markdown
- Need to ensure markdown renderer sanitizes HTML

**Recommendations**:
1. **Verify ReactMarkdown** sanitization (it should sanitize by default)
2. **Consider using `remark-gfm`** with sanitization plugins
3. **Test with malicious markdown** inputs

### Cross-Site Request Forgery (CSRF)

**Current Status**: ⚠️ **No CSRF protection**

**Concerns**:
- Frontend makes direct API calls
- No CSRF tokens or SameSite cookies

**Recommendations**:
1. **For API-only deployments**: CSRF is less critical (no cookies)
2. **For cookie-based auth**: Add CSRF tokens
3. **Use SameSite cookies** if implementing session-based auth

### API Security

**Current Status**: ⚠️ **No request signing or replay protection**

**Recommendations**:
1. **Add request signing** for sensitive operations (optional)
2. **Use HTTPS** in production (required)
3. **Implement request nonces** for replay protection (optional)

## 🔒 Production Deployment Checklist

Before deploying to production:

- [ ] **Set strong environment variables**:
  - Use strong, unique `OPENAI_API_KEY`
  - Use secure `DATABASE_URL` with strong password
  - Set `ENVIRONMENT=production`
  - Configure `CORS_ALLOW_ORIGINS` with production URLs only

- [ ] **Enable HTTPS**:
  - Use TLS/SSL certificates
  - Redirect HTTP to HTTPS
  - Use secure headers (HSTS, CSP)

- [ ] **Implement authentication** (if needed):
  - Add API key authentication
  - Or implement JWT/OAuth2
  - Document authentication method

- [ ] **Configure rate limiting**:
  - Adjust limits for your use case
  - Enable Redis for distributed deployments
  - Monitor rate limit violations

- [ ] **Set up monitoring**:
  - Monitor error rates
  - Track API usage
  - Set up alerts for anomalies

- [ ] **Review file upload security**:
  - Add MIME type validation
  - Set appropriate file size limits
  - Keep parsing libraries updated

- [ ] **Secure error handling**:
  - Disable debug mode
  - Sanitize error messages
  - Use structured logging

- [ ] **Database security**:
  - Use strong database passwords
  - Restrict database network access
  - Enable SSL for database connections
  - Regular backups

- [ ] **Dependency security**:
  - Run `npm audit` and `pip-audit` regularly
  - Keep dependencies updated
  - Review security advisories

## 📝 Open Source Considerations

For open-source distribution:

1. **Document security assumptions**:
   - Clearly state that authentication is not included
   - Explain that API is publicly accessible via proxy
   - Recommend deployment behind authenticated reverse proxy
   - Provide examples for adding authentication

2. **Security policy**:
   - Create `SECURITY.md` (this file)
   - Provide contact method for security issues
   - Follow responsible disclosure practices

3. **Dependency management**:
   - Keep dependencies updated
   - Document known vulnerabilities
   - Provide upgrade paths

## 🐛 Reporting Security Issues

If you discover a security vulnerability, please:

1. **Do not** open a public GitHub issue
2. Email security concerns to: [your-email@example.com]
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

We will respond within 48 hours and work with you to address the issue responsibly.

## 📚 Additional Resources

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [FastAPI Security](https://fastapi.tiangolo.com/tutorial/security/)
- [Next.js Security](https://nextjs.org/docs/app/building-your-application/configuring/security-headers)
- [PostgreSQL Security](https://www.postgresql.org/docs/current/security.html)
