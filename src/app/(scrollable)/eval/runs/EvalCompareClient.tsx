'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  GitCompareArrows,
  Loader2,
  Minus,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { fetchEvalRunDetail, type EvalCaseResult, type EvalRunDetail } from '@/lib/api/client'
import { shortFetchError } from '@/lib/fetch-error'
import { cn } from '@/lib/utils'

// Mirror the CI gate (compare_eval.py): Hit@5 and MRR are gated; ±0.02 tolerance.
const TOLERANCE = 0.02
const EPS = 1e-6

type RowStatus =
  | 'same'
  | 'hit5-regressed'
  | 'hit5-improved'
  | 'mrr-down'
  | 'mrr-up'
  | 'only-a'
  | 'only-b'

type DiffRow = {
  caseId: string
  ca: EvalCaseResult | undefined
  cb: EvalCaseResult | undefined
  status: RowStatus
  dMrr: number | null
}

function classifyRow(ca: EvalCaseResult | undefined, cb: EvalCaseResult | undefined): RowStatus {
  if (ca && !cb) return 'only-a'
  if (!ca && cb) return 'only-b'
  if (!ca || !cb) return 'same'
  if (ca.hit_at_5 && !cb.hit_at_5) return 'hit5-regressed'
  if (!ca.hit_at_5 && cb.hit_at_5) return 'hit5-improved'
  const d = cb.mrr - ca.mrr
  if (d < -EPS) return 'mrr-down'
  if (d > EPS) return 'mrr-up'
  return 'same'
}

// Severity order — regressions first, so the debugging payload is at the top.
const STATUS_ORDER: Record<RowStatus, number> = {
  'hit5-regressed': 0,
  'mrr-down': 1,
  'only-a': 2,
  'hit5-improved': 3,
  'mrr-up': 4,
  'only-b': 5,
  same: 6,
}

const STATUS_META: Record<
  RowStatus,
  { label: string; tone: 'rose' | 'amber' | 'emerald' | 'muted' }
> = {
  same: { label: 'unchanged', tone: 'muted' },
  'hit5-regressed': { label: 'Hit@5 lost', tone: 'rose' },
  'hit5-improved': { label: 'Hit@5 gained', tone: 'emerald' },
  'mrr-down': { label: 'MRR ↓', tone: 'amber' },
  'mrr-up': { label: 'MRR ↑', tone: 'emerald' },
  'only-a': { label: 'A only', tone: 'muted' },
  'only-b': { label: 'B only', tone: 'muted' },
}

const TONE_TEXT: Record<string, string> = {
  rose: 'text-rose-600 dark:text-rose-400',
  amber: 'text-amber-600 dark:text-amber-400',
  emerald: 'text-emerald-600 dark:text-emerald-400',
  muted: 'text-muted-foreground',
}

function buildCaseIdAlignment(a: EvalRunDetail, b: EvalRunDetail) {
  const mapA = new Map(a.cases.map(c => [c.case_id, c]))
  const mapB = new Map(b.cases.map(c => [c.case_id, c]))
  const seen = new Set<string>()
  const order: string[] = []
  for (const c of [...a.cases, ...b.cases]) {
    if (!seen.has(c.case_id)) {
      seen.add(c.case_id)
      order.push(c.case_id)
    }
  }
  const rows: DiffRow[] = order.map(caseId => {
    const ca = mapA.get(caseId)
    const cb = mapB.get(caseId)
    return { caseId, ca, cb, status: classifyRow(ca, cb), dMrr: ca && cb ? cb.mrr - ca.mrr : null }
  })
  // "changed" is real metric movement only — coverage-only rows (a case present
  // in one run) are surfaced separately so they don't masquerade as regressions.
  const changeStatuses: RowStatus[] = ['hit5-regressed', 'mrr-down', 'hit5-improved', 'mrr-up']
  const changed = rows
    .filter(r => changeStatuses.includes(r.status))
    .sort((x, y) => STATUS_ORDER[x.status] - STATUS_ORDER[y.status])
  const onlyA = rows.filter(r => r.status === 'only-a').length
  const onlyB = rows.filter(r => r.status === 'only-b').length
  return { rows, changed, onlyA, onlyB }
}

