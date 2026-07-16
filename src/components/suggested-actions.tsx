'use client'

import type { UseChatHelpers } from '@ai-sdk/react'
import { motion, useReducedMotion } from 'framer-motion'
import { ArrowUpRight, GitMerge, LayoutGrid, Search, Waypoints } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { memo } from 'react'
import { DEMO_EXAMPLE_QUERIES } from '@/lib/demo-example-queries'
import type { ChatMessage } from '@/lib/types'
import { cn } from '@/lib/utils'

type SuggestedActionsProps = {
  chatId: string
  sendMessage: UseChatHelpers<ChatMessage>['sendMessage']
}

const ICONS: Record<string, LucideIcon> = {
  'rag-basics': GitMerge,
  embeddings: Waypoints,
  chunking: LayoutGrid,
  retrieval: Search,
}

function PureSuggestedActions({ chatId, sendMessage }: SuggestedActionsProps) {
  const reduceMotion = useReducedMotion()
  const suggestedActions = DEMO_EXAMPLE_QUERIES.slice(0, 4)

  return (
    <div className="grid w-full gap-2.5 sm:grid-cols-2" data-testid="suggested-actions">
      {suggestedActions.map((action, index) => {
        const Icon = ICONS[action.id] ?? GitMerge
        return (
          <motion.button
            animate={{ opacity: 1, y: 0 }}
            className={cn(
              'group flex flex-col gap-2.5 rounded-xl border border-border bg-card/40 p-3.5 text-left',
              'transition-[transform,border-color,background-color] duration-150 ease-out',
              'hover:border-foreground/25 hover:bg-accent/50 active:scale-[0.985]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'
            )}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10 }}
            key={action.id}
            onClick={() => {
              window.history.replaceState({}, '', `/chat/${chatId}`)
              sendMessage({ role: 'user', parts: [{ type: 'text', text: action.prompt }] })
            }}
            transition={{ delay: reduceMotion ? 0 : 0.04 * index, duration: 0.3 }}
            type="button"
          >
            <div className="flex w-full items-start justify-between gap-2">
              <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
              <ArrowUpRight className="size-4 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground" />
            </div>
            <span className="text-sm leading-snug text-foreground">{action.label}</span>
            <span className="text-xs text-muted-foreground">{action.topic}</span>
          </motion.button>
        )
      })}
    </div>
  )
}

export const SuggestedActions = memo(
  PureSuggestedActions,
  (prev, next) => prev.chatId === next.chatId
)
