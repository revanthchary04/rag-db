'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { ArrowLeft, RefreshCw, AlertCircle } from 'lucide-react'
import { getMetrics } from '@/lib/api/client'
import { MetricsView, type MetricsData } from '@/components/metrics/metrics-view'
import { PageHeader } from '@/components/page-header'

export default function MetricsPage() {
  const router = useRouter()
  const [metrics, setMetrics] = useState<MetricsData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date())

  const fetchMetrics = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const data = await getMetrics()
      setMetrics(data)
      setLastUpdated(new Date())
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch metrics')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void fetchMetrics()
    const interval = setInterval(() => void fetchMetrics(), 10000)
    return () => clearInterval(interval)
  }, [])

  if (error && !metrics) {
    return (
      <div className="min-h-screen bg-background p-8">
        <div className="mx-auto max-w-lg space-y-4">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Could not load metrics</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
          <div className="flex gap-2">
            <Button onClick={() => void fetchMetrics()}>Retry</Button>
            <Button variant="ghost" size="sm" onClick={() => router.push('/')}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to chat
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background px-6 py-10 sm:px-8">
      <div className="mx-auto max-w-5xl">
        <PageHeader
          title="Pipeline metrics"
          subtitle={
            <>
              Live counters from the FastAPI backend
              <span className="mx-1.5 text-muted-foreground/40">·</span>
              <span className="tabular-nums">updated {lastUpdated.toLocaleTimeString()}</span>
            </>
          }
          actions={
            <>
              <Button variant="outline" size="sm" asChild>
                <Link href="/query-logs">Query logs</Link>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void fetchMetrics()}
                disabled={isLoading}
                aria-label="Refresh metrics"
              >
                <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
                <span className="ml-2">Refresh</span>
              </Button>
            </>
          }
        />

        {isLoading && !metrics ? (
          <div className="space-y-12">
            <div className="flex flex-wrap gap-8">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-6 w-20" />
                </div>
              ))}
            </div>
            <div className="space-y-4">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          </div>
        ) : metrics ? (
          <MetricsView data={metrics} />
        ) : null}
      </div>
    </div>
  )
}
