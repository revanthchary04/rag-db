'use client'

// Use relative URL to proxy through Vercel API routes
// This avoids mixed content and CORS issues
const API_BASE_URL = '/api/backend'

/** Normalize FastAPI `detail` (string, object, or validation error list). */
export function formatApiErrorDetail(detail: unknown): string {
  if (detail == null) return ''
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail
      .map(item => {
        if (item && typeof item === 'object' && 'msg' in item) {
          const loc =
            'loc' in item && Array.isArray((item as { loc: unknown }).loc)
              ? `${(item as { loc: unknown[] }).loc.join('.')}: `
              : ''
          return `${loc}${String((item as { msg: unknown }).msg)}`
        }
        return JSON.stringify(item)
      })
      .join('; ')
  }
  if (typeof detail === 'object' && detail !== null && 'message' in detail) {
    return String((detail as { message: unknown }).message)
  }
  return String(detail)
}

function messageFromErrorResponse(text: string, status: number): string {
  const fallback = text.trim() || `Request failed with status ${status}`
  try {
    const data = JSON.parse(text) as { detail?: unknown; message?: unknown }
    if (data.detail !== undefined) return formatApiErrorDetail(data.detail) || fallback
    if (data.message !== undefined) return String(data.message)
  } catch {
    /* use fallback */
  }
  return fallback
}

// Helper to ensure we're in browser environment
function ensureBrowser() {
  if (typeof window === 'undefined') {
    throw new Error('API functions can only be called in the browser')
  }
}

/** Abort when any of the signals abort (DOM spec `AbortSignal.any` is not universal yet). */
function combineAbortSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  if (a.aborted) return a
  if (b.aborted) return b
  const merged = new AbortController()
  const onAbort = () => merged.abort()
  a.addEventListener('abort', onAbort)
  b.addEventListener('abort', onAbort)
  return merged.signal
}

