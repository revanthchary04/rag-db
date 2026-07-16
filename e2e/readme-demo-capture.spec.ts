/**
 * Generates static frames (and optionally a GIF via scripts/stitch-demo-gif.sh)
 * for the README “proof” walkthrough (first frame: example pill → one assistant reply).
 * Gated so normal CI does not rewrite assets.
 *
 *   pnpm demo:capture
 */
import * as fs from 'fs'
import * as path from 'path'

import { expect, test } from '@playwright/test'

import { DEMO_EXAMPLE_QUERIES } from '../src/lib/demo-example-queries'

const RUN_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const RUN_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const OUT_DIR = path.join(process.cwd(), 'docs', 'images', 'demo-frames')

function runSummary(id: string, hit5: number) {
  return {
    id,
    created_at: '2026-01-02T12:00:00.000Z',
    finished_at: '2026-01-02T12:01:00.000Z',
    status: 'completed',
    dataset_path: 'eval/dataset.jsonl',
    use_llm_judge: false,
    total_cases: 2,
    successful: 2,
    failed: 0,
    hit_at_1: hit5,
    hit_at_3: hit5,
    hit_at_5: hit5,
    hit_at_8: hit5,
    mrr: hit5,
    llm_judge_correctness_rate: null,
    llm_judge_faithfulness_rate: null,
    config_json: {},
  }
}

function mkCase(rowId: string, caseIndex: number, caseId: string, hit5: boolean, mrr: number) {
  return {
    id: rowId,
    case_index: caseIndex,
    case_id: caseId,
    query: `What is RAG? (${caseId})`,
    expected_sources: [] as string[],
    retrieved_sources: ['doc-rag-intro.md'],
    answer: 'Retrieval-Augmented Generation combines retrieval with generation…',
    hit_at_1: true,
    hit_at_3: true,
    hit_at_5: hit5,
    hit_at_8: true,
    mrr,
    llm_judge_correctness: null,
    llm_judge_faithfulness: null,
    llm_judge_reasoning: null,
    error: null,
    citations: [] as Record<string, unknown>[],
  }
}

const README_REQUEST_ID = 'req-readme-demo'
const README_QUERY_LOG_ID = '11111111-1111-1111-1111-111111111111'

/** Shown after clicking the first example pill (non-streaming /query path). */
const README_DEMO_ANSWER =
  '**What happened (mocked walkthrough)** — The app embedded your question, ran **vector-similarity** retrieval, pulled **3** top chunks (best match: *Introduction to RAG*), then composed this answer. The same turn appears under **Query logs** next.'

