'use client'

import type { UseChatHelpers } from '@ai-sdk/react'
import equal from 'fast-deep-equal'
import { CheckIcon, CopyIcon, RefreshCcwIcon } from 'lucide-react'
import { memo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { ChatMessage } from '@/lib/types'
import { toast } from './toast'

function PureMessageActions({
  message,
  regenerate,
  isLoading,
  isReadonly,
}: {
  message: ChatMessage
  regenerate: UseChatHelpers<ChatMessage>['regenerate']
  isLoading: boolean
  isReadonly: boolean
}) {
  const [copied, setCopied] = useState(false)

  // Only offer actions on completed assistant answers.
  if (isLoading || isReadonly || message.role !== 'assistant') return null

  const answerText = message.parts
    ?.filter(part => part.type === 'text')
    .map(part => part.text)
    .join('\n')
    .trim()

  const handleCopy = async () => {
    if (!answerText) {
      toast({ type: 'error', description: "There's no text to copy." })
      return
    }
    try {
      await navigator.clipboard.writeText(answerText)
      setCopied(true)
      toast({ type: 'success', description: 'Copied answer to clipboard.' })
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      toast({ type: 'error', description: 'Could not copy to clipboard.' })
    }
  }

  return (
    <TooltipProvider>
      <div className="flex items-center gap-1" data-testid="message-actions">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label="Copy answer"
              className="size-7 text-muted-foreground"
              onClick={() => void handleCopy()}
              size="icon"
              variant="ghost"
            >
              {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Copy</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label="Regenerate answer"
              className="size-7 text-muted-foreground"
              onClick={() => void regenerate({ messageId: message.id })}
              size="icon"
              variant="ghost"
            >
              <RefreshCcwIcon className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Regenerate</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  )
}

export const MessageActions = memo(PureMessageActions, (prev, next) => {
  if (prev.isLoading !== next.isLoading) return false
  if (prev.isReadonly !== next.isReadonly) return false
  if (prev.message.id !== next.message.id) return false
  if (!equal(prev.message.parts, next.message.parts)) return false
  return true
})
