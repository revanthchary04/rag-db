import type { UIMessage } from 'ai'
import { z } from 'zod'

/** A retrieval citation returned by the FastAPI RAG backend. */
export type Citation = {
  chunk_id: string
  document_id: string
  title: string | null
  source: string
  chunk_index: number
  /** The retrieved passage that grounds this citation (truncated by the backend). */
  content_snippet?: string
  /** Retrieval similarity score (higher is more relevant). */
  score?: number
}

/** Per-message RAG observability captured from the backend `done` event. */
export type Observability = {
  latencyMs?: number
  costUsd?: number
  ragModel?: string
  requestId?: string
  queryLogId?: string
  retrievedCount?: number
  tokenUsage?: Record<string, number>
}

export const messageMetadataSchema = z.object({
  createdAt: z.string(),
})

export type MessageMetadata = z.infer<typeof messageMetadataSchema>

/**
 * Custom data parts streamed from /api/chat. `citations` and `observability`
 * are persisted into message.parts so they re-render on reload; the backend
 * also mirrors the observability fields into dedicated Message_v2 columns for
 * query-log/eval linkage.
 */
export type CustomUIDataTypes = {
  citations: Citation[]
  observability: Observability
  appendMessage: string
  id: string
  title: string
}

export type ChatMessage = UIMessage<MessageMetadata, CustomUIDataTypes>

export type Attachment = {
  name: string
  url: string
  contentType: string
}
