'use client'

import type { UseChatHelpers } from '@ai-sdk/react'
import equal from 'fast-deep-equal'
import { memo, useCallback, useMemo, useState } from 'react'
import type { Citation, ChatMessage, Observability } from '@/lib/types'
import { cn, sanitizeText } from '@/lib/utils'
import { MessageContent } from './elements/message'
import { Response } from './elements/response'
import { SparklesIcon } from './icons'
import { createCitationComponents } from './inline-citations'
import { MessageActions } from './message-actions'
import { MessageCitations } from './message-citations'
import { MessageObservability } from './message-observability'

const PurePreviewMessage = ({
  message,
  isLoading,
  regenerate,
  isReadonly,
}: {
  chatId: string
  message: ChatMessage
  isLoading: boolean
  setMessages: UseChatHelpers<ChatMessage>['setMessages']
  regenerate: UseChatHelpers<ChatMessage>['regenerate']
  isReadonly: boolean
  requiresScrollPadding: boolean
}) => {
  // Citations arrive as their own message part; pull them up so the answer text
  // (rendered first) can turn [n] refs into chips that open this list.
  const citations =
    (message.parts?.find(part => part.type === 'data-citations')?.data as Citation[] | undefined) ??
    []
  const [citationsOpen, setCitationsOpen] = useState(false)
  const [highlightIndex, setHighlightIndex] = useState<number | null>(null)

  const handleCitationClick = useCallback((n: number) => {
    setHighlightIndex(n - 1)
    setCitationsOpen(true)
  }, [])

  const citationComponents = useMemo(
    () =>
      message.role === 'assistant'
        ? createCitationComponents(handleCitationClick, citations.length)
        : undefined,
    [message.role, citations.length, handleCitationClick]
  )

  return (
    <div
      className="group/message fade-in w-full animate-in duration-200"
      data-role={message.role}
      data-testid={`message-${message.role}`}
    >
      <div
        className={cn('flex w-full items-start gap-2 md:gap-3', {
          'justify-end': message.role === 'user',
          'justify-start': message.role === 'assistant',
        })}
      >
        {message.role === 'assistant' && (
          <div className="-mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-background ring-1 ring-border">
            <SparklesIcon size={14} />
          </div>
        )}

        <div
          className={cn('flex flex-col gap-2 md:gap-4', {
            'w-full': message.role === 'assistant',
            'max-w-[calc(100%-2.5rem)] sm:max-w-[min(fit-content,80%)]': message.role === 'user',
          })}
        >
          {message.parts?.map((part, index) => {
            const key = `message-${message.id}-part-${index}`

            if (part.type === 'text') {
              return (
                <div key={key}>
                  <MessageContent
                    className={cn({
                      'w-fit break-words rounded-2xl bg-primary px-4 py-2.5 text-left text-primary-foreground':
                        message.role === 'user',
                      'bg-transparent px-0 py-0 text-left': message.role === 'assistant',
                    })}
                    data-testid="message-content"
                  >
                    <Response components={citationComponents}>{sanitizeText(part.text)}</Response>
                  </MessageContent>
                </div>
              )
            }

            if (part.type === 'data-citations') {
              return (
                <MessageCitations
                  citations={part.data as Citation[]}
                  highlightIndex={highlightIndex}
                  key={key}
                  onOpenChange={setCitationsOpen}
                  open={citationsOpen}
                />
              )
            }

            if (part.type === 'data-observability') {
              return <MessageObservability data={part.data as Observability} key={key} />
            }

            return null
          })}

          {isLoading && message.role === 'assistant' && (
            <span className="sr-only">Generating…</span>
          )}

          {message.role === 'assistant' && (
            <MessageActions
              isLoading={isLoading}
              isReadonly={isReadonly}
              message={message}
              regenerate={regenerate}
            />
          )}
        </div>
      </div>
    </div>
  )
}

export const PreviewMessage = memo(PurePreviewMessage, (prev, next) => {
  if (prev.isLoading !== next.isLoading) return false
  if (prev.message.id !== next.message.id) return false
  if (!equal(prev.message.parts, next.message.parts)) return false
  return true
})

export const ThinkingMessage = () => {
  return (
    <div
      className="group/message fade-in w-full animate-in duration-300"
      data-role="assistant"
      data-testid="message-assistant-loading"
    >
      <div className="flex items-start justify-start gap-3">
        <div className="-mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-background ring-1 ring-border">
          <div className="animate-pulse">
            <SparklesIcon size={14} />
          </div>
        </div>
        <div className="flex w-full flex-col gap-2 md:gap-4">
          <div className="flex items-center gap-1 p-0 text-muted-foreground text-sm">
            <span className="animate-pulse">Retrieving</span>
            <span className="inline-flex">
              <span className="animate-bounce [animation-delay:0ms]">.</span>
              <span className="animate-bounce [animation-delay:150ms]">.</span>
              <span className="animate-bounce [animation-delay:300ms]">.</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