/** Rank (1-based) of an expected source within a retrieved list, mirroring the
 * harness's case-insensitive substring match; null when it was not retrieved. */
function rankOf(retrieved: string[], expected: string): number | null {
  const e = expected.toLowerCase()
  const i = retrieved.findIndex(s => {
    const t = s.toLowerCase()
    return t.includes(e) || e.includes(t)
  })
  return i === -1 ? null : i + 1
}

// Worst-to-best score: lower rank is better; "not retrieved" (null) is worst of all.
const rankScore = (r: number | null, scale: number) => (r == null ? scale + 1 : r)

/**
 * RankShift — a lane showing where one expected source sat in the retrieved list
 * for run A (hollow) vs run B (filled), connected by a segment tinted for the
 * direction of movement. The far right of the lane is "not retrieved". This turns
 * "#1 → not retrieved" from a table cell into a movement you can see.
 */
function RankShift({
  rankA,
  rankB,
  scale,
}: {
  rankA: number | null
  rankB: number | null
  scale: number
}) {
  // Map a rank to a left %: the ranked zone is [4%, 82%]; a miss parks at 94%.
  const pos = (r: number | null) => {
    if (r == null) return 94
    const c = Math.min(Math.max(r, 1), scale)
    return 4 + ((c - 1) / Math.max(1, scale - 1)) * 78
  }
  const la = pos(rankA)
  const lb = pos(rankB)
  const dir =
    rankScore(rankB, scale) > rankScore(rankA, scale)
      ? 'worse'
      : rankScore(rankB, scale) < rankScore(rankA, scale)
        ? 'better'
        : 'same'
  const connector =
    dir === 'worse'
      ? 'bg-rose-500/60 dark:bg-rose-400/50'
      : dir === 'better'
        ? 'bg-emerald-500/60 dark:bg-emerald-400/50'
        : 'bg-border'
  const dot =
    dir === 'worse'
      ? 'bg-rose-500 dark:bg-rose-400'
      : dir === 'better'
        ? 'bg-emerald-500 dark:bg-emerald-400'
        : 'bg-foreground'
  const left = Math.min(la, lb)
  const width = Math.abs(lb - la)
  return (
    <div className="relative h-6 w-full" aria-hidden>
      <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border" />
      {/* boundary before the "not retrieved" zone */}
      <div
        className="absolute top-1/2 h-2.5 w-px -translate-y-1/2 bg-border"
        style={{ left: '88%' }}
      />
      {width > 0.5 && (
        <div
          className={cn('absolute top-1/2 h-[3px] -translate-y-1/2 rounded-full', connector)}
          style={{ left: `${left}%`, width: `${width}%` }}
        />
      )}
      <span
        className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-muted-foreground bg-background"
        style={{ left: `${la}%` }}
      />
      <span
        className={cn(
          'absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-background',
          dot
        )}
        style={{ left: `${lb}%` }}
      />
    </div>
  )
}

// ---------- Verdict (the hero) ----------

type Verdict = { kind: 'regression' | 'improvement' | 'stable'; dHit5: number; dMrr: number }

function computeVerdict(a: EvalRunDetail, b: EvalRunDetail): Verdict {
  const dHit5 = b.hit_at_5 - a.hit_at_5
  const dMrr = b.mrr - a.mrr
  if (dHit5 < -TOLERANCE || dMrr < -TOLERANCE) return { kind: 'regression', dHit5, dMrr }
  if (dHit5 > TOLERANCE || dMrr > TOLERANCE) return { kind: 'improvement', dHit5, dMrr }
  return { kind: 'stable', dHit5, dMrr }
}

const signedPp = (d: number) => `${d > 0 ? '+' : ''}${(d * 100).toFixed(1)}pp`
const signedMrr = (d: number) => `${d > 0 ? '+' : ''}${d.toFixed(3)}`

