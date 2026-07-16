import type { Page, Route } from '@playwright/test'

/** A retrieval citation, matching src/lib/types Citation. */
export type MockCitation = {
  chunk_id: string
  document_id: string
  title: string | null
  source: string
  chunk_index: number
}

export type MockObservability = {
  latencyMs?: number
  costUsd?: number
  ragModel?: string
  requestId?: string
  queryLogId?: string
  retrievedCount?: number
  tokenUsage?: Record<string, number>
}

/**
 * Build the exact AI SDK v5 UI-message-stream SSE our /api/chat route emits:
 * text-start -> text-delta* -> text-end -> (data-citations) -> data-observability -> [DONE].
 */
export function chatStreamBody(opts: {
  text?: string
  citations?: MockCitation[]
  observability?: MockObservability
}): string {
  const text = opts.text ?? 'Mock answer for E2E.'
  const citations = opts.citations ?? []
  const observability: MockObservability = opts.observability ?? {
    latencyMs: 1234,
    costUsd: 0.0005,
    ragModel: 'vector-similarity',
    requestId: 'e2e-req',
    queryLogId: 'e2e-query-log',
    retrievedCount: citations.length,
    tokenUsage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  }

  const id = 'txt-e2e'
  const lines: string[] = []
  const push = (obj: unknown) => lines.push(`data: ${JSON.stringify(obj)}\n\n`)

  push({ type: 'text-start', id })
  for (const token of text.split(/(\s+)/)) {
    if (token) push({ type: 'text-delta', id, delta: token })
  }
  push({ type: 'text-end', id })
  if (citations.length > 0) push({ type: 'data-citations', data: citations })
  push({ type: 'data-observability', data: observability })
  lines.push('data: [DONE]\n\n')
  return lines.join('')
}

/** In-memory chat store shared between the /api/chat and /api/history mocks. */
export type ChatStore = {
  chats: Array<{
    id: string
    title: string
    createdAt: string
    updatedAt: string
    userId: string
    visibility: 'private' | 'public'
  }>
}

export function createChatStore(): ChatStore {
  return { chats: [] }
}

/** Mock /api/history (SWR-infinite: { chats, hasMore }). */
export async function mockHistory(page: Page, store: ChatStore) {
  await page.route('**/api/history**', async (route: Route) => {
    const method = route.request().method()
    if (method === 'DELETE') {
      store.chats = []
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ deletedCount: 0 }),
      })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ chats: store.chats, hasMore: false }),
    })
  })
}

/** Mock /api/chat: records a chat into the store and returns the AI SDK stream. */
export async function mockChat(
  page: Page,
  opts: {
    store?: ChatStore
    text?: string
    citations?: MockCitation[]
    observability?: MockObservability
  } = {}
) {
  await page.route('**/api/chat', async (route: Route) => {
    const req = route.request()
    if (req.method() !== 'POST') {
      await route.continue()
      return
    }
    if (opts.store) {
      const body = (req.postDataJSON() ?? {}) as {
        id?: string
        message?: { parts?: Array<{ type: string; text?: string }> }
      }
      const text = body.message?.parts?.find(p => p.type === 'text')?.text ?? 'Untitled chat'
      const now = new Date().toISOString()
      opts.store.chats.unshift({
        id: body.id ?? `chat-${opts.store.chats.length + 1}`,
        title: text.slice(0, 80),
        createdAt: now,
        updatedAt: now,
        userId: '00000000-0000-4000-8000-000000000000',
        visibility: 'private',
      })
    }
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' },
      body: chatStreamBody(opts),
    })
  })
}

/** Mock the FastAPI proxy endpoints the chat sidebar hits (health + documents). */
export async function mockChatBackend(
  page: Page,
  documents: Array<{ id: string; source: string; title?: string; created_at: string }> = []
) {
  await page.route('**/api/backend/api/v1/health', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, db: true, version: '0.1.0' }),
    })
  })
  await page.route('**/api/backend/api/v1/documents**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ documents, total: documents.length, limit: 100, offset: 0 }),
    })
  })
}
