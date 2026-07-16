'use client'

import { Suspense } from 'react'
import dynamic from 'next/dynamic'

const EvalRunsHub = dynamic(() => import('./EvalRunsHub'), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-screen items-center justify-center bg-background p-10 text-sm text-muted-foreground">
      Loading eval…
    </div>
  ),
})

function Fallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-10 text-sm text-muted-foreground">
      Loading eval…
    </div>
  )
}

export default function EvalRunsPage() {
  return (
    <Suspense fallback={<Fallback />}>
      <EvalRunsHub />
    </Suspense>
  )
}
