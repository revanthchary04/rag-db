import { defineConfig, devices } from '@playwright/test'

const integration = process.env.PW_INTEGRATION === '1'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
  },
  projects: integration
    ? [
        {
          name: 'integration',
          testMatch: /integration\/.*\.spec\.ts/,
          use: { ...devices['Desktop Chrome'] },
        },
      ]
    : [{ name: 'chromium', testIgnore: /integration\/.*/, use: { ...devices['Desktop Chrome'] } }],
  webServer: integration
    ? undefined
    : {
        command: 'pnpm exec next start -H 127.0.0.1 -p 4173',
        // Probe /ping (middleware returns 200) so readiness doesn't chase the
        // guest-auth redirect loop that an unauthenticated GET / triggers.
        url: 'http://127.0.0.1:4173/ping',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: {
          // Enables the test-env auth bypass (stub guest + non-secure cookies)
          // so the mocked specs run without a real Postgres.
          PLAYWRIGHT: 'True',
          AUTH_SECRET: process.env.AUTH_SECRET || 'playwright-test-secret-not-for-production',
          // `next start` runs in production mode where Auth.js requires a trusted host.
          AUTH_TRUST_HOST: 'true',
        },
      },
})
