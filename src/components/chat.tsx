'use client'

import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { useSWRConfig } from 'swr'
import { unstable_serialize } from 'swr/infinite'
import { ChatHeader } from '@/components/chat-header'
import { useRagSettings, type RagModel } from '@/features/settings/useRagSettings'
import { ChatSDKError } from '@/lib/errors'
import type { ChatMessage } from '@/lib/types'
import { generateUUID } from '@/lib/utils'
import { Messages } from './messages'
import { MultimodalInput } from './multimodal-input'
import { getChatHistoryPaginationKey } from './sidebar-history'
import { toast } from './toast'
import type { VisibilityType } from './visibility-selector'

export function Chat({
  id,
  initialMessages,
  initialChatModel,
  initialVisibilityType,
  isReadonly,
}: {
  id: string
  initialMessages: ChatMessage[]
  initialChatModel: string
  initialVisibilityType: VisibilityType
  isReadonly: boolean
  autoResume?: boolean
}) {
  const { mutate } = useSWRConfig()
  const { settings, setRagModel } = useRagSettings()

  const [input, setInput] = useState('')
  const [currentModelId, setCurrentModelId] = useState(initialChatModel)
  const modelRef = useRef(currentModelId)
  const topKRef = useRef(settings.topK)
  useEffect(() => {
    modelRef.current = currentModelId
  }, [currentModelId])
  useEffect(() => {
    topKRef.current = settings.topK
  }, [settings.topK])

  const { messages, setMessages, sendMessage, status, stop, regenerate } = useChat<ChatMessage>({
    id,
    messages: initialMessages,
    experimental_throttle: 100,
    generateId: generateUUID,
    transport: new DefaultChatTransport({
      api: '/api/chat',
      prepareSendMessagesRequest(request) {
        return {
          body: {
            id: request.id,
            message: request.messages.at(-1),
            selectedChatModel: modelRef.current,
            selectedVisibilityType: initialVisibilityType,
            topK: topKRef.current,
            ...request.body,
          },
        }
      },
    }),
    onFinish: () => {
      mutate(unstable_serialize(getChatHistoryPaginationKey))
    },
    onError: error => {
      if (error instanceof ChatSDKError) {
        toast({ type: 'error', description: error.message })
      } else {
        toast({ type: 'error', description: 'Something went wrong. Please try again.' })
      }
    },
  })

  const searchParams = useSearchParams()
  const query = searchParams.get('query')
  const [hasAppendedQuery, setHasAppendedQuery] = useState(false)

  useEffect(() => {
    if (query && !hasAppendedQuery) {
      sendMessage({ role: 'user', parts: [{ type: 'text', text: query }] })
      setHasAppendedQuery(true)
      window.history.replaceState({}, '', `/chat/${id}`)
    }
  }, [query, sendMessage, hasAppendedQuery, id])

  const handleModelChange = (model: RagModel) => {
    setCurrentModelId(model)
    setRagModel(model)
  }

  return (
    <div className="overscroll-behavior-contain flex h-dvh min-w-0 touch-pan-y flex-col bg-background">
      <h1 className="sr-only">RAG Eval chat</h1>
      <ChatHeader
        chatId={id}
        isReadonly={isReadonly}
        onModelChange={handleModelChange}
        selectedModelId={currentModelId}
      />

      <Messages
        chatId={id}
        isReadonly={isReadonly}
        messages={messages}
        regenerate={regenerate}
        sendMessage={sendMessage}
        setMessages={setMessages}
        status={status}
      />

      <div className="sticky bottom-0 z-1 mx-auto flex w-full max-w-4xl gap-2 border-t-0 bg-background px-2 pb-3 md:px-4 md:pb-4">
        {!isReadonly && (
          <MultimodalInput
            chatId={id}
            input={input}
            sendMessage={sendMessage}
            setInput={setInput}
            status={status}
            stop={stop}
          />
        )}
      </div>
    </div>
  )
}
