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

export function MessageCitations({
  citations,
  open,
  onOpenChange,
  highlightIndex,
}: {
  citations: Citation[]
  /** Controlled open state (e.g. driven by an inline citation click). */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Index of a source to scroll to and emphasize. */
  highlightIndex?: number | null
}) {
  const [internalOpen, setInternalOpen] = useState(false)
  const isControlled = open !== undefined
  const isOpen = isControlled ? open : internalOpen
  const itemRefs = useRef<Array<HTMLLIElement | null>>([])

  const setOpen = (next: boolean) => {
    if (!isControlled) setInternalOpen(next)
    onOpenChange?.(next)
  }

  // Scroll the highlighted source into view when it changes while open.
  useEffect(() => {
    if (isOpen && highlightIndex != null) {
      itemRefs.current[highlightIndex]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [isOpen, highlightIndex])

  if (!citations || citations.length === 0) return null

  return (
    <div className="mt-1 flex flex-col gap-2" data-testid="message-citations">
      <Button
        className="w-fit gap-1.5 text-muted-foreground"
        onClick={() => setOpen(!isOpen)}
        size="sm"
        variant="outline"
      >
        <FileText className="size-3.5" />
        {citations.length} source{citations.length === 1 ? '' : 's'}
      </Button>

      {isOpen && (
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
