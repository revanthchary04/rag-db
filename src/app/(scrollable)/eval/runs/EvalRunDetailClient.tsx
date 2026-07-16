'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  FlaskConical,
  Loader2,
  Target,
  BookOpen,
  ListOrdered,
  Download,
  FileJson,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { fetchEvalRunDetail, type EvalCaseResult, type EvalRunDetail } from '@/lib/api/client'
import { downloadEvalRunCsv, downloadEvalRunJson } from '@/lib/eval-export'
import { shortFetchError } from '@/lib/fetch-error'
import { cn } from '@/lib/utils'

function HitPassBadge({ label, pass }: { label: string; pass: boolean }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'font-mono text-[10px] font-semibold',
        pass
          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
          : 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300'
      )}
    >
      {label} {pass ? 'pass' : 'miss'}
    </Badge>
  )
}

function SourceChips({
  title,
  sources,
  tone,
}: {
  title: string
  sources: string[]
  tone: 'expected' | 'retrieved'
}) {
  if (!sources.length) {
    return (
      <div>
        <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </p>
        <p className="text-xs text-muted-foreground">None recorded</p>
      </div>
    )
  }
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {sources.map((s, i) => (
          <span
            key={`${s}-${i}`}
            className={cn(
              'max-w-full truncate rounded-md border px-2 py-0.5 text-xs',
              tone === 'expected'
                ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                : 'border-border bg-card text-foreground'
            )}
            title={s}
          >
            {s}
          </span>
        ))}
      </div>
    </div>
  )
}

function MetricTile({
  label,
  value,
  suffix,
  highlight,
}: {
  label: string
  value: string
  suffix?: string
  highlight?: 'good' | 'neutral'
}) {
  return (
    <div
      className={cn(
        'rounded-lg border p-3 sm:p-4',
        highlight === 'good'
          ? 'border-emerald-500/30 bg-emerald-500/10'
          : 'border-border bg-background'
      )}
    >
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 font-mono text-lg font-semibold tabular-nums text-foreground sm:text-xl">
        {value}
        {suffix ? (
          <span className="text-sm font-normal text-muted-foreground">{suffix}</span>
        ) : null}
      </p>
    </div>
  )
}

