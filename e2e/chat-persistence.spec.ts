import { test, expect } from '@playwright/test'
import { createChatStore, mockChat, mockChatBackend, mockHistory } from './helpers'

/**
 * Chat persistence is owned by Drizzle server-side, so a full reload of a
 * server-rendered /chat/[id] needs a real DB (covered by the integration
 * suite). Here we verify the browser-observable half: after a turn, the chat
 * is recorded and the sidebar history refetches and shows it.
 */
test('new chat shows in sidebar history after sending', async ({ page, context, baseURL }) => {
  const store = createChatStore()
  await mockChatBackend(page)
  await mockHistory(page, store)
  await mockChat(page, { store, text: 'Persisted mock reply.' })

  // Open the sidebar (server layout reads this cookie for defaultOpen).
  await context.addCookies([
    { name: 'sidebar_state', value: 'true', url: baseURL ?? 'http://127.0.0.1:4173' },
  ])

  await page.goto('/')
  await page.getByTestId('multimodal-input').fill('Hello persistence')
  await page.getByTestId('send-button').click()

  await expect(page.getByTestId('message-assistant')).toContainText('Persisted mock reply.', {
    timeout: 15_000,
  })

  // onFinish revalidates the history SWR key; the new chat appears as a link.
  await expect(page.getByRole('link', { name: /Hello persistence/i })).toBeVisible({
    timeout: 10_000,
  })
})
