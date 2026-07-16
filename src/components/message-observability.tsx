'use client'

import type { Observability } from '@/lib/types'

function fmtCost(cost?: number): string | null {
  if (cost == null) return null
  if (cost === 0) return '$0'
  if (cost < 0.01) return `$${cost.toFixed(4)}`
  return `$${cost.toFixed(2)}`
}

export function MessageObservability({ data }: { data: Observability }) {
  const totalTokens =
    data.tokenUsage &&
    (data.tokenUsage.total_tokens ??
      (data.tokenUsage.prompt_tokens ?? 0) + (data.tokenUsage.completion_tokens ?? 0))

  const items: string[] = []
  if (typeof data.latencyMs === 'number') items.push(`${(data.latencyMs / 1000).toFixed(2)}s`)
  const cost = fmtCost(data.costUsd)
  if (cost) items.push(cost)
  if (typeof totalTokens === 'number' && totalTokens > 0) items.push(`${totalTokens} tok`)
  if (typeof data.retrievedCount === 'number') items.push(`${data.retrievedCount} chunks`)
  if (data.ragModel) items.push(data.ragModel)

  if (items.length === 0) return null

  return (
    <div
      className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground text-xs"
      data-testid="message-observability"
      title={data.queryLogId ? `query_log_id: ${data.queryLogId}` : undefined}
    >
      {items.map((item, i) => (
        <span className="flex items-center gap-2" key={item}>
          {i > 0 && <span className="text-muted-foreground/50">·</span>}
          {item}
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
