'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronRight, GitCompareArrows, Loader2, ScrollText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/page-header'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { fetchEvalRunsList, type EvalRunSummary } from '@/lib/api/client'
import { shortFetchError } from '@/lib/fetch-error'
import { cn } from '@/lib/utils'

function HitAt5Sparkline({ runs }: { runs: EvalRunSummary[] }) {
  const chronological = [...runs].reverse()
  const vals = chronological.map(r => r.hit_at_5)
  if (vals.length < 2) return null
  const w = 220
  const h = 48
  const pad = 4
  const minY = 0
  const maxY = 1
  const n = vals.length - 1
  const pts = vals
    .map((v, i) => {
      const x = pad + (i / Math.max(n, 1)) * (w - 2 * pad)
      const y = pad + (1 - (v - minY) / (maxY - minY)) * (h - 2 * pad)
      return `${x},${y}`
    })
    .join(' ')
  return (
    <div className="flex items-center gap-3">
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        Hit@5 trend
      </span>
      <svg width={w} height={h} className="shrink-0" aria-hidden>
        <polyline
          fill="none"
          stroke="rgb(16 185 129)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          points={pts}
        />
      </svg>
      <span className="text-xs text-muted-foreground">
        oldest <span className="text-muted-foreground">→</span> newest
      </span>
    </div>
  )
}

export default function EvalRunsListClient() {
  const router = useRouter()
  const [runs, setRuns] = useState<EvalRunSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cmpA, setCmpA] = useState('')
  const [cmpB, setCmpB] = useState('')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const data = await fetchEvalRunsList({ limit: 100 })
        if (!cancelled) setRuns(data.runs)
      } catch (e) {
        const raw = e instanceof Error ? e.message : 'Failed to load eval runs'
        if (!cancelled) setError(shortFetchError(raw))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (runs.length >= 2 && !cmpA && !cmpB) {
      setCmpA(runs[1].id)
      setCmpB(runs[0].id)
    }
  }, [runs, cmpA, cmpB])

  const canCompare = cmpA && cmpB && cmpA !== cmpB

  return (
    <div className="min-h-screen bg-background pb-12 pt-6 md:pb-16 md:pt-8">
      <div className="mx-auto max-w-4xl space-y-8 px-4 md:px-8">
        <PageHeader
          title="Eval runs"
          subtitle="Persisted harness results"
          actions={
            <Button variant="outline" size="sm" asChild>
              <Link href="/query-logs">
                <ScrollText className="mr-1 h-4 w-4" />
                Query logs
              </Link>
            </Button>
          }
        />

        {loading && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertTitle>Could not load eval runs</AlertTitle>
            <AlertDescription className="text-sm">{error}</AlertDescription>
          </Alert>
        )}

        {!loading && !error && runs.length >= 2 && (
          <Card className="border-border bg-card/90 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Trends</CardTitle>
              <CardDescription>
                Hit@5 across loaded runs (chronological left → right).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <HitAt5Sparkline runs={runs} />
            </CardContent>
          </Card>
        )}

        {!loading && !error && runs.length >= 2 && (
          <Card className="border-border bg-card/90 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <GitCompareArrows className="h-4 w-4 text-muted-foreground" />
                Compare two runs
              </CardTitle>
              <CardDescription>
                Run A is baseline, B is candidate. Opens a side-by-side delta view.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
              <label className="flex min-w-[10rem] flex-1 flex-col gap-1 text-xs font-medium text-muted-foreground">
                Run A
                <select
                  aria-label="Baseline run for comparison"
                  className="rounded-md border border-border bg-card px-2 py-2 text-sm text-foreground"
                  value={cmpA}
                  onChange={e => setCmpA(e.target.value)}
                >
                  {runs.map(r => (
                    <option key={r.id} value={r.id}>
                      {r.id.slice(0, 8)}… · Hit@5 {(r.hit_at_5 * 100).toFixed(0)}%
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex min-w-[10rem] flex-1 flex-col gap-1 text-xs font-medium text-muted-foreground">
                Run B
                <select
                  aria-label="Candidate run for comparison"
                  className="rounded-md border border-border bg-card px-2 py-2 text-sm text-foreground"
                  value={cmpB}
                  onChange={e => setCmpB(e.target.value)}
                >
                  {runs.map(r => (
                    <option key={`b-${r.id}`} value={r.id}>
                      {r.id.slice(0, 8)}… · Hit@5 {(r.hit_at_5 * 100).toFixed(0)}%
                    </option>
                  ))}
                </select>
              </label>
              <Button
                type="button"
                disabled={!canCompare}
                onClick={() =>
                  router.push(
                    `/eval/runs?compare=${encodeURIComponent(cmpA)}&to=${encodeURIComponent(cmpB)}`
                  )
                }
              >
                Compare
              </Button>
            </CardContent>
          </Card>
        )}

        {!loading && !error && runs.length === 0 && (
          <Card className="border-dashed border-border bg-card/80">
            <CardHeader>
              <CardTitle className="text-base">No runs yet</CardTitle>
              <CardDescription>
                Run <code className="rounded bg-muted px-1 py-0.5 text-xs">eval/run_eval.py</code>{' '}
                with <code className="rounded bg-muted px-1 py-0.5 text-xs">EVAL_PERSIST_RUNS</code>{' '}
                enabled (default) after migrating the database.
              </CardDescription>
            </CardHeader>
          </Card>
        )}

        <ul className="space-y-3">
          {runs.map(r => {
            const hit5 = r.hit_at_5 * 100
            const strong = hit5 >= 80
            return (
              <li key={r.id}>
                <Link href={`/eval/runs?id=${encodeURIComponent(r.id)}`} className="block group">
                  <Card
                    className={cn(
                      'border-border shadow-sm transition-colors',
                      'hover:border-border hover:bg-card'
                    )}
                  >
                    <CardContent className="flex items-start gap-3 p-4 sm:p-5">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs text-muted-foreground">
                            {r.id.slice(0, 8)}…
                          </span>
                          <Badge
                            variant="outline"
                            className={cn(
                              'font-mono text-[10px]',
                              strong
                                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                : 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                            )}
                          >
                            Hit@5 {hit5.toFixed(0)}%
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            MRR {r.mrr.toFixed(3)} · {r.total_cases} cases
                          </span>
                        </div>
                        <p className="mt-2 truncate text-sm font-medium text-foreground">
                          {r.dataset_path}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{r.created_at}</p>
                      </div>
                      <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground" />
                    </CardContent>
                  </Card>
                </Link>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
