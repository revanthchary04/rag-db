'use client'

/**
 * MetricsView — presentational RAG observability dashboard.
 *
 * Leads with the pipeline: a RAG answer is a multi-stage pipeline (embed query →
 * vector search → generate), and the hero visual shows where a typical (p50)
 * answer spends its time, because a single latency number can only say "slow".
 * Every value maps to a real field from GET /metrics (see docs/API_CONTRACT.md);
 * nothing here is synthesized.
 */

export interface Percentiles {
  p50_ms: number
  p95_ms: number
  p99_ms: number
}

export interface RouteMetrics {
  request_count: number
  status_counts: Record<string, number>
  latency_buckets: Record<string, number>
  avg_latency_ms: number
  total_latency_ms: number
  percentiles?: Percentiles
}

export interface StageMetrics {
  count: number
  avg_latency_ms: number
  percentiles: Percentiles
}

export interface MetricsData {
  uptime_seconds: number
  routes: Record<string, RouteMetrics>
  stages?: Record<string, StageMetrics>
  token_usage: {
    embedding_prompt_tokens: number
    embedding_total_tokens: number
    chat_prompt_tokens: number
    chat_completion_tokens: number
    chat_total_tokens: number
  }
  note: string
}

const STAGE_LABELS: Record<string, string> = {
  retrieve: 'Retrieve',
  embedding: 'Embed query',
  'db.vector_search': 'Vector search',
  chat_completion: 'Generate',
  chat_completion_stream: 'Generate (stream)',
  generate: 'Generate',
}

// Leaf stages whose p50 latencies compose the end-to-end answer, in pipeline order.
// `retrieve` is the parent of embed + vector-search, so it is excluded here to
// avoid double-counting; it still appears in the per-stage detail below.
const COMPOSITION_ORDER = [
  'embedding',
  'db.vector_search',
  'chat_completion',
  'chat_completion_stream',
]

