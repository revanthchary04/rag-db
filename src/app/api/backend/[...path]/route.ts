import { NextRequest, NextResponse } from 'next/server'

// Backend URL - server-side only (no NEXT_PUBLIC_ prefix needed).
// `BACKEND_API_BASE_URL` is canonical; `AZURE_API_BASE_URL` is a back-compat fallback.
const base =
  process.env.BACKEND_API_BASE_URL || process.env.AZURE_API_BASE_URL || 'http://localhost:8000'

type RouteContext = { params: Promise<{ path: string[] }> }

export async function GET(request: NextRequest, { params }: RouteContext) {
  return proxyRequest(request, (await params).path)
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  return proxyRequest(request, (await params).path)
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  return proxyRequest(request, (await params).path)
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  return proxyRequest(request, (await params).path)
}

async function proxyRequest(request: NextRequest, pathSegments: string[]) {
  try {
    // Reconstruct the backend path
    const path = pathSegments.join('/')
    const url = `${base}/${path}`

    // Get query string if present
    const searchParams = request.nextUrl.searchParams.toString()
    const fullUrl = searchParams ? `${url}?${searchParams}` : url

    // Get request body for POST/DELETE
    let body: BodyInit | undefined
    const method = request.method
    const contentType = request.headers.get('content-type') || ''

    if (method !== 'GET' && method !== 'HEAD') {
      // Handle FormData (file uploads)
      if (contentType.includes('multipart/form-data')) {
        body = await request.formData()
      } else if (contentType.includes('application/json')) {
        // Handle JSON
        try {
          const requestBody = await request.json()
          body = JSON.stringify(requestBody)
        } catch {
          // Fallback to text if JSON parsing fails
          body = await request.text()
        }
      } else {
        // Handle other content types (text, etc.)
        try {
          body = await request.text()
        } catch {
          // No body
        }
      }
    }

    // Forward specific headers (matching Pages Router pattern)
    // Don't set content-type for FormData - fetch will set it automatically with boundary
    const headers: Record<string, string> = {
      ...(request.headers.get('authorization')
        ? { authorization: request.headers.get('authorization')! }
        : {}),
    }

    const backendApiKey = (process.env.BACKEND_API_KEY || process.env.AZURE_API_BACKEND_KEY)?.trim()
    if (backendApiKey) {
      headers['x-api-key'] = backendApiKey
    }

    const bodyEmpty =
      body === undefined || body === '' || (typeof body === 'string' && body.trim() === '')
    const omitDeletePayload = method === 'DELETE' && bodyEmpty

    // Only set content-type if it's not FormData; omit JSON CT on DELETE with no body (cleaner upstream).
    if (!contentType.includes('multipart/form-data')) {
      if (!omitDeletePayload) {
        headers['content-type'] = contentType || 'application/json'
      }
    }

    // Make request to backend
    const upstream = await fetch(fullUrl, {
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' || omitDeletePayload ? undefined : body,
    })

    const responseContentType = upstream.headers.get('content-type') ?? ''

    if (responseContentType.includes('text/event-stream') && upstream.body) {
      const outHeaders = new Headers()
      outHeaders.set('content-type', responseContentType)
      outHeaders.set('cache-control', 'no-cache')
      outHeaders.set('connection', 'keep-alive')
      const xrid = upstream.headers.get('x-request-id')
      if (xrid) outHeaders.set('x-request-id', xrid)
      return new NextResponse(upstream.body, {
        status: upstream.status,
        headers: outHeaders,
      })
    }

    // Binary bodies (PDF etc.) must not go through `.text()` or the stream is corrupted.
    const lcCt = responseContentType.toLowerCase()
    if (lcCt.includes('application/pdf')) {
      const buf = await upstream.arrayBuffer()
      const response = new NextResponse(buf, { status: upstream.status })
      response.headers.set('content-type', responseContentType)
      const cd = upstream.headers.get('content-disposition')
      if (cd) response.headers.set('content-disposition', cd)
      return response
    }

    const text = await upstream.text()
    const response = new NextResponse(text, {
      status: upstream.status,
    })
    if (responseContentType) {
      response.headers.set('content-type', responseContentType)
    }

    return response
  } catch (error) {
    console.error('[API Proxy] Error proxying request:', error)
    return NextResponse.json(
      {
        error: 'Proxy error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
