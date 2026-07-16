import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@/app/(auth)/auth'
import { Chat } from '@/components/chat'
import { generateUUID } from '@/lib/utils'

const DEFAULT_RAG_MODEL = 'vector-similarity'

export default async function Page() {
  const session = await auth()
  if (!session) {
    redirect('/api/auth/guest')
  }

  const id = generateUUID()
  const cookieStore = await cookies()
  const modelFromCookie = cookieStore.get('chat-model')?.value

  return (
    <Chat
      autoResume={false}
      id={id}
      initialChatModel={modelFromCookie ?? DEFAULT_RAG_MODEL}
      initialMessages={[]}
      initialVisibilityType="private"
      isReadonly={false}
      key={id}
    />
  )
}
