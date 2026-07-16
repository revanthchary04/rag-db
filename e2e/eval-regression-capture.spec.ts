/**
 * Records a focused screen video of the eval regression-catch loop for the
 * README: eval runs list → compare (baseline vs a regressed candidate) → the
 * "Regression" verdict + gated stat tiles → expand the flipped case to reveal
 * the per-source RankShift (canonical source dropping #1 → not retrieved).
 *
 * Fully mocked (no Postgres / OpenAI), so it is deterministic. Gated so normal
 * CI never records. Produces docs/images/eval-regression-flow.webm; convert to
 * a GIF with `pnpm demo:regression-gif`.
 *
 *   pnpm demo:capture-regression
 */
import { test } from '@playwright/test'

const RUN_BASE = 'a1a1a1a1-baseline-4a4a-8b8b-000000000001'
const RUN_CAND = 'b2b2b2b2-candidate-4c4c-9d9d-000000000002'
const VIEWPORT = { width: 1280, height: 820 }

type Case = {
  caseId: string
  query: string
  expected: string[]
  retrievedA: string[]
  retrievedB: string[]
  hit5A: boolean
  hit5B: boolean
  mrrA: number
  mrrB: number
}

// A small, legible dataset that tells the case-study story: four broad
// "summary/glossary" distractors demote canonical sources for two questions.
const CASES: Case[] = [
  {
    caseId: 'case-04',
    query: 'How do I choose a chunk size for RAG?',
    expected: ['chunk-size-tuning'],
    retrievedA: ['chunk-size-tuning.md', 'chunking-strategies.md', 'semantic-chunking.md'],
    retrievedB: [
      'retrieval-methods-glossary.md',
      'embeddings-overview.md',
      'evaluation-metrics-glossary.md',
      'vector-index-cheatsheet.md',
      'chunking-strategies.md',
    ],
    hit5A: true,
    hit5B: false,
    mrrA: 1,
    mrrB: 0,
  },
  {
    caseId: 'case-09',
    query: 'What is HNSW and how does it index vectors?',
    expected: ['hnsw-index-internals'],
    retrievedA: ['hnsw-index-internals.md', 'vector-embeddings.md', 'retrieval-methods.md'],
    retrievedB: [
      'vector-index-cheatsheet.md',
      'embeddings-overview.md',
      'hnsw-index-internals.md',
      'retrieval-methods.md',
    ],
    hit5A: true,
    hit5B: true,
    mrrA: 1,
    mrrB: 0.333,
  },
  {
    caseId: 'case-02',
    query: 'How is faithfulness measured in RAG evaluation?',
    expected: ['faithfulness-and-hallucination'],
    retrievedA: ['faithfulness-and-hallucination.md', 'evaluation-metrics.md'],
    retrievedB: ['faithfulness-and-hallucination.md', 'evaluation-metrics.md'],
    hit5A: true,
    hit5B: true,
    mrrA: 1,
    mrrB: 1,
  },
  {
    caseId: 'case-07',
    query: 'What does reranking with cross-encoders do?',
    expected: ['reranking-cross-encoders'],
    retrievedA: ['reranking-cross-encoders.md', 'retrieval-methods.md'],
    retrievedB: ['reranking-cross-encoders.md', 'retrieval-methods.md'],
    hit5A: true,
    hit5B: true,
    mrrA: 1,
    mrrB: 1,
  },
]

function summary(id: string, agg: { hit1: number; hit5: number; mrr: number }) {
  return {
    id,
    created_at: id === RUN_BASE ? '2026-07-15T09:12:00.000Z' : '2026-07-15T14:40:00.000Z',
    finished_at: '2026-07-15T14:41:00.000Z',
    status: 'completed',
    dataset_path: 'eval/dataset.jsonl',
    use_llm_judge: false,
    total_cases: CASES.length,
    successful: CASES.length,
    failed: 0,
    hit_at_1: agg.hit1,
    hit_at_3: agg.hit5,
    hit_at_5: agg.hit5,
    hit_at_8: agg.hit5,
    mrr: agg.mrr,
    llm_judge_correctness_rate: null,
    llm_judge_faithfulness_rate: null,
    config_json: {},
  }
}