function fmtMs(ms: number): string {
  if (!isFinite(ms)) return '—'
  if (ms < 1) return '<1ms'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

function fmtUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function fmtCost(usd: number): string {
  if (usd === 0) return '$0'
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(2)}`
}

/** A labelled number in the demoted summary strip. */
function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-1 px-4 first:pl-0">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="font-mono text-lg font-semibold tabular-nums text-foreground">{value}</span>
      {sub && <span className="text-[11px] text-muted-foreground">{sub}</span>}
    </div>
  )
}

export function MetricsView({ data }: { data: MetricsData }) {
  const queryRoute = data.routes['/api/v1/query'] || data.routes['/query']
  const totalRequests = Object.values(data.routes).reduce((sum, r) => sum + r.request_count, 0)
  const totalErrors = Object.values(data.routes).reduce(
    (sum, r) =>
      sum +
      Object.entries(r.status_counts).reduce(
        (e, [code, n]) => (code.startsWith('5') ? e + n : e),
        0
      ),
    0
  )
  const successRate =
    totalRequests > 0 ? ((totalRequests - totalErrors) / totalRequests) * 100 : 100

  const embedCost = (data.token_usage.embedding_total_tokens / 1000) * 0.00002
  const chatCost =
    (data.token_usage.chat_prompt_tokens / 1000) * 0.00015 +
    (data.token_usage.chat_completion_tokens / 1000) * 0.0006
  const totalCost = embedCost + chatCost
  const totalTokens = data.token_usage.embedding_total_tokens + data.token_usage.chat_total_tokens

  const stages = data.stages ?? {}
  const stageEntries = Object.entries(stages)
  const hasStages = stageEntries.length > 0

  // End-to-end composition: leaf stages present, in pipeline order, sized by p50.
  const composition = COMPOSITION_ORDER.filter(k => stages[k]).map(k => ({
    key: k,
    label: STAGE_LABELS[k] ?? k,
    p50: stages[k].percentiles.p50_ms,
  }))
  const compositionTotal = composition.reduce((sum, s) => sum + s.p50, 0)
  const dominant = [...composition].sort((a, b) => b.p50 - a.p50)[0]
  const dominantShare =
    dominant && compositionTotal > 0 ? (dominant.p50 / compositionTotal) * 100 : 0
  // Smallest non-trivial leaf, to make the "and X is only Yms" point.
  const smallest = [...composition].sort((a, b) => a.p50 - b.p50)[0]

  // Per-stage detail bars share one scale: the global max p99 across stages.
  const scaleMax = Math.max(1, ...stageEntries.map(([, s]) => s.percentiles.p99_ms))

  return (
    <div className="space-y-12">
      {/* Demoted summary strip — context, not the headline. */}
      <div className="flex flex-wrap items-stretch divide-x divide-border">
        <Stat label="Uptime" value={fmtUptime(data.uptime_seconds)} />
        <Stat
          label="Requests"
          value={totalRequests.toLocaleString()}
          sub={`${totalErrors} errors`}
        />
        <Stat label="Success" value={`${successRate.toFixed(successRate === 100 ? 0 : 1)}%`} />
        {queryRoute?.percentiles && (
          <Stat label="Query p95" value={fmtMs(queryRoute.percentiles.p95_ms)} sub="end to end" />
        )}
        <Stat label="Est. cost" value={fmtCost(totalCost)} sub="embed + chat" />
        <Stat label="Tokens" value={totalTokens.toLocaleString()} />
      </div>

      {/* HERO — RAG query pipeline. */}
      <section aria-labelledby="pipeline-heading">
        <div className="mb-1 flex items-baseline justify-between gap-4">
          <h2 id="pipeline-heading" className="text-base font-semibold text-foreground">
            RAG query pipeline
          </h2>
          {hasStages && (
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {fmtMs(compositionTotal)} · p50 end to end
            </span>
          )}
        </div>
        <p className="mb-6 max-w-[68ch] text-sm text-muted-foreground">
          One answer is a pipeline, not a call. Per-stage latency below is the aggregate across
          every request, so you can see <em>where</em> time goes rather than only that it is slow.
        </p>

        {!hasStages ? (
          <div className="rounded-lg border border-dashed border-border px-5 py-8 text-center text-sm text-muted-foreground">
            No pipeline spans recorded yet. Run a query and the per-stage breakdown appears here
            (populated from OpenTelemetry-instrumented spans).
          </div>
        ) : (
          <>
            {/* End-to-end composition strip — the signature visual. */}
            {composition.length > 0 && compositionTotal > 0 && (
              <div className="mb-8">
                <div className="flex h-9 w-full overflow-hidden rounded-md bg-muted">
                  {composition.map((s, i) => {
                    const share = (s.p50 / compositionTotal) * 100
                    // Mono identity: one ink, stepped opacity + hairline gaps for separation.
                    const opacities = [1, 0.45, 0.72, 0.72]
                    return (
                      <div
                        key={s.key}
                        className="relative h-full min-w-[2px] border-r border-background last:border-r-0"
                        style={{
                          width: `${share}%`,
                          background: `color-mix(in srgb, var(--color-foreground) ${
                            opacities[i] * 100
                          }%, transparent)`,
                        }}
                        title={`${s.label}: ${fmtMs(s.p50)} p50 (${share.toFixed(0)}%)`}
                      />
                    )
                  })}
                </div>
                {/* Legend aligned to the strip. */}
                <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
                  {composition.map((s, i) => {
                    const opacities = [1, 0.45, 0.72, 0.72]
                    const share = (s.p50 / compositionTotal) * 100
                    return (
                      <div key={s.key} className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                          style={{
                            background: `color-mix(in srgb, var(--color-foreground) ${
                              opacities[i] * 100
                            }%, transparent)`,
                          }}
                        />
                        <span className="text-xs text-foreground">{s.label}</span>
                        <span className="font-mono text-xs tabular-nums text-muted-foreground">
                          {fmtMs(s.p50)} · {share.toFixed(0)}%
                        </span>
                      </div>
                    )
                  })}
                </div>
                {dominant && smallest && dominant.key !== smallest.key && (
                  <p className="mt-4 max-w-[68ch] text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">{dominant.label}</span> is{' '}
                    {dominantShare.toFixed(0)}% of a typical answer
                    {smallest.p50 < compositionTotal * 0.1 && (
                      <>
                        , while{' '}
                        <span className="font-medium text-foreground">{smallest.label}</span> is
                        just {fmtMs(smallest.p50)}
                      </>
                    )}
                    . A single latency number could not tell you that.
                  </p>
                )}
              </div>
            )}

            {/* Per-stage distribution — p50 solid, p50→p95 translucent, p99 tick. */}
            <div className="rounded-lg border border-border">
              <div className="flex items-center justify-between border-b border-border px-4 py-2.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                <span>Stage</span>
                <span className="font-mono">p50 · p95 · p99</span>
              </div>
              <div className="divide-y divide-border">
                {stageEntries.map(([key, s]) => {
                  const p50w = (s.percentiles.p50_ms / scaleMax) * 100
                  const p95w = (s.percentiles.p95_ms / scaleMax) * 100
                  const p99x = (s.percentiles.p99_ms / scaleMax) * 100
                  return (
                    <div key={key} className="px-4 py-3">
                      <div className="mb-1.5 flex items-baseline justify-between gap-4">
                        <span className="text-sm font-medium text-foreground">
                          {STAGE_LABELS[key] ?? key}
                          <span className="ml-2 font-mono text-xs tabular-nums text-muted-foreground">
                            {s.count.toLocaleString()}×
                          </span>
                        </span>
                        <span className="font-mono text-xs tabular-nums text-muted-foreground">
                          <span className="text-foreground">{fmtMs(s.percentiles.p50_ms)}</span> ·{' '}
                          {fmtMs(s.percentiles.p95_ms)} · {fmtMs(s.percentiles.p99_ms)}
                        </span>
                      </div>
                      <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
                        {/* p50 → p95 translucent spread */}
                        <div
                          className="absolute inset-y-0 left-0 rounded-full bg-foreground/25"
                          style={{ width: `${Math.min(100, p95w)}%` }}
                        />
                        {/* solid to p50 */}
                        <div
                          className="absolute inset-y-0 left-0 rounded-full bg-foreground transition-[width] duration-500 ease-out"
                          style={{ width: `${Math.min(100, p50w)}%` }}
                        />
                        {/* p99 tick */}
                        <div
                          className="absolute inset-y-0 w-px bg-foreground/60"
                          style={{ left: `${Math.min(100, p99x)}%` }}
                          aria-hidden
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </>
        )}
      </section>

      {/* Query latency distribution. */}
      {queryRoute && (
        <section aria-labelledby="dist-heading">
          <div className="mb-1 flex items-baseline justify-between gap-4">
            <h2 id="dist-heading" className="text-base font-semibold text-foreground">
              Query latency distribution
            </h2>
            {queryRoute.percentiles && (
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                p50 {fmtMs(queryRoute.percentiles.p50_ms)} · p95{' '}
                {fmtMs(queryRoute.percentiles.p95_ms)} · p99 {fmtMs(queryRoute.percentiles.p99_ms)}
              </span>
            )}
          </div>
          <p className="mb-5 text-sm text-muted-foreground">
            {queryRoute.request_count.toLocaleString()} requests to{' '}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
              /api/v1/query
            </code>
          </p>
          <div className="space-y-2.5">
            {(() => {
              const total = Object.values(queryRoute.latency_buckets).reduce((a, b) => a + b, 0)
              const max = Math.max(1, ...Object.values(queryRoute.latency_buckets))
              return Object.entries(queryRoute.latency_buckets).map(([bucket, count]) => {
                const pct = total > 0 ? (count / total) * 100 : 0
                return (
                  <div key={bucket} className="flex items-center gap-3">
                    <span className="w-20 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
                      {bucket}
                    </span>
                    <div className="relative h-5 flex-1 overflow-hidden rounded bg-muted">
                      <div
                        className="h-full bg-foreground/80 transition-[width] duration-500 ease-out"
                        style={{ width: `${(count / max) * 100}%` }}
                      />
                    </div>
                    <span className="w-24 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                      {count.toLocaleString()}{' '}
                      <span className="text-muted-foreground/60">({pct.toFixed(0)}%)</span>
                    </span>
                  </div>
                )
              })
            })()}
          </div>
        </section>
      )}

      {/* Cost & tokens split. */}
      <section aria-labelledby="cost-heading">
        <div className="mb-1 flex items-baseline justify-between gap-4">
          <h2 id="cost-heading" className="text-base font-semibold text-foreground">
            Cost &amp; tokens
          </h2>
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {fmtCost(totalCost)} · {totalTokens.toLocaleString()} tok
          </span>
        </div>
        <p className="mb-5 text-sm text-muted-foreground">
          Estimated from token counters at embedding-3-small and gpt-4o-mini rates.
        </p>
        {totalTokens > 0 && (
          <div className="mb-4 flex h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-foreground"
              style={{
                width: `${(data.token_usage.chat_total_tokens / totalTokens) * 100}%`,
              }}
              title="Chat tokens"
            />
            <div
              className="h-full bg-foreground/40"
              style={{
                width: `${(data.token_usage.embedding_total_tokens / totalTokens) * 100}%`,
              }}
              title="Embedding tokens"
            />
          </div>
        )}
        <div className="grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
          <div className="flex items-center justify-between border-b border-border py-1.5 text-sm">
            <span className="flex items-center gap-2 text-foreground">
              <span className="h-2.5 w-2.5 rounded-[3px] bg-foreground" />
              Chat completion
            </span>
            <span className="font-mono tabular-nums text-muted-foreground">
              {data.token_usage.chat_total_tokens.toLocaleString()} tok · {fmtCost(chatCost)}
            </span>
          </div>
          <div className="flex items-center justify-between border-b border-border py-1.5 text-sm">
            <span className="flex items-center gap-2 text-foreground">
              <span className="h-2.5 w-2.5 rounded-[3px] bg-foreground/40" />
              Embedding
            </span>
            <span className="font-mono tabular-nums text-muted-foreground">
              {data.token_usage.embedding_total_tokens.toLocaleString()} tok · {fmtCost(embedCost)}
            </span>
          </div>
        </div>
      </section>

      {/* All routes. */}
      {Object.keys(data.routes).length > 0 && (
        <section aria-labelledby="routes-heading">
          <h2 id="routes-heading" className="mb-4 text-base font-semibold text-foreground">
            Routes
          </h2>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2.5 text-left font-medium">Route</th>
                  <th className="px-4 py-2.5 text-right font-medium">Requests</th>
                  <th className="px-4 py-2.5 text-right font-medium">p50</th>
                  <th className="px-4 py-2.5 text-right font-medium">p95</th>
                  <th className="px-4 py-2.5 text-right font-medium">Success</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {Object.entries(data.routes)
                  .sort((a, b) => b[1].request_count - a[1].request_count)
                  .map(([route, r]) => {
                    const ok = r.status_counts['200'] || 0
                    const rate = r.request_count > 0 ? (ok / r.request_count) * 100 : 0
                    return (
                      <tr key={route}>
                        <td className="px-4 py-2.5">
                          <code className="font-mono text-xs text-foreground">{route}</code>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums text-muted-foreground">
                          {r.request_count.toLocaleString()}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums text-muted-foreground">
                          {r.percentiles ? fmtMs(r.percentiles.p50_ms) : fmtMs(r.avg_latency_ms)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums text-muted-foreground">
                          {r.percentiles ? fmtMs(r.percentiles.p95_ms) : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums text-muted-foreground">
                          {rate.toFixed(rate === 100 ? 0 : 1)}%
                        </td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Note — neutral, on-identity (not a yellow alert). */}
      {data.note && (
        <p className="border-t border-border pt-4 text-xs text-muted-foreground">{data.note}</p>
      )}
    </div>
  )
}
