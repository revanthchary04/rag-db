'use client'

import type { Observability } from '@/lib/types'

function fmtCost(cost?: number): string | null {
  if (cost == null) return null
  if (cost === 0) return '$0'
  if (cost < 0.01) return `$${cost.toFixed(4)}`
  return `$${cost.toFixed(2)}`
}

type Item = { key: string; label: string; onClick?: () => void }

export function MessageObservability({
  data,
  citedCount,
  onChunksClick,
}: {
  data: Observability
  /** Number of chunks the LLM actually cited (matches what the panel displays). */
  citedCount?: number
  /** Opens the retrieved-chunks / citations panel above when the chunks stat is clicked. */
  onChunksClick?: () => void
}) {
  const totalTokens =
    data.tokenUsage &&
    (data.tokenUsage.total_tokens ??
      (data.tokenUsage.prompt_tokens ?? 0) + (data.tokenUsage.completion_tokens ?? 0))

  const items: Item[] = []
  if (typeof data.latencyMs === 'number')
    items.push({ key: 'latency', label: `${(data.latencyMs / 1000).toFixed(2)}s` })
  const cost = fmtCost(data.costUsd)
  if (cost) items.push({ key: 'cost', label: cost })
  if (typeof totalTokens === 'number' && totalTokens > 0)
    items.push({ key: 'tokens', label: `${totalTokens} tok` })
  if (typeof data.retrievedCount === 'number') {
    const cited = citedCount ?? data.retrievedCount
    const label =
      cited === data.retrievedCount
        ? `${data.retrievedCount} chunks`
        : `${cited} of ${data.retrievedCount} chunks`
    items.push({ key: 'chunks', label, onClick: onChunksClick })
  }
  if (data.ragModel) items.push({ key: 'model', label: data.ragModel })

  if (items.length === 0) return null

  return (
    <div
      className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground text-xs"
      data-testid="message-observability"
      title={data.queryLogId ? `query_log_id: ${data.queryLogId}` : undefined}
    >
      {items.map((item, i) => (
        <span className="flex items-center gap-2" key={item.key}>
          {i > 0 && <span className="text-muted-foreground/50">·</span>}
          {item.onClick ? (
            <button
              className="cursor-pointer underline decoration-dotted underline-offset-2 hover:text-foreground"
              onClick={item.onClick}
              type="button"
            >
              {item.label}
            </button>
          ) : (
            item.label
          )}
        </span>
      ))}
      {data.queryLogId && (
        <a
          className="underline decoration-dotted underline-offset-2 hover:text-foreground"
          href={`/query-logs?id=${data.queryLogId}`}
        >
          query log
        </a>
      )}
    </div>
  )
}
