import type { Metadata } from 'next'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/page-header'
import { StrategiesView } from '@/components/strategies/strategies-view'
import { STRATEGY_BENCHMARK } from '@/lib/strategy-benchmark'

export const metadata: Metadata = {
  title: 'Retrieval strategies · RAG Eval',
  description:
    'Measured comparison of the four retrieval strategies — Hit@1/Hit@5/MRR, latency, and cost on the bundled corpus.',
}

export default function StrategiesPage() {
  return (
    <div className="min-h-screen bg-background px-6 py-10 sm:px-8">
      <div className="mx-auto max-w-5xl">
        <PageHeader
          title="Retrieval strategies"
          subtitle={
            <>
              Measured on the bundled corpus
              <span className="mx-1.5 text-muted-foreground/40">·</span>
              <span className="tabular-nums">{STRATEGY_BENCHMARK.nCases} cases</span>
            </>
          }
          actions={
            <>
              <Button variant="outline" size="sm" asChild>
                <Link href="/eval/runs">Eval runs</Link>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link href="/metrics">Metrics</Link>
              </Button>
            </>
          }
        />

        <StrategiesView />
      </div>
    </div>
  )
}
