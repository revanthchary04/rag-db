import { createUIMessageStream, JsonToSseTransformStream } from 'ai'
import { auth } from '@/app/(auth)/auth'
import { estimateChatMessageCostUsd } from '@/lib/openai-pricing'
import {
  deleteMessagesByChatIdAfterTimestamp,
  getChatById,
  getMessageById,
  saveChat,
  saveMessages,
  touchChat,
} from '@/lib/db/queries'
import { ChatSDKError } from '@/lib/errors'
import type { Citation, ChatMessage, Observability } from '@/lib/types'
import { generateUUID, getTextFromMessage } from '@/lib/utils'
import { generateTitleFromUserMessage } from '../../actions'
import { postRequestBodySchema, type PostRequestBody } from './schema'

export const maxDuration = 60

// `BACKEND_*` are the canonical names; `AZURE_*` kept as a back-compat fallback
// for existing deployments. Despite the legacy name, this is just the FastAPI origin.
const BACKEND_BASE =
  process.env.BACKEND_API_BASE_URL || process.env.AZURE_API_BASE_URL || 'http://localhost:8000'
const BACKEND_KEY = (process.env.BACKEND_API_KEY || process.env.AZURE_API_BACKEND_KEY)?.trim()

/** Normalize backend citation payloads (snake/camel) into our Citation shape. */
function mapCitations(raw: unknown): Citation[] {
  return ((raw as unknown[]) || []).map(cit => {
    const c = cit as Record<string, unknown>
    return {
      chunk_id: (c.chunk_id || c.chunkId || '') as string,
      document_id: (c.document_id || c.documentId || '') as string,
      title: (c.title ?? null) as string | null,
      source: (c.source || '') as string,
      chunk_index: (c.chunk_index || c.chunkIndex || 0) as number,
      content_snippet: (c.content_snippet ?? c.contentSnippet ?? undefined) as string | undefined,
      score: (typeof c.score === 'number' ? c.score : undefined) as number | undefined,
    }
  })
}