function VerdictBanner({ verdict }: { verdict: Verdict }) {
  const parts = [`Hit@5 ${signedPp(verdict.dHit5)}`, `MRR ${signedMrr(verdict.dMrr)}`].join(' · ')
  const map = {
    regression: {
      icon: AlertTriangle,
      title: 'Regression',
      sub: `Gated metric dropped beyond ±${(TOLERANCE * 100).toFixed(0)}pp — ${parts}`,
      box: 'border-rose-300 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40',
      accent: 'text-rose-600 dark:text-rose-400',
    },
    improvement: {
      icon: TrendingUp,
      title: 'Improved',
      sub: `${parts} — gated metrics up beyond tolerance.`,
      box: 'border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40',
      accent: 'text-emerald-600 dark:text-emerald-400',
    },
    stable: {
      icon: CheckCircle2,
      title: 'No regression',
      sub: `Gated metrics (Hit@5, MRR) held within ±${(TOLERANCE * 100).toFixed(0)}pp — ${parts}`,
      box: 'border-border bg-muted/40',
      accent: 'text-muted-foreground',
    },
  }[verdict.kind]
  const Icon = map.icon
  return (
    <div className={cn('flex items-start gap-3 rounded-xl border p-4', map.box)}>
      <Icon className={cn('mt-0.5 h-6 w-6 shrink-0', map.accent)} aria-hidden />
      <div>
        <p className={cn('text-lg font-semibold leading-tight', map.accent)}>{map.title}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{map.sub}</p>
      </div>
    </div>
  )
}

// ---------- Stat tiles (KPI row) ----------

function StatTile({
  label,
  a,
  b,
  kind,
  gated,
}: {
  label: string
  a: number
  b: number
  kind: 'pct' | 'ratio'
  gated?: boolean
}) {
  const d = b - a
  const fmtV = (x: number) => (kind === 'pct' ? `${(x * 100).toFixed(1)}%` : x.toFixed(3))
  const dir = Math.abs(d) < EPS ? 'flat' : d > 0 ? 'up' : 'down'
  const DirIcon = dir === 'up' ? TrendingUp : dir === 'down' ? TrendingDown : Minus
  const tone = dir === 'up' ? 'emerald' : dir === 'down' ? 'rose' : 'muted'
  const deltaStr = dir === 'flat' ? 'no change' : kind === 'pct' ? signedPp(d) : signedMrr(d)
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
        {gated ? (
          <span className="rounded bg-muted px-1 py-px text-[9px] font-semibold text-muted-foreground">
            gated
          </span>
        ) : null}
      </p>
      {/* Big value = candidate (B); proportional figures per stat-tile spec. */}
      <p className="mt-1 text-2xl font-semibold leading-none text-foreground">{fmtV(b)}</p>
      <p className={cn('mt-1.5 flex items-center gap-1 text-xs font-medium', TONE_TEXT[tone])}>
        <DirIcon className="h-3.5 w-3.5" aria-hidden />
        {deltaStr}
        <span className="font-normal text-muted-foreground">from {fmtV(a)}</span>
      </p>
    </div>
  )
}

// ---------- Changed-case row (expands to the retrieval source diff) ----------

