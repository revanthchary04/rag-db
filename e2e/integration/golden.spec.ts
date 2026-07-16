import { test, expect } from '@playwright/test'

/**
 * Real stack: Next.js → local FastAPI + Postgres (started by the CI workflow),
 * with real Auth.js (guest) + Drizzle. No mocks, and no OpenAI (a RAG chat turn
 * needs a key), so we assert the app boots, authenticates a guest against the
 * real DB, and proxies to the real backend.
 * Run locally only when API + DB are up and PW_INTEGRATION=1 (see DEVELOPMENT.md).
 */
test('real stack boots: guest session, chat shell, and backend proxy', async ({ page }) => {
  await page.goto('/')

  // Rendering the greeting proves middleware → guest sign-in (real User insert)
  // → session → server render all succeeded against the real DB.
  await expect(page.getByText(/ask your documents anything/i)).toBeVisible({ timeout: 60_000 })
  await expect(page.getByTestId('multimodal-input')).toBeVisible()

  // The sidebar Documents section fetches from the real FastAPI via the proxy;
  // an empty e2e DB shows the empty state, proving connectivity end-to-end.
  await expect(page.getByText(/no documents yet/i)).toBeVisible({ timeout: 60_000 })
})
