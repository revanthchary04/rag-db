import { test, expect } from '@playwright/test'

const RUN_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const RUN_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

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
    query: `query-${caseId}`,
    expected_sources: [] as string[],
    retrieved_sources: [] as string[],
    answer: 'answer',
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

test.describe('eval & observability (mocked API)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/backend/api/v1/health', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, db: true, version: '0.1.0' }),
      })
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
              id: '11111111-1111-1111-1111-111111111111',
              query_text: 'mock query one',
              rag_model: 'vector-similarity',
              top_k: 5,
              request_id: 'req-1',
              client_ip: '127.0.0.1',
              user_agent: 'playwright',
              latency_ms: 120,
              token_usage: { total: 100 },
              cost_usd: 0.001,
              citations_count: 2,
              answer_length: 400,
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
              request_count: 3,
              status_counts: { '200': 3 },
              latency_buckets: {},
              avg_latency_ms: 100,
              total_latency_ms: 300,
            },
          },
          token_usage: {
            embedding_prompt_tokens: 0,
            embedding_total_tokens: 0,
            chat_prompt_tokens: 10,
            chat_completion_tokens: 20,
            chat_total_tokens: 30,
          },
          note: 'mock',
        }),
      })
    })
  })

  test('eval runs list', async ({ page }) => {
    await page.goto('/eval/runs')
    await expect(page.getByRole('heading', { name: 'Eval runs' })).toBeVisible()
    await expect(
      page.getByRole('link', { name: new RegExp(RUN_A.slice(0, 8)) }).first()
    ).toBeVisible()
  })

  test('eval run detail by query param', async ({ page }) => {
    await page.goto(`/eval/runs?id=${RUN_A}`)
    await expect(page.getByRole('heading', { name: 'Eval run' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'JSON' })).toBeVisible()
    await expect(page.getByText('query-case-1')).toBeVisible()
  })

  test('compare runs shows verdict and changed cases', async ({ page }) => {
    // RUN_A (Hit@5 1.0) → RUN_B (Hit@5 0.5): case-1 regresses, case-2 improves.
    await page.goto(`/eval/runs?compare=${RUN_A}&to=${RUN_B}`)
    await expect(page.getByRole('heading', { name: 'Compare eval runs' })).toBeVisible()
    // Verdict banner (gate logic: gated metric dropped beyond tolerance).
    await expect(page.getByText('Regression', { exact: true })).toBeVisible()
    // Changed-cases-only list, keyed by case_id.
    await expect(page.getByText('2 cases changed')).toBeVisible()
    await expect(page.getByText('case-1').first()).toBeVisible()
  })

  test('query logs explorer loads mocked rows', async ({ page }) => {
    await page.goto('/query-logs')
    await expect(page.getByRole('heading', { name: 'Query logs' })).toBeVisible()
    await expect(page.getByText('mock query one')).toBeVisible()
  })

  test('metrics page loads mocked counters', async ({ page }) => {
    await page.goto('/metrics')
    await expect(page.getByRole('heading', { name: 'Pipeline metrics' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Query logs' })).toBeVisible()
  })
})
