import { chromium } from '@playwright/test'

const BASE = process.argv[2] || 'https://pob-rag-chat.xyz'
const OUT = process.argv[3] || 'docs/images/live'

const browser = await chromium.launch()
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: 'dark',
})
const page = await ctx.newPage()

async function shot(path, name, { waitMs = 2500, full = false } = {}) {
  const url = `${BASE}${path}`
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 })
  } catch {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 })
  }
  await page.waitForTimeout(waitMs)
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full })
  console.log('shot', name, '->', page.url())
}

// establish guest session on first visit (auto-redirect sets cookie)
await shot('/', 'chat-empty', { waitMs: 3500 })
await shot('/query-logs', 'query-logs', { waitMs: 3500 })
await shot('/eval/runs', 'eval-runs', { waitMs: 3500 })
await shot('/metrics', 'metrics', { waitMs: 3500 })

await browser.close()
console.log('done')