function ChangedCaseRow({ row }: { row: DiffRow }) {
  const [open, setOpen] = useState(false)
  const { ca, cb, status, dMrr } = row
  const meta = STATUS_META[status]
  const c = ca ?? cb
  const expected = c?.expected_sources ?? []
  const canDiff = !!ca && !!cb && expected.length > 0
  return (
    <div className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-3 py-2.5 text-left hover:bg-muted/40"
        aria-expanded={open}
      >
        <ChevronRight
          className={cn(
            'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-90'
          )}
          aria-hidden
        />
        <span className="w-20 shrink-0 font-mono text-xs text-muted-foreground">{row.caseId}</span>
        <span className="min-w-0 flex-1 truncate text-sm text-foreground">{c?.query}</span>
        <span className={cn('shrink-0 text-xs font-medium', TONE_TEXT[meta.tone])}>
          {meta.label}
        </span>
        {dMrr != null && Math.abs(dMrr) > EPS ? (
          <span
            className={cn(
              'w-16 shrink-0 text-right font-mono text-xs tabular-nums',
              dMrr < 0 ? TONE_TEXT.rose : TONE_TEXT.emerald
            )}
          >
            {signedMrr(dMrr)}
          </span>
        ) : (
          <span className="w-16 shrink-0" />
        )}
      </button>

      {open ? (
        <div className="pb-3 pl-11 pr-2 text-xs">
          {canDiff ? (
            <div className="rounded-md border border-border bg-muted/30 p-3">
              <div className="mb-3 flex items-center justify-between text-[11px] text-muted-foreground">
                <span>Where each expected source ranked in retrieval</span>
                <span className="flex items-center gap-3">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full border border-muted-foreground bg-background" />
                    A
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-foreground" />B
                  </span>
                </span>
              </div>
              <div className="space-y-2.5">
                {expected.map(src => {
                  const ra = rankOf(ca!.retrieved_sources, src)
                  const rb = rankOf(cb!.retrieved_sources, src)
                  const scale = Math.max(
                    8,
                    ca!.retrieved_sources.length,
                    cb!.retrieved_sources.length
                  )
                  const dir =
                    rankScore(rb, scale) > rankScore(ra, scale)
                      ? 'worse'
                      : rankScore(rb, scale) < rankScore(ra, scale)
                        ? 'better'
                        : 'same'
                  return (
                    <div
                      key={src}
                      className="grid grid-cols-[minmax(6rem,10rem)_1fr_auto] items-center gap-3"
                    >
                      <span className="truncate font-mono text-[11px] text-foreground" title={src}>
                        {src}
                      </span>
                      <RankShift rankA={ra} rankB={rb} scale={scale} />
                      <span
                        className={cn(
                          'shrink-0 font-mono text-[11px] tabular-nums',
                          dir === 'worse'
                            ? TONE_TEXT.rose
                            : dir === 'better'
                              ? TONE_TEXT.emerald
                              : 'text-muted-foreground'
                        )}
                      >
                        {ra == null ? 'miss' : `#${ra}`} → {rb == null ? 'miss' : `#${rb}`}
                      </span>
                    </div>
                  )
                })}
              </div>
              <div className="mt-2 flex justify-between pl-[calc(6rem+0.75rem)] text-[10px] text-muted-foreground/70">
                <span>rank #1</span>
                <span>not retrieved</span>
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground">
              This case exists in only one run — no per-case retrieval diff.
            </p>
          )}
        </div>
      ) : null}
    </div>
  )
}

