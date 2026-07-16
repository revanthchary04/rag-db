import type { UIMessage, UIMessagePart } from 'ai'
import { clsx, type ClassValue } from 'clsx'
import { formatISO } from 'date-fns'
import { twMerge } from 'tailwind-merge'
import type { DBMessage } from '@/lib/db/schema'
import type { ChatMessage, CustomUIDataTypes } from '@/lib/types'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** RFC4122-ish v4 UUID (works in edge + browser without crypto.randomUUID). */
export function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/** SWR fetcher that surfaces API error bodies. */
export const fetcher = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) {
    const error = new Error('An error occurred while fetching the data.') as Error & {
      info?: unknown
      status?: number
    }
    error.info = await res.json().catch(() => undefined)
    error.status = res.status
    throw error
  }
  return res.json()
}

export function sanitizeText(text: string) {
  return text.replace('<has_function_call>', '')
}

/** Map persisted Message_v2 rows back into AI SDK UI messages for hydration. */
export function convertToUIMessages(messages: DBMessage[]): ChatMessage[] {
  return messages.map(m => ({
    id: m.id,
    role: m.role as 'user' | 'assistant' | 'system',
    parts: m.parts as UIMessagePart<CustomUIDataTypes, never>[],
    metadata: { createdAt: formatISO(m.createdAt) },
  }))
}

export function getTextFromMessage(message: UIMessage): string {
  return message.parts
    .filter(part => part.type === 'text')
    .map(part => (part as { type: 'text'; text: string }).text)
    .join('')
}

/** Cosine similarity for numeric vectors (same length). */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have the same length')
  }
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb)
  if (denom === 0) {
    return 0
  }
  return dot / denom
}