export async function ragQuery(body: {
  query: string
  topK?: number
  debug?: boolean
  filters?: Record<string, unknown>
  rag_model?: string
}) {
  ensureBrowser()
  const res = await fetch(`${API_BASE_URL}/api/v1/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    const errorMessage = messageFromErrorResponse(text, res.status)

    // Create error with status code for better handling
    const error = new Error(errorMessage) as Error & { status?: number }
    error.status = res.status
    throw error
  }

  return res.json()
}

const RAG_STREAM_TIMEOUT_MS = 180_000

export async function ragQueryStream(
  body: {
    query: string
    topK?: number
    debug?: boolean
    filters?: Record<string, unknown>
    rag_model?: string
  },
  handlers: {
    onDelta: (text: string) => void
    onDone: (data: Record<string, unknown>) => void
    onError: (message: string) => void
    onAbort?: () => void
  },
  signal?: AbortSignal
): Promise<void> {
  ensureBrowser()

  let timedOut = false
  const timeoutController = new AbortController()
  const timeoutId = window.setTimeout(() => {
    timedOut = true
    timeoutController.abort()
  }, RAG_STREAM_TIMEOUT_MS)

  const combined =
    signal !== undefined
      ? combineAbortSignals(signal, timeoutController.signal)
      : timeoutController.signal

  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}/api/v1/query/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: combined,
    })
  } catch {
    window.clearTimeout(timeoutId)
    if (timedOut) {
      handlers.onError('The request timed out. Try again or turn off streaming in settings.')
      return
    }
    if (signal?.aborted) {
      handlers.onAbort?.()
      return
    }
    handlers.onError('Network error while connecting for streaming.')
    return
  }

  if (!res.ok) {
    window.clearTimeout(timeoutId)
    const text = await res.text().catch(() => '')
    handlers.onError(messageFromErrorResponse(text, res.status))
    return
  }

  const reader = res.body?.getReader()
  if (!reader) {
    window.clearTimeout(timeoutId)
    handlers.onError('No response body')
    return
  }

  const decoder = new TextDecoder()
  let buffer = ''
  let streamFailed = false
  let sawDone = false

  const processBuffer = (): void => {
    const parts = buffer.split('\n\n')
    buffer = parts.pop() ?? ''
    outer: for (const block of parts) {
      for (const line of block.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const jsonStr = trimmed.slice(5).trim()
        if (!jsonStr || jsonStr === '[DONE]') continue
        let ev: unknown
        try {
          ev = JSON.parse(jsonStr)
        } catch {
          continue
        }
        if (typeof ev !== 'object' || ev === null || !('type' in ev)) continue
        const o = ev as { type: string; text?: string; message?: string }
        if (o.type === 'delta' && typeof o.text === 'string') {
          handlers.onDelta(o.text)
        } else if (o.type === 'done') {
          sawDone = true
          handlers.onDone(ev as Record<string, unknown>)
        } else if (o.type === 'error' && typeof o.message === 'string') {
          streamFailed = true
          handlers.onError(o.message)
          break outer
        }
      }
    }
  }

  try {
    while (!streamFailed) {
      let readResult: ReadableStreamReadResult<Uint8Array>
      try {
        readResult = await reader.read()
      } catch {
        window.clearTimeout(timeoutId)
        if (timedOut) {
          handlers.onError('The request timed out while streaming.')
          return
        }
        if (signal?.aborted) {
          handlers.onAbort?.()
          return
        }
        handlers.onError('Connection lost while streaming.')
        return
      }

      const { done, value } = readResult
      if (done) {
        if (buffer.trim()) {
          buffer += '\n\n'
          processBuffer()
        }
        break
      }
      buffer += decoder.decode(value, { stream: true })
      processBuffer()
    }
  } finally {
    window.clearTimeout(timeoutId)
    try {
      reader.releaseLock()
    } catch {
      /* ignore */
    }
  }

  if (timedOut) {
    handlers.onError('The request timed out while streaming.')
    return
  }
  if (signal?.aborted) {
    handlers.onAbort?.()
    return
  }
  if (!sawDone && !streamFailed) {
    handlers.onError('Stream ended before the answer was complete. Try again.')
  }
}

export interface IngestPreprocessingSummary {
  original_character_count: number
  normalized_character_count: number
  character_delta: number
  steps_applied: string[]
  warnings: string[]
}

export interface IngestChunkingSummary {
  chunks_before_merge: number
  chunks_created: number
  undersized_chunk_merges: number
  chunk_target_size: number
  chunk_overlap: number
  adaptive_chunking: boolean
  config_chunk_size: number
  config_chunk_overlap: number
  estimated_target_chunks: number
  min_chunk_characters_applied: number
  merged_chunk_soft_cap_chars: number
  chunk_length_min: number
  chunk_length_max: number
  chunk_length_mean: number
  chunk_length_median: number
}

export interface IngestResponsePayload {
  document_id: string
  chunks_created: number
  replaced_existing: boolean
  preprocessing: IngestPreprocessingSummary
  chunking: IngestChunkingSummary
}

export async function ingestDocument(body: {
  source: string
  title?: string
  text: string
  is_markdown?: boolean
  /** Optional PDF bytes as standard base64 (enables original preview in the UI). */
  original_file_base64?: string
  original_media_type?: 'application/pdf'
}): Promise<IngestResponsePayload> {
  ensureBrowser()
  const res = await fetch(`${API_BASE_URL}/api/v1/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(messageFromErrorResponse(text, res.status))
  }

  return res.json() as Promise<IngestResponsePayload>
}

export async function listDocuments(limit = 100, offset = 0, includeTotal = false) {
  ensureBrowser()

  try {
    // Add timeout to prevent hanging
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000) // 10 second timeout

    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
    })
    if (includeTotal) params.set('include_total', 'true')

    const res = await fetch(`${API_BASE_URL}/api/v1/documents?${params}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(text || `List documents failed with status ${res.status}`)
    }

    const data = await res.json()
    return data
  } catch (error: unknown) {
    // Provide more helpful error message
    const err = error as { name?: string; message?: string }
    if (err.name === 'AbortError') {
      throw new Error(`Request timed out. Is the backend running at ${API_BASE_URL}?`)
    }

    if (err.message?.includes('Failed to fetch') || err.message?.includes('NetworkError')) {
      throw new Error(
        `Cannot connect to backend at ${API_BASE_URL}. Is the backend server running?`
      )
    }

    throw error
  }
}

function encodeDocumentPathSegment(documentId: string): string {
  return encodeURIComponent(documentId)
}

/** Single-document metadata from GET /documents/{id} (used for accurate PDF preview flag). */
export interface DocumentDetailPayload {
  id: string
  source: string
  title?: string | null
  created_at?: string | null
  original_available: boolean
}

export async function getDocument(documentId: string): Promise<DocumentDetailPayload> {
  ensureBrowser()
  const id = encodeDocumentPathSegment(documentId)
  const res = await fetch(`${API_BASE_URL}/api/v1/documents/${id}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(messageFromErrorResponse(text, res.status))
  }

  const raw = (await res.json()) as Record<string, unknown>
  const originalAvailableFlag = raw.original_available === true || raw.originalAvailable === true

  return {
    id: String(raw.id ?? ''),
    source: String(raw.source ?? ''),
    title: raw.title != null ? String(raw.title) : null,
    created_at: raw.created_at != null ? String(raw.created_at) : null,
    original_available: originalAvailableFlag,
  }
}

