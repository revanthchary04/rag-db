import { test, expect } from '@playwright/test'
import { createChatStore, mockChat, mockChatBackend, mockHistory } from './helpers'

const MOCK_ANSWER = 'Retrieval-augmented generation grounds answers in retrieved documents.'

const CITATIONS = [
  {
    chunk_id: 'c1',
    document_id: 'd1',
    title: 'RAG Basics.pdf',
    source: 'RAG Basics',
    chunk_index: 0,
  },
  {
    chunk_id: 'c2',
    document_id: 'd1',
    title: 'RAG Basics.pdf',
    source: 'RAG Basics',
    chunk_index: 1,
  },
]

test.describe('chat with mocked /api/chat stream', () => {
  test.beforeEach(async ({ page }) => {
    await mockChatBackend(page)
    await mockHistory(page, createChatStore())
    await mockChat(page, {
      text: MOCK_ANSWER,
      citations: CITATIONS,
      observability: {
        latencyMs: 2500,
        costUsd: 0.0012,
        ragModel: 'vector-similarity',
        queryLogId: 'e2e-query-log',
        retrievedCount: 2,
        tokenUsage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
      },
    })
  })

  test('streams the assistant answer with citations and observability', async ({ page }) => {
    await page.goto('/')

    await page.getByTestId('multimodal-input').fill('What is retrieval-augmented generation?')
    await page.getByTestId('send-button').click()

    const assistant = page.getByTestId('message-assistant')
    await expect(assistant).toContainText(MOCK_ANSWER, { timeout: 15_000 })

    await expect(page.getByTestId('message-citations')).toContainText(/2 sources/i)
    const obs = page.getByTestId('message-observability')
    await expect(obs).toContainText('2.50s')
    await expect(obs).toContainText('vector-similarity')
    await expect(obs).toContainText('2 chunks')
  })

  test('clicking a suggested action sends that query', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('suggested-actions').getByRole('button').first().click()
    await expect(page.getByTestId('message-assistant')).toContainText(MOCK_ANSWER, {
      timeout: 15_000,
    })
  })
})
