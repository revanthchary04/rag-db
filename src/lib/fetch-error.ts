/** Turn noisy HTML / stack-heavy messages into something safe for UI alerts. */
export function shortFetchError(message: string, maxLen = 420): string {
  const m = message?.trim() || ''
  if (!m) return 'Request failed.'
  const lower = m.toLowerCase()
  if (lower.includes('<!doctype') || lower.includes('<html')) {
    return (
      'The server returned an HTML error page instead of JSON. This often means a bad or stale ' +
      'Next.js build. From the repo root run: rm -rf .next && pnpm dev — then reload this page.'
    )
  }
  if (lower.includes('cannot find module') && lower.includes('.js')) {
    return 'Build or dev cache may be out of sync (missing JS chunk). Run: rm -rf .next && pnpm dev'
  }
  if (m.length <= maxLen) return m
  return `${m.slice(0, maxLen)}…`
}