// Presentational results view — takes two loaded runs, renders the verdict, stat
// tiles, and per-case retrieval diff. Kept data-free so it can be previewed.
export function EvalCompareResults({ a, b }: { a: EvalRunDetail; b: EvalRunDetail }) {
  const [showAll, setShowAll] = useState(false)
  const comparable = a.dataset_path === b.dataset_path
  const aligned = useMemo(() => buildCaseIdAlignment(a, b), [a, b])
  const verdict = useMemo(() => (comparable ? computeVerdict(a, b) : null), [comparable, a, b])

  return (
    <>
      {/* Run identity — compact */}
      <div className="grid gap-3 sm:grid-cols-2">
        {[
          { run: a, tag: 'A', role: 'baseline' },
          { run: b, tag: 'B', role: 'candidate' },
        ].map(({ run, tag, role }) => (
          <div
            key={tag}
            className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2"
          >
            <div className="min-w-0">
              <p className="text-xs font-medium text-foreground">
                {tag} · {role}
              </p>
              <p className="truncate font-mono text-[11px] text-muted-foreground">{run.id}</p>
              <p className="text-[11px] text-muted-foreground">{run.created_at}</p>
            </div>
            <Button variant="link" className="h-auto shrink-0 p-0 text-xs" asChild>
              <Link href={`/eval/runs?id=${encodeURIComponent(run.id)}`}>Open</Link>
            </Button>
          </div>
        ))}
      </div>

      {!comparable ? (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Not comparable</AlertTitle>
          <AlertDescription className="text-sm">
            These runs use different datasets ({a.dataset_path} vs {b.dataset_path}), so per-case
            ids don&apos;t line up. Pick two runs on the same dataset to see a verdict and per-case
            diff.
          </AlertDescription>
        </Alert>
      ) : (
        <>
          {verdict ? <VerdictBanner verdict={verdict} /> : null}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatTile label="Hit@1" a={a.hit_at_1} b={b.hit_at_1} kind="pct" />
            <StatTile label="Hit@5" a={a.hit_at_5} b={b.hit_at_5} kind="pct" gated />
            <StatTile label="MRR" a={a.mrr} b={b.mrr} kind="ratio" gated />
          </div>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
              <div>
                <CardTitle className="text-base">
                  {aligned.changed.length === 0
                    ? 'No cases changed'
                    : `${aligned.changed.length} case${aligned.changed.length === 1 ? '' : 's'} changed`}
                </CardTitle>
                {aligned.onlyA + aligned.onlyB > 0 ? (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Coverage differs: {aligned.onlyA} only in A, {aligned.onlyB} only in B.
                  </p>
                ) : null}
              </div>
              {aligned.changed.length > 0 || showAll ? (
                <Button variant="outline" size="sm" onClick={() => setShowAll(v => !v)}>
                  {showAll ? 'Show changes only' : `Show all ${aligned.rows.length}`}
                </Button>
              ) : null}
            </CardHeader>
            <CardContent>
              {(() => {
                const list = showAll ? aligned.rows : aligned.changed
                if (list.length === 0) {
                  return (
                    <p className="py-4 text-sm text-muted-foreground">
                      Both runs scored every case identically — retrieval is deterministic, so an
                      unchanged system reproduces exactly. Expand a change to see the retrieval diff
                      that explains it.
                    </p>
                  )
                }
                return (
                  <div className="-my-1">
                    {list.map(row => (
                      <ChangedCaseRow key={row.caseId} row={row} />
                    ))}
                  </div>
                )
              })()}
            </CardContent>
          </Card>
        </>
      )}
    </>
  )
}

export default function EvalCompareClient({ runIdA, runIdB }: { runIdA: string; runIdB: string }) {
  const router = useRouter()
  const [a, setA] = useState<EvalRunDetail | null>(null)
  const [b, setB] = useState<EvalRunDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!runIdA || !runIdB || runIdA === runIdB) {
      setLoading(false)
      setError(runIdA === runIdB ? 'Pick two different runs' : 'Missing run ids')
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const [da, db] = await Promise.all([fetchEvalRunDetail(runIdA), fetchEvalRunDetail(runIdB)])
        if (!cancelled) {
          setA(da)
          setB(db)
        }
      } catch (e) {
        const raw = e instanceof Error ? e.message : 'Failed to load runs'
        if (!cancelled) setError(shortFetchError(raw))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [runIdA, runIdB])

  return (
    <div className="min-h-screen bg-background pb-12 pt-6 md:pb-16 md:pt-8">
      <div className="mx-auto max-w-4xl space-y-6 px-4 md:px-8">
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
          <div className="flex items-center gap-2 text-foreground">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-card shadow-sm ring-1 ring-border">
              <GitCompareArrows className="h-4 w-4 text-muted-foreground" />
            </div>
            <div>
              <h1 className="text-lg font-semibold leading-tight">Compare eval runs</h1>
              <p className="text-xs text-muted-foreground">Run A (baseline) → Run B (candidate)</p>
            </div>
          </div>
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertTitle>Error</AlertTitle>
            <AlertDescription className="text-sm">{error}</AlertDescription>
          </Alert>
        )}

        {a && b && !loading && <EvalCompareResults a={a} b={b} />}
      </div>
    </div>
  )
}