export async function POST(request: Request) {
  let requestBody: PostRequestBody
  try {
    requestBody = postRequestBodySchema.parse(await request.json())
  } catch {
    return new ChatSDKError('bad_request:api').toResponse()
  }

  const session = await auth()
  if (!session?.user) {
    return new ChatSDKError('unauthorized:chat').toResponse()
  }

  const { id, message, selectedChatModel, selectedVisibilityType, topK, filters } = requestBody

  const existingChat = await getChatById({ id })

  if (existingChat) {
    if (existingChat.userId !== session.user.id) {
      return new ChatSDKError('forbidden:chat').toResponse()
    }
  } else {
    const title = await generateTitleFromUserMessage({ message: message as ChatMessage })
    await saveChat({
      id,
      userId: session.user.id,
      title,
      visibility: selectedVisibilityType ?? 'private',
    })
  }

  // Regenerate: the AI SDK re-sends an existing user message. Drop anything that
  // trailed it (the superseded assistant answer) so the turn keeps one answer.
  const existingUserMessage = await getMessageById({ id: message.id })
  if (existingUserMessage) {
    await deleteMessagesByChatIdAfterTimestamp({
      chatId: id,
      timestamp: existingUserMessage.createdAt,
    })
  }

  // Persist the user turn immediately (mirrors the template).
  await saveMessages({
    messages: [
      {
        chatId: id,
        id: message.id,
        role: 'user',
        parts: message.parts,
        attachments: [],
        createdAt: new Date(),
        citations: null,
        metadata: null,
        latencyMs: null,
        costUsd: null,
        ragModel: null,
        requestId: null,
        queryLogId: null,
        evalRunId: null,
        evalCaseId: null,
      },
    ],
  })

  const query = getTextFromMessage(message as ChatMessage)

  // Captured from the backend `done` event, persisted after the stream ends.
  let capturedCitations: Citation[] = []
  let capturedObs: Observability = {}
  const assistantId = generateUUID()

  const stream = createUIMessageStream<ChatMessage>({
    generateId: () => assistantId,
    execute: async ({ writer }) => {
      const textId = generateUUID()
      writer.write({ type: 'text-start', id: textId })

      const upstream = await fetch(`${BACKEND_BASE}/api/v1/query/stream`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(BACKEND_KEY ? { 'x-api-key': BACKEND_KEY } : {}),
        },
        body: JSON.stringify({
          query,
          topK,
          filters,
          rag_model: selectedChatModel,
          debug: true,
        }),
        signal: request.signal,
      })

      if (!upstream.ok || !upstream.body) {
        const detail = await upstream.text().catch(() => '')
        throw new ChatSDKError('offline:chat', detail || `Backend responded ${upstream.status}`)
      }

      const reader = upstream.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let streamedText = ''
      let sawDone = false

      const handleEvent = (ev: Record<string, unknown>) => {
        const type = ev.type
        if (type === 'delta' && typeof ev.text === 'string') {
          streamedText += ev.text
          writer.write({ type: 'text-delta', id: textId, delta: ev.text })
        } else if (type === 'done') {
          sawDone = true
          capturedCitations = mapCitations(ev.citations)

          const tokenUsage = ev.token_usage as Record<string, number> | undefined
          capturedObs = {
            latencyMs: typeof ev.latency_ms === 'number' ? ev.latency_ms : undefined,
            costUsd: estimateChatMessageCostUsd(tokenUsage) ?? undefined,
            ragModel: typeof ev.rag_model === 'string' ? ev.rag_model : undefined,
            requestId: typeof ev.request_id === 'string' ? ev.request_id : undefined,
            queryLogId: typeof ev.query_log_id === 'string' ? ev.query_log_id : undefined,
            retrievedCount:
              typeof ev.retrieved_chunk_count === 'number' ? ev.retrieved_chunk_count : undefined,
            tokenUsage,
          }

          // If the backend omitted deltas but returned a full answer, use it.
          const answer = typeof ev.answer === 'string' ? ev.answer.trim() : ''
          if (!streamedText.trim() && answer) {
            writer.write({ type: 'text-delta', id: textId, delta: answer })
            streamedText = answer
          }
        } else if (type === 'error') {
          throw new ChatSDKError(
            'offline:chat',
            typeof ev.message === 'string' ? ev.message : 'Streaming error'
          )
        }
      }

      const flush = () => {
        const blocks = buffer.split('\n\n')
        buffer = blocks.pop() ?? ''
        for (const block of blocks) {
          for (const line of block.split('\n')) {
            const trimmed = line.trim()
            if (!trimmed.startsWith('data:')) continue
            const json = trimmed.slice(5).trim()
            if (!json || json === '[DONE]') continue
            try {
              handleEvent(JSON.parse(json) as Record<string, unknown>)
            } catch {
              /* ignore malformed line */
            }
          }
        }
      }

      for (;;) {
        const { done, value } = await reader.read()
        if (done) {
          if (buffer.trim()) {
            buffer += '\n\n'
            flush()
          }
          break
        }
        buffer += decoder.decode(value, { stream: true })
        flush()
      }

      writer.write({ type: 'text-end', id: textId })

      if (capturedCitations.length > 0) {
        writer.write({ type: 'data-citations', data: capturedCitations })
      }
      writer.write({ type: 'data-observability', data: capturedObs })

      if (!sawDone && !streamedText.trim()) {
        throw new ChatSDKError('offline:chat', 'Stream ended before an answer was produced.')
      }
    },
    onFinish: async ({ messages }) => {
      const assistant = messages.filter(m => m.role === 'assistant')
      if (assistant.length === 0) return
      await saveMessages({
        messages: assistant.map(m => ({
          id: m.id,
          chatId: id,
          role: 'assistant',
          parts: m.parts,
          attachments: [],
          createdAt: new Date(),
          citations: capturedCitations.length > 0 ? capturedCitations : null,
          metadata: (m.metadata ?? null) as unknown as Record<string, unknown> | null,
          latencyMs: capturedObs.latencyMs ?? null,
          costUsd: capturedObs.costUsd ?? null,
          ragModel: capturedObs.ragModel ?? null,
          requestId: capturedObs.requestId ?? null,
          queryLogId: capturedObs.queryLogId ?? null,
          evalRunId: null,
          evalCaseId: null,
        })),
      })
      await touchChat({ id })
    },
    onError: error => {
      if (error instanceof ChatSDKError) return error.message
      console.error('Unhandled error in /api/chat:', error)
      return 'We had trouble reaching the RAG backend. Please try again.'
    },
  })

  return new Response(stream.pipeThrough(new JsonToSseTransformStream()))
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) {
    return new ChatSDKError('bad_request:api').toResponse()
  }

  const session = await auth()
  if (!session?.user) {
    return new ChatSDKError('unauthorized:chat').toResponse()
  }

  const chat = await getChatById({ id })
  if (chat?.userId !== session.user.id) {
    return new ChatSDKError('forbidden:chat').toResponse()
  }

  const { deleteChatById } = await import('@/lib/db/queries')
  const deleted = await deleteChatById({ id })
  return Response.json(deleted, { status: 200 })
}
