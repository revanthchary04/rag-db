'use client'

import type { UseChatHelpers } from '@ai-sdk/react'
import { memo, useCallback } from 'react'
import {
  PromptInput,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
  PromptInputTools,
} from '@/components/elements/prompt-input'
import type { ChatMessage } from '@/lib/types'

function PureMultimodalInput({
  chatId,
  input,
  setInput,
  status,
  stop,
  sendMessage,
}: {
  chatId: string
  input: string
  setInput: (value: string) => void
  status: UseChatHelpers<ChatMessage>['status']
  stop: () => void
  sendMessage: UseChatHelpers<ChatMessage>['sendMessage']
}) {
  const submit = useCallback(() => {
    const text = input.trim()
    if (!text) return
    window.history.replaceState({}, '', `/chat/${chatId}`)
    sendMessage({ role: 'user', parts: [{ type: 'text', text }] })
    setInput('')
  }, [input, chatId, sendMessage, setInput])

  return (
    <div className="flex w-full flex-col gap-3">
      <PromptInput
        onSubmit={e => {
          e.preventDefault()
          if (status === 'streaming' || status === 'submitted') {
            stop()
          } else {
            submit()
          }
        }}
      >
        <PromptInputTextarea
          data-testid="multimodal-input"
          onChange={e => setInput(e.currentTarget.value)}
          placeholder="Ask about your documents…"
          value={input}
        />
        <PromptInputToolbar>
          <PromptInputTools />
          <PromptInputSubmit
            aria-label={
              status === 'streaming' || status === 'submitted' ? 'Stop generating' : 'Send message'
            }
            className="size-8 rounded-full"
            data-testid="send-button"
            disabled={status === 'ready' && !input.trim()}
            status={status}
          />
        </PromptInputToolbar>
      </PromptInput>
    </div>
  )
}

export const MultimodalInput = memo(PureMultimodalInput)
