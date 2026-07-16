import { chromium } from '@playwright/test'
import { pathToFileURL } from 'node:url'

const src = process.argv[2]
const out = process.argv[3]

const browser = await chromium.launch()
const page = await browser.newPage({
  viewport: { width: 1280, height: 640 },
  deviceScaleFactor: 2,
})
await page.goto(pathToFileURL(src).href, { waitUntil: 'networkidle' })
await page.screenshot({ path: out, clip: { x: 0, y: 0, width: 1280, height: 640 } })
await browser.close()
console.log('wrote', out)