function CaseCard({ c, index }: { c: EvalCaseResult; index: number }) {
  const anyHit = c.hit_at_1 || c.hit_at_3 || c.hit_at_5 || c.hit_at_8
  return (
    <Card className="overflow-hidden border-border shadow-sm">
      <CardHeader className="border-b border-border bg-card pb-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="text-base text-foreground">
              Case {index + 1}{' '}
              <span className="font-mono text-sm font-normal text-muted-foreground">
                ({c.case_id})
              </span>
            </CardTitle>
            <CardDescription className="mt-1">
              Mean reciprocal rank{' '}
              <span className="font-mono font-medium text-foreground">{c.mrr.toFixed(3)}</span>
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <HitPassBadge label="@1" pass={c.hit_at_1} />
            <HitPassBadge label="@3" pass={c.hit_at_3} />
            <HitPassBadge label="@5" pass={c.hit_at_5} />
            <HitPassBadge label="@8" pass={c.hit_at_8} />
            {!anyHit && (
              <Badge
                variant="outline"
                className="border-rose-500/30 text-rose-700 dark:text-rose-300"
              >
                No hit @8
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5 bg-background p-4 sm:p-6">
        {c.error && (
          <Alert variant="destructive">
            <AlertTitle>Pipeline error</AlertTitle>
            <AlertDescription className="text-sm">{c.error}</AlertDescription>
          </Alert>
        )}

        <section>
          <div className="mb-2 flex items-center gap-2 text-foreground">
            <Target className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Query</h3>
          </div>
          <p className="rounded-lg border border-border bg-card px-3 py-2.5 text-sm leading-relaxed text-foreground">
            {c.query || '—'}
          </p>
        </section>

        <section>
          <div className="mb-2 flex items-center gap-2 text-foreground">
            <BookOpen className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Model answer</h3>
          </div>
          <div className="max-h-[min(24rem,50vh)] overflow-y-auto rounded-lg border border-border bg-card px-3 py-2.5 text-sm leading-relaxed text-foreground">
            {c.answer?.trim() ? (
              c.answer
            ) : (
              <span className="text-muted-foreground">No answer text</span>
            )}
          </div>
        </section>

        <div className="grid gap-6 sm:grid-cols-2">
          <SourceChips title="Expected sources" sources={c.expected_sources} tone="expected" />
          <SourceChips
            title="Retrieved sources (order preserved)"
            sources={c.retrieved_sources}
            tone="retrieved"
          />
        </div>

        {(c.llm_judge_correctness != null ||
          c.llm_judge_faithfulness != null ||
          (c.llm_judge_reasoning && c.llm_judge_reasoning.trim())) && (
          <div className="rounded-lg border border-violet-500/30 bg-violet-500/10 p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300">
              LLM judge
            </p>
            <div className="flex flex-wrap gap-2">
              {c.llm_judge_correctness != null && (
                <Badge variant="outline" className="border-violet-500/40 bg-card">
                  Correctness: {c.llm_judge_correctness ? 'yes' : 'no'}
                </Badge>
              )}
              {c.llm_judge_faithfulness != null && (
                <Badge variant="outline" className="border-violet-500/40 bg-card">
                  Faithfulness: {c.llm_judge_faithfulness ? 'yes' : 'no'}
                </Badge>
              )}
            </div>
            {c.llm_judge_reasoning ? (
              <p className="mt-2 text-xs leading-relaxed text-violet-700 dark:text-violet-300">
                {c.llm_judge_reasoning}
              </p>
            ) : null}
          </div>
        )}

        {c.citations.length > 0 && (
          <details className="rounded-lg border border-border bg-card text-sm">
            <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-muted-foreground">
              Citations ({c.citations.length})
            </summary>
            <pre className="max-h-48 overflow-auto border-t border-border p-3 text-[11px] leading-snug text-muted-foreground">
              {JSON.stringify(c.citations, null, 2)}
            </pre>
          </details>
        )}
      </CardContent>
    </Card>
  )
}

export default function EvalRunDetailClient({ runId }: { runId: string }) {
  const router = useRouter()

  const [run, setRun] = useState<EvalRunDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!runId) {
      setLoading(false)
      setError('Missing run id')
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const data = await fetchEvalRunDetail(runId)
        if (!cancelled) setRun(data)
      } catch (e) {
        const raw = e instanceof Error ? e.message : 'Failed to load run'
        if (!cancelled) setError(shortFetchError(raw))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [runId])

  const hitTone = (p: number): 'good' | 'neutral' => (p >= 0.8 ? 'good' : 'neutral')

  return (
    <div className="min-h-screen bg-background pb-12 pt-6 md:pb-16 md:pt-8">
      <div className="mx-auto max-w-5xl space-y-8 px-4 md:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/eval/runs">
                <ArrowLeft className="mr-2 h-4 w-4" />
                All runs
              </Link>
            </Button>
            <Button variant="ghost" size="sm" onClick={() => router.push('/')}>
              Chat
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {run && !loading ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  type="button"
                  onClick={() => downloadEvalRunJson(run)}
                >
                  <FileJson className="h-3.5 w-3.5" />
                  JSON
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  type="button"
                  onClick={() => downloadEvalRunCsv(run)}
                >
                  <Download className="h-3.5 w-3.5" />
                  CSV
                </Button>
              </>
            ) : null}
            <div className="flex items-center gap-2 text-foreground">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-card shadow-sm ring-1 ring-border">
                <FlaskConical className="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <h1 className="text-lg font-semibold leading-tight">Eval run</h1>
                <p className="text-xs text-muted-foreground">
                  Retrieval metrics and per-case breakdown
                </p>
              </div>
            </div>
          </div>
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading run…
          </div>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertTitle>Error</AlertTitle>
            <AlertDescription className="text-sm">{error}</AlertDescription>
          </Alert>
        )}

        {run && !loading && (
          <>
            {run.error_message && (
              <Alert variant="destructive">
                <AlertTitle>Run-level error</AlertTitle>
                <AlertDescription>{run.error_message}</AlertDescription>
              </Alert>
            )}

            <Card className="border-border shadow-sm">
              <CardHeader>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <CardTitle className="text-lg">Overview</CardTitle>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary" className="font-normal">
                      {run.status}
                    </Badge>
                    {run.use_llm_judge ? (
                      <Badge
                        variant="outline"
                        className="border-violet-500/40 text-violet-700 dark:text-violet-300"
                      >
                        LLM judge on
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground">
                        LLM judge off
                      </Badge>
                    )}
                  </div>
                </div>
                <CardDescription className="font-mono text-xs break-all text-muted-foreground">
                  {run.id}
                </CardDescription>
                <p className="text-sm text-muted-foreground">
                  <time dateTime={run.created_at}>{run.created_at}</time>
                  <span className="mx-2 text-muted-foreground">·</span>
                  <span className="font-medium text-foreground">{run.dataset_path}</span>
                </p>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <MetricTile
                    label="Hit @1"
                    value={(run.hit_at_1 * 100).toFixed(1)}
                    suffix="%"
                    highlight={hitTone(run.hit_at_1)}
                  />
                  <MetricTile
                    label="Hit @3"
                    value={(run.hit_at_3 * 100).toFixed(1)}
                    suffix="%"
                    highlight={hitTone(run.hit_at_3)}
                  />
                  <MetricTile
                    label="Hit @5"
                    value={(run.hit_at_5 * 100).toFixed(1)}
                    suffix="%"
                    highlight={hitTone(run.hit_at_5)}
                  />
                  <MetricTile
                    label="Hit @8"
                    value={(run.hit_at_8 * 100).toFixed(1)}
                    suffix="%"
                    highlight={hitTone(run.hit_at_8)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <MetricTile label="MRR" value={run.mrr.toFixed(3)} highlight="neutral" />
                  <MetricTile
                    label="Cases passed"
                    value={`${run.successful}`}
                    suffix={` / ${run.total_cases}`}
                    highlight={run.failed === 0 ? 'good' : 'neutral'}
                  />
                  <MetricTile
                    label="Failed"
                    value={`${run.failed}`}
                    highlight={run.failed > 0 ? 'neutral' : 'good'}
                  />
                </div>

                {(run.llm_judge_correctness_rate != null ||
                  run.llm_judge_faithfulness_rate != null) && (
                  <div className="rounded-lg border border-violet-500/30 bg-violet-500/10 px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300">
                      Aggregate LLM judge
                    </p>
                    <div className="mt-2 flex flex-wrap gap-4 text-sm text-violet-700 dark:text-violet-300">
                      {run.llm_judge_correctness_rate != null && (
                        <span>
                          Correctness:{' '}
                          <strong>{(run.llm_judge_correctness_rate * 100).toFixed(0)}%</strong>
                        </span>
                      )}
                      {run.llm_judge_faithfulness_rate != null && (
                        <span>
                          Faithfulness:{' '}
                          <strong>{(run.llm_judge_faithfulness_rate * 100).toFixed(0)}%</strong>
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {run.config_json && Object.keys(run.config_json).length > 0 && (
                  <details className="rounded-lg border border-border bg-background text-sm">
                    <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-muted-foreground">
                      Run configuration (JSON)
                    </summary>
                    <pre className="max-h-40 overflow-auto border-t border-border p-3 text-[11px] text-foreground">
                      {JSON.stringify(run.config_json, null, 2)}
                    </pre>
                  </details>
                )}
              </CardContent>
            </Card>

            <div>
              <div className="mb-4 flex items-center gap-2 text-foreground">
                <ListOrdered className="h-5 w-5 text-muted-foreground" />
                <h2 className="text-base font-semibold">Cases</h2>
                <Badge variant="outline" className="ml-1 font-mono text-xs">
                  {run.cases.length}
                </Badge>
              </div>
              <div className="space-y-6">
                {run.cases.map((c, i) => (
                  <CaseCard key={c.id} c={c} index={i} />
                ))}
              </div>
            </div>

            <Separator className="bg-muted" />

            <p className="text-center text-xs text-muted-foreground">
              Persisted eval runs are written by{' '}
              <code className="rounded bg-muted px-1">run_eval.py</code> when{' '}
              <code className="rounded bg-muted px-1">EVAL_PERSIST_RUNS</code> is enabled.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
