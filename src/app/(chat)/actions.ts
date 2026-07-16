'use server'

import { cookies } from 'next/headers'
import type { ChatMessage } from '@/lib/types'
import { getTextFromMessage } from '@/lib/utils'
import type { VisibilityType } from '@/lib/db/queries'
import { updateChatVisibilityById } from '@/lib/db/queries'

export async function saveChatModelAsCookie(model: string) {
  const cookieStore = await cookies()
  cookieStore.set('chat-model', model)
}

/**
 * Derive a chat title from the first user message. We intentionally avoid an
 * LLM call here — the RAG generation lives in FastAPI and titles are cheap.
 */
export async function generateTitleFromUserMessage({ message }: { message: ChatMessage }) {
  const text = getTextFromMessage(message).trim()
  if (!text) return 'New chat'
  const firstLine = text.split('\n')[0].slice(0, 80)
  return firstLine.length < text.length ? `${firstLine.replace(/\s+\S*$/, '')}…` : firstLine
}

export async function updateChatVisibility({
  chatId,
  visibility,
}: {
  chatId: string
  visibility: VisibilityType
}) {
  await updateChatVisibilityById({ chatId, visibility })
}
