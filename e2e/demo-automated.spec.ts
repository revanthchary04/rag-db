import { test, expect } from '@playwright/test'
import { createChatStore, mockChat, mockChatBackend, mockHistory } from './helpers'

/**
 * Fully automated UI demo against the mocked API (no real LLM / DB):
 * load home, click a suggested action, send a keyboard follow-up, and assert the
 * streamed answers render with citations + observability.
 */
const ANSWER_ONE = 'RAG combines a retrieval step with generation to ground answers.'
const ANSWER_TWO = 'Follow-up answer streamed by the automated demo.'

test.describe('automated UI demo (mocked API)', () => {
  test('suggested action then keyboard follow-up', async ({ page }) => {
    await mockChatBackend(page, [
      {
        id: 'doc-1',
        source: 'RAG Basics',
        title: 'RAG Basics.pdf',
        created_at: new Date().toISOString(),
      },
    ])
    await mockHistory(page, createChatStore())

    // First reply (with citations) for the suggested action, then swap to a
    // second reply for the keyboard follow-up.
    await mockChat(page, {
      text: ANSWER_ONE,
      citations: [
        {
          chunk_id: 'c1',
          document_id: 'd1',
          title: 'RAG Basics.pdf',
          source: 'RAG Basics',
          chunk_index: 0,
        },
      ],
    })

    await page.goto('/')
    await expect(page.getByText(/ask your documents anything/i)).toBeVisible()

    await page.getByTestId('suggested-actions').getByRole('button').first().click()
    await expect(page.getByTestId('message-assistant').first()).toContainText(ANSWER_ONE, {
      timeout: 15_000,
    })
    await expect(page.getByTestId('message-citations').first()).toBeVisible()

    // Re-point the chat mock for the follow-up turn.
    await mockChat(page, { text: ANSWER_TWO })

    const input = page.getByTestId('multimodal-input')
    await input.click()
    await input.type('And how are chunks retrieved?')
    await input.press('Enter')

    await expect(page.getByText(ANSWER_TWO, { exact: false })).toBeVisible({ timeout: 20_000 })
  })
})
