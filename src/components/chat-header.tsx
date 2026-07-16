'use client'

import { EllipsisVertical } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { memo } from 'react'
import { useWindowSize } from 'usehooks-ts'
import { ConnectionStatus } from '@/components/connection-status'
import { SidebarToggle } from '@/components/sidebar-toggle'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { RagModel } from '@/features/settings/useRagSettings'
import { PlusIcon } from './icons'
import { RagModelSelector } from './rag-model-selector'
import { useSidebar } from './ui/sidebar'

function PureChatHeader({
  selectedModelId,
  onModelChange,
  isReadonly,
}: {
  chatId: string
  selectedModelId: string
  onModelChange?: (id: RagModel) => void
  isReadonly: boolean
}) {
  const router = useRouter()
  const { open } = useSidebar()
  const { width: windowWidth } = useWindowSize()

  return (
    <header className="sticky top-0 flex items-center gap-2 bg-background px-2 py-1.5 md:px-2">
      <SidebarToggle />

      {(!open || windowWidth < 768) && (
        <Button
          className="order-2 ml-auto h-8 px-2 md:order-1 md:ml-0 md:h-fit md:px-2"
          onClick={() => {
            router.push('/')
            router.refresh()
          }}
          variant="outline"
        >
          <PlusIcon />
          <span className="md:sr-only">New Chat</span>
        </Button>
      )}

      {!isReadonly && (
        <RagModelSelector
          className="order-1 md:order-2"
          onModelChange={onModelChange}
          selectedModelId={selectedModelId}
        />
      )}

      <nav className="order-3 ml-auto hidden items-center gap-1 md:flex">
        <Button asChild size="sm" variant="ghost">
          <Link href="/query-logs">Query logs</Link>
        </Button>
        <Button asChild size="sm" variant="ghost">
          <Link href="/eval/runs">Eval</Link>
        </Button>
        <Button asChild size="sm" variant="ghost">
          <Link href="/strategies">Strategies</Link>
        </Button>
        <Button asChild size="sm" variant="ghost">
          <Link href="/metrics">Metrics</Link>
        </Button>
        <ConnectionStatus className="ml-1 hidden lg:inline" />
      </nav>

      {/* Mobile: same destinations collapse into an overflow menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label="More pages"
            className="order-4 size-8 md:hidden"
            size="icon"
            variant="ghost"
          >
            <EllipsisVertical className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem asChild>
            <Link href="/query-logs">Query logs</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/eval/runs">Eval</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/strategies">Strategies</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/metrics">Metrics</Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <div className="px-2 py-1.5">
            <ConnectionStatus />
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  )
}

export const ChatHeader = memo(
  PureChatHeader,
  (prev, next) =>
    prev.chatId === next.chatId &&
    prev.selectedModelId === next.selectedModelId &&
    prev.isReadonly === next.isReadonly
)
