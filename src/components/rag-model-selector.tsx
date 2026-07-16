'use client'

import { startTransition, useMemo, useOptimistic } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import type { RagModel } from '@/features/settings/useRagSettings'
import { CheckCircleFillIcon, ChevronDownIcon } from './icons'

export const RAG_STRATEGIES: { id: RagModel; label: string; description: string }[] = [
  {
    id: 'vector-similarity',
    label: 'Vector similarity',
    description: 'Dense embedding cosine search',
  },
  { id: 'hybrid-search', label: 'Hybrid search', description: 'Dense vectors + BM25 keywords' },
  { id: 'reranking', label: 'Reranking', description: 'Retrieve then re-rank top matches' },
  { id: 'multi-query', label: 'Multi-query', description: 'Fan out into several sub-queries' },
]

export function RagModelSelector({
  selectedModelId,
  onModelChange,
  className,
}: {
  selectedModelId: string
  onModelChange?: (id: RagModel) => void
  className?: string
}) {
  const [optimisticModelId, setOptimisticModelId] = useOptimistic(selectedModelId)

  const selected = useMemo(
    () => RAG_STRATEGIES.find(s => s.id === optimisticModelId) ?? RAG_STRATEGIES[0],
    [optimisticModelId]
  )

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild className={cn('w-fit', className)}>
        <Button
          aria-label={`Retrieval strategy: ${selected.label}`}
          className="h-8 gap-2 border-border bg-card font-medium shadow-sm md:h-fit md:px-2.5"
          data-testid="rag-model-selector"
          variant="outline"
        >
          <span aria-hidden className="size-1.5 rounded-full bg-foreground" />
          {selected.label}
          <ChevronDownIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[300px]">
        {RAG_STRATEGIES.map(strategy => (
          <DropdownMenuItem
            className="group/item flex flex-row items-center justify-between gap-4"
            data-active={strategy.id === optimisticModelId}
            key={strategy.id}
            onSelect={() => {
              startTransition(() => {
                setOptimisticModelId(strategy.id)
                onModelChange?.(strategy.id)
              })
            }}
          >
            <div className="flex flex-col items-start gap-1">
              <span>{strategy.label}</span>
              <span className="text-muted-foreground text-xs">{strategy.description}</span>
            </div>
            <div className="text-foreground opacity-0 group-data-[active=true]/item:opacity-100">
              <CheckCircleFillIcon />
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