export async function deleteDocument(documentId: string) {
  ensureBrowser()
  const id = encodeDocumentPathSegment(documentId)
  const res = await fetch(`${API_BASE_URL}/api/v1/documents/${id}`, {
    method: 'DELETE',
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(messageFromErrorResponse(text, res.status))
  }

  return res.json()
}

/** Postgres-backed chat thread (sidebar). */
export interface ChatThreadSummary {
  id: string
  title: string | null
  created_at: string | null
  updated_at: string | null
  message_count: number
}

/** Message row from GET /chat/threads/:id/messages */
export interface PersistedChatMessage {
  id: string
  thread_id: string
  role: string
  content: string
  citations: unknown[]
  metadata: Record<string, unknown>
  latency_ms: number | null
  cost_usd: number | null
  rag_model: string | null
  seq: number
  created_at: string | null
  request_id?: string | null
  query_log_id?: string | null
  eval_run_id?: string | null
  eval_case_id?: string | null
}

export async function createChatThread(body?: {
  title?: string | null
}): Promise<ChatThreadSummary> {
  ensureBrowser()
  const res = await fetch(`${API_BASE_URL}/api/v1/chat/threads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(messageFromErrorResponse(text, res.status))
  }
  return res.json() as Promise<ChatThreadSummary>
}

export async function updateChatThread(
  threadId: string,
  body: { title: string }
): Promise<ChatThreadSummary> {
  ensureBrowser()
  const id = encodeDocumentPathSegment(threadId)
  const res = await fetch(`${API_BASE_URL}/api/v1/chat/threads/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(messageFromErrorResponse(text, res.status))
  }
  return res.json() as Promise<ChatThreadSummary>
}

export async function listChatThreads(limit = 50): Promise<ChatThreadSummary[]> {
  ensureBrowser()
  const res = await fetch(`${API_BASE_URL}/api/v1/chat/threads?limit=${limit}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(messageFromErrorResponse(text, res.status))
  }
  const data = (await res.json()) as { threads: ChatThreadSummary[] }
  return data.threads ?? []
}

export async function listChatMessages(threadId: string): Promise<PersistedChatMessage[]> {
  ensureBrowser()
  const id = encodeDocumentPathSegment(threadId)
  const res = await fetch(`${API_BASE_URL}/api/v1/chat/threads/${id}/messages`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(messageFromErrorResponse(text, res.status))
  }
  const data = (await res.json()) as { messages: PersistedChatMessage[] }
  return data.messages ?? []
}

export async function appendChatMessage(
  threadId: string,
  body: {
    role: 'user' | 'assistant' | 'system'
    content: string
    citations?: Record<string, unknown>[]
    metadata?: Record<string, unknown>
    latency_ms?: number
    cost_usd?: number
    rag_model?: string
    request_id?: string | null
    query_log_id?: string | null
    eval_run_id?: string | null
    eval_case_id?: string | null
  }
): Promise<PersistedChatMessage> {
  ensureBrowser()
  const id = encodeDocumentPathSegment(threadId)
  const res = await fetch(`${API_BASE_URL}/api/v1/chat/threads/${id}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(messageFromErrorResponse(text, res.status))
  }
  return res.json() as Promise<PersistedChatMessage>
}

export async function deleteChatThread(threadId: string): Promise<void> {
  ensureBrowser()
  const id = encodeDocumentPathSegment(threadId)
  const res = await fetch(`${API_BASE_URL}/api/v1/chat/threads/${id}`, {
    method: 'DELETE',
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(messageFromErrorResponse(text, res.status))
  }
}

export async function deleteAllChatThreads(): Promise<{ deleted_count: number }> {
  ensureBrowser()
  const res = await fetch(`${API_BASE_URL}/api/v1/chat/threads`, {
    method: 'DELETE',
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(messageFromErrorResponse(text, res.status))
  }
  return res.json() as Promise<{ deleted_count: number }>
}

export async function getMetrics() {
  ensureBrowser()
  const res = await fetch(`${API_BASE_URL}/api/v1/metrics`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || `Get metrics failed with status ${res.status}`)
  }

  return res.json()
}

export type QueryLogDetail = {
  id: string
  query_text: string
  rag_model: string
  top_k: number | null
  request_id: string | null
  client_ip: string | null
  user_agent: string | null
  latency_ms: number | null
  token_usage: Record<string, number> | null
  cost_usd: number | null
  citations_count: number | null
  answer_length: number | null
  created_at: string | null
}

export async function fetchQueryLogDetail(queryId: string): Promise<QueryLogDetail> {
  ensureBrowser()
  const id = encodeURIComponent(queryId)
  const res = await fetch(`${API_BASE_URL}/api/v1/analytics/query-log/${id}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(messageFromErrorResponse(text, res.status))
  }
  return res.json() as Promise<QueryLogDetail>
}

export async function fetchQueryLogsList(params?: {
  limit?: number
  offset?: number
  rag_model?: string
  start_date?: string
  end_date?: string
}): Promise<{ logs: QueryLogDetail[] }> {
  ensureBrowser()
  const q = new URLSearchParams()
  q.set('limit', String(params?.limit ?? 50))
  q.set('offset', String(params?.offset ?? 0))
  if (params?.rag_model?.trim()) q.set('rag_model', params.rag_model.trim())
  if (params?.start_date?.trim()) q.set('start_date', params.start_date.trim())
  if (params?.end_date?.trim()) q.set('end_date', params.end_date.trim())
  const res = await fetch(`${API_BASE_URL}/api/v1/analytics/query-logs?${q}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(messageFromErrorResponse(text, res.status))
  }
  return res.json() as Promise<{ logs: QueryLogDetail[] }>
}

export type EvalRunSummary = {
  id: string
  created_at: string
  finished_at: string
  status: string
  dataset_path: string
  use_llm_judge: boolean
  total_cases: number
  successful: number
  failed: number
  hit_at_1: number
  hit_at_3: number
  hit_at_5: number
  hit_at_8: number
  mrr: number
  llm_judge_correctness_rate: number | null
  llm_judge_faithfulness_rate: number | null
  config_json: Record<string, unknown>
}

export type EvalCaseResult = {
  id: string
  case_index: number
  case_id: string
  query: string
  expected_sources: string[]
  retrieved_sources: string[]
  answer: string
  hit_at_1: boolean
  hit_at_3: boolean
  hit_at_5: boolean
  hit_at_8: boolean
  mrr: number
  llm_judge_correctness: boolean | null
  llm_judge_faithfulness: boolean | null
  llm_judge_reasoning: string | null
  error: string | null
  citations: Record<string, unknown>[]
}

export type EvalRunDetail = EvalRunSummary & {
  error_message: string | null
  cases: EvalCaseResult[]
}

export async function fetchEvalRunsList(params?: {
  limit?: number
  offset?: number
}): Promise<{ runs: EvalRunSummary[] }> {
  ensureBrowser()
  const limit = params?.limit ?? 50
  const offset = params?.offset ?? 0
  const res = await fetch(`${API_BASE_URL}/api/v1/eval/runs?limit=${limit}&offset=${offset}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(messageFromErrorResponse(text, res.status))
  }
  return res.json() as Promise<{ runs: EvalRunSummary[] }>
}

export async function fetchEvalRunDetail(runId: string): Promise<EvalRunDetail> {
  ensureBrowser()
  const id = encodeURIComponent(runId)
  const res = await fetch(`${API_BASE_URL}/api/v1/eval/runs/${id}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(messageFromErrorResponse(text, res.status))
  }
  return res.json() as Promise<EvalRunDetail>
}

export async function getDocumentChunks(documentId: string) {
  ensureBrowser()
  const id = encodeDocumentPathSegment(documentId)
  const res = await fetch(`${API_BASE_URL}/api/v1/documents/${id}/chunks`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || `Get document chunks failed with status ${res.status}`)
  }

  return res.json()
}

/** Base64 payload without data URL prefix (for ingest original_file_base64). */
export function fileToBase64(file: File): Promise<string> {
  ensureBrowser()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      const comma = dataUrl.indexOf(',')
      resolve(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl)
    }
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

/** Proxied URL for inline PDF preview (`<iframe src={...} />`). */
export function documentOriginalUrl(documentId: string): string {
  const id = encodeURIComponent(documentId)
  return `${API_BASE_URL}/api/v1/documents/${id}/original`
}

export async function extractTextFromFile(file: File): Promise<string> {
  ensureBrowser()
  const formData = new FormData()
  formData.append('file', file)

  const res = await fetch(`${API_BASE_URL}/api/v1/extract-text`, {
    method: 'POST',
    body: formData,
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || `Text extraction failed with status ${res.status}`)
  }

  const data = await res.json()
  return data.text
}

export async function checkHealth(): Promise<{ ok: boolean; db: boolean; version: string }> {
  ensureBrowser()
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/health`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    })

    if (!res.ok) {
      throw new Error(`Health check failed with status ${res.status}`)
    }

    return await res.json()
  } catch (error) {
    // If the request fails (network error, CORS, etc.), return unhealthy status
    throw error
  }
}