async function installMocks(page: import('@playwright/test').Page) {
  const exampleQuery = DEMO_EXAMPLE_QUERIES[0]
  const iso = () => new Date().toISOString()
  let seqThread = 0
  let seqMsg = 0
  const threads: Array<{
    id: string
    title: string | null
    created_at: string
    updated_at: string
    message_count: number
  }> = []
  const messagesByThread: Record<
    string,
    Array<{
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
      created_at: string
      request_id?: string | null
      query_log_id?: string | null
    }>
  > = {}

  function syncCounts() {
    for (const t of threads) {
      t.message_count = messagesByThread[t.id]?.length ?? 0
      const last = messagesByThread[t.id]?.at(-1)
      if (last) t.updated_at = last.created_at
    }
  }

  function appendMessage(threadId: string, role: string, content: string) {
    const arr = messagesByThread[threadId] ?? []
    const seq = arr.length + 1
    const row = {
      id: `m-${++seqMsg}`,
      thread_id: threadId,
      role,
      content,
      citations: [] as unknown[],
      metadata: {} as Record<string, unknown>,
      latency_ms: null,
      cost_usd: null,
      rag_model: null,
      seq,
      created_at: iso(),
    }
    arr.push(row)
    messagesByThread[threadId] = arr
    syncCounts()
    return row
  }

  function createThread(title: string | null) {
    const id = `t-${++seqThread}`
    const now = iso()
    const row = {
      id,
      title,
      created_at: now,
      updated_at: now,
      message_count: 0,
    }
    threads.unshift(row)
    messagesByThread[id] = []
    return row
  }

  await page.route('**/api/backend/api/v1/health', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, db: true, version: '0.1.0' }),
    })
  })

  await page.route('**/api/backend/api/v1/documents**', async route => {
    const url = new URL(route.request().url())
    const includeTotal = url.searchParams.get('include_total') === 'true'
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        documents: [
          {
            id: 'demo-doc-1',
            source: 'introduction-to-rag',
            title: 'Introduction to RAG',
            created_at: '2026-01-01T00:00:00.000Z',
            original_available: false,
          },
        ],
        total: includeTotal ? 5 : 1,
        limit: Number(url.searchParams.get('limit')) || 100,
        offset: Number(url.searchParams.get('offset')) || 0,
      }),
    })
  })

  await page.route('**/api/backend/api/v1/query', async route => {
    if (route.request().method() !== 'POST') {
      await route.continue()
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        answer: README_DEMO_ANSWER,
        citations: [
          {
            chunk_id: 'chunk-demo-1',
            document_id: 'demo-doc-1',
            title: 'Introduction to RAG',
            source: 'introduction-to-rag',
            chunk_index: 0,
          },
        ],
        used_chunk_ids: ['chunk-demo-1'],
        latency_ms: 142,
        token_usage: { prompt_tokens: 120, completion_tokens: 280, total_tokens: 400 },
        rag_model: 'vector-similarity',
        retrieved_chunk_count: 3,
        request_id: README_REQUEST_ID,
        query_log_id: README_QUERY_LOG_ID,
      }),
    })
  })

  await page.route('**/api/backend/api/v1/chat/**', async route => {
    const req = route.request()
    const url = new URL(req.url())
    const pathname = url.pathname
    const method = req.method()

    const msgMatch = pathname.match(/\/chat\/threads\/([^/]+)\/messages\/?$/)
    if (msgMatch) {
      const threadId = decodeURIComponent(msgMatch[1])
      if (method === 'GET') {
        const msgs = messagesByThread[threadId] ?? []
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ messages: msgs }),
        })
        return
      }
      if (method === 'POST') {
        const body = req.postDataJSON() as { role: string; content: string }
        const row = appendMessage(threadId, body.role, body.content)
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(row),
        })
        return
      }
    }

    if (pathname.endsWith('/chat/threads') || pathname.endsWith('/chat/threads/')) {
      if (method === 'GET') {
        syncCounts()
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ threads }),
        })
        return
      }
      if (method === 'POST') {
        const body = (req.postDataJSON() as { title?: string | null }) ?? {}
        const row = createThread(body.title ?? null)
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ...row, message_count: 0 }),
        })
        return
      }
    }

    await route.continue()
  })

  await page.route(`**/api/backend/api/v1/eval/runs/${RUN_A}`, async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...runSummary(RUN_A, 1),
        error_message: null,
        cases: [mkCase('c1', 0, 'case-1', true, 1), mkCase('c2', 1, 'case-2', false, 0.25)],
      }),
    })
  })

  await page.route(`**/api/backend/api/v1/eval/runs/${RUN_B}`, async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...runSummary(RUN_B, 0.5),
        error_message: null,
        cases: [mkCase('c1b', 0, 'case-1', false, 0.2), mkCase('c2b', 1, 'case-2', true, 1)],
      }),
    })
  })

  await page.route('**/api/backend/api/v1/eval/runs?**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        runs: [runSummary(RUN_B, 0.5), runSummary(RUN_A, 1)],
      }),
    })
  })

  await page.route('**/api/backend/api/v1/analytics/query-logs?**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        logs: [
          {
            id: README_QUERY_LOG_ID,
            query_text: exampleQuery.prompt,
            rag_model: 'vector-similarity',
            top_k: 5,
            request_id: README_REQUEST_ID,
            client_ip: '127.0.0.1',
            user_agent: 'readme-demo',
            latency_ms: 142,
            token_usage: { prompt: 120, completion: 340 },
            cost_usd: 0.002,
            citations_count: 1,
            answer_length: README_DEMO_ANSWER.length,
            created_at: '2026-01-03T10:00:00.000Z',
          },
        ],
      }),
    })
  })

  await page.route('**/api/backend/api/v1/metrics', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        uptime_seconds: 3600,
        routes: {
          '/api/v1/query': {
            request_count: 42,
            status_counts: { '200': 40, '429': 2 },
            latency_buckets: {},
            avg_latency_ms: 210,
            total_latency_ms: 8820,
          },
        },
        token_usage: {
          embedding_prompt_tokens: 800,
          embedding_total_tokens: 800,
          chat_prompt_tokens: 12000,
          chat_completion_tokens: 9000,
          chat_total_tokens: 21000,
        },
        note: 'In-memory counters reset on restart.',
      }),
    })
  })
}

test.describe('README demo asset capture', () => {
  test.beforeEach(({ page }, testInfo) => {
    test.skip(
      !process.env.CAPTURE_README_DEMO,
      'Set CAPTURE_README_DEMO=1 to write docs/images/demo-frames/*.png'
    )
    page.setViewportSize({ width: 1280, height: 720 })
    testInfo.annotations.push({
      type: 'readme',
      description: 'README walkthrough frames',
    })
  })

  test('write walkthrough PNGs', async ({ page }) => {
    fs.mkdirSync(OUT_DIR, { recursive: true })
    await page.addInitScript(() => {
      window.localStorage.setItem('rag-eval-stream-responses', JSON.stringify(false))
    })
    await installMocks(page)

    const exampleQuery = DEMO_EXAMPLE_QUERIES[0]
    await page.goto('/')
    await expect(page.getByRole('heading', { name: /what can i help with/i })).toBeVisible()
    await expect(page.getByText(/5.*documents.*indexed/i)).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: new RegExp(exampleQuery.label, 'i') }).click()
    await expect(page.getByText(/What happened \(mocked walkthrough\)/i)).toBeVisible({
      timeout: 20_000,
    })
    await expect(page.getByText(/Introduction to RAG/i).first()).toBeVisible({ timeout: 10_000 })
    await page.waitForTimeout(350)
    await page.screenshot({ path: path.join(OUT_DIR, '01-chat.png'), fullPage: true })

    await page.goto('/query-logs')
    await page.waitForTimeout(400)
    await page.screenshot({ path: path.join(OUT_DIR, '02-query-logs.png'), fullPage: true })

    await page.goto('/eval/runs')
    await page.waitForTimeout(400)
    await page.screenshot({ path: path.join(OUT_DIR, '03-eval-runs.png'), fullPage: true })

    await page.goto(
      `/eval/runs?compare=${encodeURIComponent(RUN_A)}&to=${encodeURIComponent(RUN_B)}`
    )
    await page.waitForTimeout(500)
    await page.screenshot({ path: path.join(OUT_DIR, '04-eval-compare.png'), fullPage: true })

    await page.goto(`/eval/runs?id=${encodeURIComponent(RUN_A)}`)
    await page.waitForTimeout(500)
    await page.screenshot({ path: path.join(OUT_DIR, '05-eval-export.png'), fullPage: true })
  })
})