function caseRow(c: Case, side: 'A' | 'B') {
  return {
    id: `${c.caseId}-${side}`,
    case_index: 0,
    case_id: c.caseId,
    query: c.query,
    expected_sources: c.expected,
    retrieved_sources: side === 'A' ? c.retrievedA : c.retrievedB,
    answer: '',
    hit_at_1: side === 'A' ? c.mrrA === 1 : c.mrrB === 1,
    hit_at_3: side === 'A' ? c.hit5A : c.hit5B,
    hit_at_5: side === 'A' ? c.hit5A : c.hit5B,
    hit_at_8: side === 'A' ? c.hit5A : c.hit5B,
    mrr: side === 'A' ? c.mrrA : c.mrrB,
    llm_judge_correctness: null,
    llm_judge_faithfulness: null,
    llm_judge_reasoning: null,
    error: null,
    citations: [] as Record<string, unknown>[],
  }
}

async function installMocks(page: import('@playwright/test').Page) {
  const baseSummary = summary(RUN_BASE, { hit1: 0.769, hit5: 0.949, mrr: 0.84 })
  const candSummary = summary(RUN_CAND, { hit1: 0.705, hit5: 0.897, mrr: 0.79 })

  await page.route('**/api/backend/api/v1/health', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, db: true, version: '0.1.0' }),
    })
  )
  await page.route('**/api/backend/api/v1/documents**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ documents: [], total: 27, limit: 100, offset: 0 }),
    })
  )
  // Register the list route FIRST: its `runs?**` glob also matches the detail
  // URLs (`?` matches one char), and Playwright gives last-registered routes
  // priority — so the more specific detail routes below must come after it.
  await page.route('**/api/backend/api/v1/eval/runs?**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      // Candidate first (newest), then baseline.
      body: JSON.stringify({ runs: [candSummary, baseSummary] }),
    })
  )
  await page.route(`**/api/backend/api/v1/eval/runs/${RUN_BASE}`, route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...baseSummary,
        error_message: null,
        cases: CASES.map(c => caseRow(c, 'A')),
      }),
    })
  )
  await page.route(`**/api/backend/api/v1/eval/runs/${RUN_CAND}`, route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...candSummary,
        error_message: null,
        cases: CASES.map(c => caseRow(c, 'B')),
      }),
    })
  )
}

// Record video via the default context (which carries baseURL + the PLAYWRIGHT
// auth bypass). Playwright writes the .webm under test-results/; the capture
// script copies it to docs/images/eval-regression-flow.webm.
test.use({ viewport: VIEWPORT, colorScheme: 'dark', video: { mode: 'on', size: VIEWPORT } })

test.describe('eval regression flow capture', () => {
  test.skip(
    !process.env.CAPTURE_REGRESSION_GIF,
    'Set CAPTURE_REGRESSION_GIF=1 to record the regression-flow video'
  )

  test('record regression-catch video', async ({ page }) => {
    test.setTimeout(90_000)
    await installMocks(page)

    // Land on the chat home to establish the guest session, then navigate the
    // app the way a user does — via the nav and buttons (client-side routing).
    // A full-page goto to a deep link would bounce through guest auth back to '/'.
    await page.goto('/')
    await page.waitForTimeout(900)

    // 1) Into the eval section via the header nav — the runs list.
    await page.getByRole('link', { name: 'Eval', exact: true }).first().click()
    await page.waitForTimeout(1800)

    // 2) Pick baseline (A) vs the regressed candidate (B) and compare.
    await page.getByLabel(/baseline run/i).selectOption(RUN_BASE)
    await page.getByLabel(/candidate run/i).selectOption(RUN_CAND)
    await page.waitForTimeout(700)
    await page.getByRole('button', { name: 'Compare', exact: true }).click()

    // Wait for the "Regression" verdict to land.
    await page.getByText('Regression', { exact: true }).waitFor({ timeout: 15_000 })
    await page.waitForTimeout(2200)

    // 3) Ease down to the changed-cases card.
    await page.evaluate(() => window.scrollTo({ top: 320, behavior: 'smooth' }))
    await page.waitForTimeout(1500)

    // 4) Expand the top regression (Hit@5 lost) — reveals the RankShift diff
    //    showing the canonical source falling from #1 to "not retrieved".
    await page.getByRole('button', { name: /How do I choose a chunk size/i }).click()
    await page.waitForTimeout(600)
    await page.evaluate(() => window.scrollTo({ top: 520, behavior: 'smooth' }))
    await page.waitForTimeout(2400)

    // 5) Expand the second (MRR down) for a beat, then hold.
    await page.getByRole('button', { name: /What is HNSW/i }).click()
    await page.waitForTimeout(600)
    await page.evaluate(() => window.scrollTo({ top: 760, behavior: 'smooth' }))
    await page.waitForTimeout(2200)
  })
})
