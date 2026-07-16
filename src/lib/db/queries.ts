import 'server-only'

import { and, asc, desc, eq, gt, inArray, lt, type SQL } from 'drizzle-orm'

import { ChatSDKError } from '@/lib/errors'
import { generateUUID } from '@/lib/utils'
import { db } from './client'
import { type Chat, chat, type DBMessage, message, type User, user } from './schema'
import { generateHashedPassword } from './utils'

export type VisibilityType = 'public' | 'private'

export async function getUser(email: string): Promise<User[]> {
  try {
    return await db.select().from(user).where(eq(user.email, email))
  } catch {
    throw new ChatSDKError('bad_request:database', 'Failed to get user by email')
  }
}

export async function createUser(email: string, password: string) {
  const hashedPassword = generateHashedPassword(password)
  try {
    return await db.insert(user).values({ email, password: hashedPassword })
  } catch {
    throw new ChatSDKError('bad_request:database', 'Failed to create user')
  }
}

export async function createGuestUser() {
  const email = `guest-${Date.now()}`
  const password = generateHashedPassword(generateUUID())
  try {
    return await db
      .insert(user)
      .values({ email, password })
      .returning({ id: user.id, email: user.email })
  } catch {
    throw new ChatSDKError('bad_request:database', 'Failed to create guest user')
  }
}

export async function saveChat({
  id,
  userId,
  title,
  visibility,
}: {
  id: string
  userId: string
  title: string
  visibility: VisibilityType
}) {
  try {
    const now = new Date()
    return await db.insert(chat).values({
      id,
      createdAt: now,
      updatedAt: now,
      userId,
      title,
      visibility,
    })
  } catch {
    throw new ChatSDKError('bad_request:database', 'Failed to save chat')
  }
}

export async function touchChat({ id }: { id: string }) {
  try {
    await db.update(chat).set({ updatedAt: new Date() }).where(eq(chat.id, id))
  } catch {
    throw new ChatSDKError('bad_request:database', 'Failed to update chat timestamp')
  }
}

export async function updateChatTitleById({ id, title }: { id: string; title: string }) {
  try {
    await db.update(chat).set({ title, updatedAt: new Date() }).where(eq(chat.id, id))
  } catch {
    throw new ChatSDKError('bad_request:database', 'Failed to update chat title')
  }
}

export async function updateChatVisibilityById({
  chatId,
  visibility,
}: {
  chatId: string
  visibility: VisibilityType
}) {
  try {
    await db.update(chat).set({ visibility }).where(eq(chat.id, chatId))
  } catch {
    throw new ChatSDKError('bad_request:database', 'Failed to update chat visibility')
  }
}

export async function deleteChatById({ id }: { id: string }) {
  try {
    await db.delete(message).where(eq(message.chatId, id))
    const [chatsDeleted] = await db.delete(chat).where(eq(chat.id, id)).returning()
    return chatsDeleted
  } catch {
    throw new ChatSDKError('bad_request:database', 'Failed to delete chat by id')
  }
}

export async function deleteAllChatsByUserId({ userId }: { userId: string }) {
  try {
    const userChats = await db.select({ id: chat.id }).from(chat).where(eq(chat.userId, userId))
    if (userChats.length === 0) {
      return { deletedCount: 0 }
    }
    const chatIds = userChats.map(c => c.id)
    await db.delete(message).where(inArray(message.chatId, chatIds))
    const deletedChats = await db.delete(chat).where(eq(chat.userId, userId)).returning()
    return { deletedCount: deletedChats.length }
  } catch {
    throw new ChatSDKError('bad_request:database', 'Failed to delete all chats by user id')
  }
}

export async function getChatsByUserId({
  id,
  limit,
  startingAfter,
  endingBefore,
}: {
  id: string
  limit: number
  startingAfter: string | null
  endingBefore: string | null
}) {
  try {
    const extendedLimit = limit + 1

    const query = (whereCondition?: SQL<unknown>) =>
      db
        .select()
        .from(chat)
        .where(whereCondition ? and(whereCondition, eq(chat.userId, id)) : eq(chat.userId, id))
        .orderBy(desc(chat.updatedAt))
        .limit(extendedLimit)

    let filteredChats: Chat[] = []

    if (startingAfter) {
      const [selectedChat] = await db.select().from(chat).where(eq(chat.id, startingAfter)).limit(1)
      if (!selectedChat) {
        throw new ChatSDKError('not_found:database', `Chat with id ${startingAfter} not found`)
      }
      filteredChats = await query(gt(chat.updatedAt, selectedChat.updatedAt))
    } else if (endingBefore) {
      const [selectedChat] = await db.select().from(chat).where(eq(chat.id, endingBefore)).limit(1)
      if (!selectedChat) {
        throw new ChatSDKError('not_found:database', `Chat with id ${endingBefore} not found`)
      }
      filteredChats = await query(lt(chat.updatedAt, selectedChat.updatedAt))
    } else {
      filteredChats = await query()
    }

    const hasMore = filteredChats.length > limit
    return {
      chats: hasMore ? filteredChats.slice(0, limit) : filteredChats,
      hasMore,
    }
  } catch (error) {
    if (error instanceof ChatSDKError) {
      throw error
    }
    throw new ChatSDKError('bad_request:database', 'Failed to get chats by user id')
  }
}

export async function getChatById({ id }: { id: string }) {
  try {
    const [selectedChat] = await db.select().from(chat).where(eq(chat.id, id))
    return selectedChat ?? null
  } catch {
    throw new ChatSDKError('bad_request:database', 'Failed to get chat by id')
  }
}

export async function saveMessages({ messages }: { messages: DBMessage[] }) {
  try {
    // Idempotent by id: on regenerate the AI SDK re-sends the existing user
    // message, which would otherwise collide on the primary key.
    return await db.insert(message).values(messages).onConflictDoNothing()
  } catch {
    throw new ChatSDKError('bad_request:database', 'Failed to save messages')
  }
}

export async function getMessagesByChatId({ id }: { id: string }) {
  try {
    return await db
      .select()
      .from(message)
      .where(eq(message.chatId, id))
      .orderBy(asc(message.createdAt))
  } catch {
    throw new ChatSDKError('bad_request:database', 'Failed to get messages by chat id')
  }
}

export async function getMessageById({ id }: { id: string }) {
  try {
    const [row] = await db.select().from(message).where(eq(message.id, id))
    return row ?? null
  } catch {
    throw new ChatSDKError('bad_request:database', 'Failed to get message by id')
  }
}

export async function deleteMessagesByChatIdAfterTimestamp({
  chatId,
  timestamp,
}: {
  chatId: string
  timestamp: Date
}) {
  try {
    return await db
      .delete(message)
      .where(and(eq(message.chatId, chatId), gt(message.createdAt, timestamp)))
  } catch {
    throw new ChatSDKError('bad_request:database', 'Failed to delete messages')
  }
}
