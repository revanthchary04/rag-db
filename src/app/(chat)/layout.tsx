import { cookies } from 'next/headers'
import { auth } from '@/app/(auth)/auth'
import { AppSidebar } from '@/components/app-sidebar'
import { DataStreamProvider } from '@/components/data-stream-provider'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'

export default async function ChatLayout({ children }: { children: React.ReactNode }) {
  const [session, cookieStore] = await Promise.all([auth(), cookies()])
  const isCollapsed = cookieStore.get('sidebar_state')?.value !== 'true'

  return (
    <DataStreamProvider>
      <SidebarProvider defaultOpen={!isCollapsed}>
        <AppSidebar user={session?.user} />
        <SidebarInset>{children}</SidebarInset>
      </SidebarProvider>
    </DataStreamProvider>
  )
}
