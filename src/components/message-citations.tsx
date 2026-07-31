'use client'

import { useEffect, useRef, useState } from 'react'
import { FileText } from 'lucide-react'
import type { Citation } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** Compact relevance meter — the retrieval score as a number plus a mono bar. */
function ScoreMeter({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(1, score)) * 100
  return (
    <span
      className="flex shrink-0 items-center gap-1.5"
      title={`Retrieval score ${score.toFixed(3)}`}
    >
      <span className="h-1 w-10 overflow-hidden rounded-full bg-muted">
        <span className="block h-full rounded-full bg-foreground/70" style={{ width: `${pct}%` }} />
      </span>
      <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
        {score.toFixed(2)}
      </span>
    </span>
  )
}

export type CitationsMode = 'sources' | 'chunks'

/** One unique source document rolled up from citations that share it. */
type SourceGroup = {
  key: string
  title: string
  source: string
  chunkCount: number
  topScore: number | null
}

function groupBySource(citations: Citation[]): SourceGroup[] {
  const map = new Map<string, SourceGroup>()
  for (const c of citations) {
    const key = c.document_id || c.source || c.title || 'unknown'
    const existing = map.get(key)
    if (existing) {
      existing.chunkCount += 1
      if (typeof c.score === 'number') {
        existing.topScore =
          existing.topScore == null ? c.score : Math.max(existing.topScore, c.score)
      }
    } else {
      map.set(key, {
        key,
        title: c.title || c.source || 'Untitled',
        source: c.source || '',
        chunkCount: 1,
        topScore: typeof c.score === 'number' ? c.score : null,
      })
    }
  }
  return [...map.values()]
}

export function MessageCitations({
  citations,
  mode,
  onModeChange,
  highlightIndex,
}: {
  citations: Citation[]
  /** Which panel to show (controlled). Null closes the panel. */
  mode?: CitationsMode | null
  onModeChange?: (mode: CitationsMode | null) => void
  /** Index of a chunk to scroll to and emphasize (only in chunks mode). */
  highlightIndex?: number | null
}) {
  const [internalMode, setInternalMode] = useState<CitationsMode | null>(null)
  const isControlled = mode !== undefined
  const activeMode = isControlled ? mode : internalMode
  const itemRefs = useRef<Array<HTMLLIElement | null>>([])

  const toggleMode = (next: CitationsMode) => {
    const resolved = activeMode === next ? null : next
    if (!isControlled) setInternalMode(resolved)
    onModeChange?.(resolved)
  }

  useEffect(() => {
    if (activeMode === 'chunks' && highlightIndex != null) {
      itemRefs.current[highlightIndex]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [activeMode, highlightIndex])

  if (!citations || citations.length === 0) return null

  const sourceGroups = groupBySource(citations)
  const uniqueDocs = sourceGroups.length

  return (
    <div className="mt-1 flex flex-col gap-2" data-testid="message-citations">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          className="w-fit gap-1.5 text-muted-foreground"
          onClick={() => toggleMode('sources')}
          size="sm"
          variant={activeMode === 'sources' ? 'secondary' : 'outline'}
        >
          <FileText className="size-3.5" />
          {uniqueDocs} source{uniqueDocs === 1 ? '' : 's'}
        </Button>
      </div>

      {activeMode === 'sources' && (
        <ol className="flex flex-col gap-1 rounded-lg border bg-muted/30 p-1.5 text-sm">
          {sourceGroups.map((g, i) => (
            <li
              className="flex items-start gap-2.5 rounded-md px-2 py-2 hover:bg-muted/60"
              key={g.key}
            >
              <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded bg-background ring-1 ring-border">
                <FileText className="size-3 text-muted-foreground" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-medium text-foreground">{g.title}</span>
                  {g.topScore != null && <ScoreMeter score={g.topScore} />}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  {g.source && g.source !== g.title && (
                    <>
                      <span className="truncate font-mono">{g.source}</span>
                      <span className="text-muted-foreground/40">·</span>
                    </>
                  )}
                  <span className="shrink-0">
                    {g.chunkCount} chunk{g.chunkCount === 1 ? '' : 's'} cited
                  </span>
                </div>
              </div>
              <span className="mt-0.5 shrink-0 font-mono text-[11px] text-muted-foreground">
                #{i + 1}
              </span>
            </li>
          ))}
        </ol>
      )}

      {activeMode === 'chunks' && (
        <ol className="flex flex-col gap-1 rounded-lg border bg-muted/30 p-1.5 text-sm">
          {citations.map((c, i) => (
            <li
              className={cn(
                'flex items-start gap-2.5 rounded-md px-2 py-2 transition-colors',
                highlightIndex === i ? 'bg-accent ring-1 ring-ring' : 'hover:bg-muted/60'
              )}
              key={`${c.chunk_id}-${i}`}
              ref={el => {
                itemRefs.current[i] = el
              }}
            >
              <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded bg-background font-mono text-xs font-medium ring-1 ring-border">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-medium text-foreground">
                    {c.title || c.source || 'Untitled'}
                  </span>
                  {typeof c.score === 'number' && <ScoreMeter score={c.score} />}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  {c.source && c.source !== c.title && (
                    <span className="truncate font-mono">{c.source}</span>
                  )}
                  {c.source && c.source !== c.title && (
                    <span className="text-muted-foreground/40">·</span>
                  )}
                  <span className="shrink-0">chunk #{c.chunk_index}</span>
                </div>
                {c.content_snippet && (
                  <p className="mt-1.5 line-clamp-3 rounded bg-background/70 px-2.5 py-1.5 text-xs leading-relaxed text-muted-foreground ring-1 ring-border/60">
                    {c.content_snippet}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

