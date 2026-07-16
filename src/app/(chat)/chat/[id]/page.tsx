import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { auth } from '@/app/(auth)/auth'
import { Chat } from '@/components/chat'
import { getChatById, getMessagesByChatId } from '@/lib/db/queries'
import type { ChatMessage } from '@/lib/types'
import { convertToUIMessages } from '@/lib/utils'

const DEFAULT_RAG_MODEL = 'vector-similarity'

export default async function Page(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const chat = await getChatById({ id })

  if (!chat) {
    notFound()
  }

  const session = await auth()
  if (!session) {
    redirect('/api/auth/guest')
  }

  if (chat.visibility === 'private' && session.user?.id !== chat.userId) {
    return notFound()
  }

  const messagesFromDb = await getMessagesByChatId({ id })
  const initialMessages: ChatMessage[] = convertToUIMessages(messagesFromDb)

  const cookieStore = await cookies()
  const modelFromCookie = cookieStore.get('chat-model')?.value
  const isReadonly = session.user?.id !== chat.userId

  return (
    <Chat
      autoResume={false}
      id={id}
      initialChatModel={modelFromCookie ?? DEFAULT_RAG_MODEL}
      initialMessages={initialMessages}
      initialVisibilityType={chat.visibility}
      isReadonly={isReadonly}
      key={id}
    />
  )
}
