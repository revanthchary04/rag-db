'use client'

import dynamic from 'next/dynamic'

const QueryLogsExplorerClient = dynamic(() => import('./QueryLogsExplorerClient'), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-screen items-center justify-center bg-background p-10 text-sm text-muted-foreground">
      Loading query logs…
    </div>
  ),
})

export default function QueryLogsPage() {
  return <QueryLogsExplorerClient />
}
