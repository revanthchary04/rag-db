'use client'

import { useEffect, useState } from 'react'
import { checkHealth } from '@/lib/api/client'
import { cn } from '@/lib/utils'

type State = 'unknown' | 'ok' | 'error'

/**
 * Small liveness indicator for the chat header. Polls the backend health
 * endpoint so the observability console always shows whether it can reach
 * the API and database.
 */
export function ConnectionStatus({ className }: { className?: string }) {
  const [state, setState] = useState<State>('unknown')

  useEffect(() => {
    let cancelled = false
    const ping = async () => {
      try {
        const health = await checkHealth()
        if (!cancelled) setState(health.ok && health.db ? 'ok' : 'error')
      } catch {
        if (!cancelled) setState('error')
      }
    }
    void ping()
    const interval = setInterval(() => void ping(), 30_000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  const label = state === 'ok' ? 'Connected' : state === 'error' ? 'Disconnected' : 'Checking'

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-muted-foreground text-xs"
      title={`Backend ${label.toLowerCase()}`}
    >
      <span
        aria-hidden
        className={cn(
          'size-1.5 rounded-full',
          state === 'ok' && 'bg-emerald-500',
          state === 'error' && 'bg-red-500',
          state === 'unknown' && 'animate-pulse bg-muted-foreground'
        )}
      />
      <span className={className}>{label}</span>
    </span>
  )
}
