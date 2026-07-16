/**
 * StrategiesView — presentational retrieval-strategy comparison.
 *
 * The product's thesis, made visible: "which retriever should I use?" is a
 * question you answer with numbers, and the numbers trade off. Renders the
 * committed benchmark (see lib/strategy-benchmark.ts) in the Mono identity —
 * one ink, stepped opacity, distinction from type + spacing, not colour.
 */

import { STRATEGY_BENCHMARK, STRATEGY_COPY, type StrategyResult } from '@/lib/strategy-benchmark'

const { results, nCases, topK, embeddingModel, chatModel, generatedAt } = STRATEGY_BENCHMARK

function fmtLatency(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`
}

function fmtCost(usd: number): string {
  if (usd < 0.001) return `$${usd.toFixed(4)}`
  if (usd < 1) return `$${usd.toFixed(3)}`
  return `$${usd.toFixed(2)}`
}

const best = {
  hitAt1: Math.max(...results.map(r => r.hitAt1)),
  hitAt5: Math.max(...results.map(r => r.hitAt5)),
  mrr: Math.max(...results.map(r => r.mrr)),
  latency: Math.min(...results.map(r => r.latencyP50Ms)),
  cost: Math.min(...results.map(r => r.costPer1kUsd)),
}
const maxLatency = Math.max(...results.map(r => r.latencyP95Ms))
const maxCost = Math.max(...results.map(r => r.costPer1kUsd))

/** A metric cell: value + a bar. Quality bars fill by value; cost/latency bars
 * fill by share of the worst, so a long bar always reads as "more (worse)". */
function Metric({
  value,
  bar,
  isBest,
  higherIsBetter,
  delay,
}: {
  value: string
  bar: number // 0..1
  isBest: boolean
  higherIsBetter: boolean
  delay: number
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span
        className={`font-mono text-sm tabular-nums ${
          isBest ? 'font-semibold text-foreground' : 'text-muted-foreground'
        }`}
      >
        {value}
        {isBest && higherIsBetter && (
          <span className="ml-1 text-[10px] font-normal text-muted-foreground/70">best</span>
        )}
      </span>
      <span className="relative h-1 w-full overflow-hidden rounded-full bg-muted">
        <span
          className="strat-bar absolute inset-y-0 left-0 rounded-full"
          style={{
            width: `${Math.max(2, bar * 100)}%`,
            transitionDelay: `${delay}ms`,
            background: isBest
              ? 'var(--color-foreground)'
              : `color-mix(in srgb, var(--color-foreground) ${higherIsBetter ? 55 : 40}%, transparent)`,
          }}
        />
      </span>
    </div>
  )
}

function StrategyRow({ r, index }: { r: StrategyResult; index: number }) {
  const copy = STRATEGY_COPY[r.strategy]
  const base = index * 60
  return (
    <div className="strat-row grid grid-cols-1 gap-x-6 gap-y-4 px-5 py-5 sm:grid-cols-[minmax(0,1.4fr)_repeat(5,minmax(0,1fr))] sm:items-center">
      {/* Identity */}
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <h3 className="text-sm font-semibold text-foreground">{copy?.label ?? r.strategy}</h3>
          <code className="hidden font-mono text-[11px] text-muted-foreground/70 lg:inline">
            {r.strategy}
          </code>
        </div>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{copy?.howItWorks}</p>
      </div>

      <Metric
        value={`${(r.hitAt1 * 100).toFixed(1)}%`}
        bar={r.hitAt1}
        isBest={r.hitAt1 === best.hitAt1}
        higherIsBetter
        delay={base}
      />
      <Metric
        value={`${(r.hitAt5 * 100).toFixed(1)}%`}
        bar={r.hitAt5}
        isBest={r.hitAt5 === best.hitAt5}
        higherIsBetter
        delay={base + 40}
      />
      <Metric
        value={r.mrr.toFixed(3)}
        bar={r.mrr}
        isBest={r.mrr === best.mrr}
        higherIsBetter
        delay={base + 80}
      />
      <Metric
        value={fmtLatency(r.latencyP50Ms)}
        bar={r.latencyP95Ms / maxLatency}
        isBest={r.latencyP50Ms === best.latency}
        higherIsBetter={false}
        delay={base + 120}
      />
      <Metric
        value={fmtCost(r.costPer1kUsd)}
        bar={r.costPer1kUsd / maxCost}
        isBest={r.costPer1kUsd === best.cost}
        higherIsBetter={false}
        delay={base + 160}
      />
    </div>
  )
}

export function StrategiesView() {
  const vector = results.find(r => r.strategy === 'vector-similarity')!
  const rerank = results.find(r => r.strategy === 'reranking')!
  const recallGain = (rerank.hitAt5 - vector.hitAt5) * 100
  const latencyMult = rerank.latencyP50Ms / vector.latencyP50Ms
  const costMult = rerank.costPer1kUsd / vector.costPer1kUsd
  // Bars encode the "paid" multipliers on a shared log scale (cost = full), so
  // the two costs stay comparable while cost still visibly dwarfs latency. The
  // recall gain is a small fixed sliver — it is a fraction of a point, not a
  // multiple — which is exactly the point the section makes.
  const logCost = Math.log10(costMult)
  const latencyMagnitude = Math.log10(latencyMult) / logCost

  return (
    <div className="space-y-12">
      {/* Lede */}
      <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
        The repo ships four retrieval strategies. Rather than assert which is best, the same harness
        that gates CI <span className="text-foreground">measures</span> them on the bundled corpus.
        The result is a trade-off, not a leaderboard — read down each column and watch quality,
        latency, and cost pull against each other.
      </p>

      {/* Comparison table */}
      <section aria-labelledby="compare-heading">
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <h2 id="compare-heading" className="text-base font-semibold text-foreground">
            Four strategies, measured
          </h2>
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {nCases} cases · top_k {topK}
          </span>
        </div>
        <div className="overflow-hidden rounded-xl border border-border">
          {/* Column header — hidden on mobile where rows stack. */}
          <div className="hidden grid-cols-[minmax(0,1.4fr)_repeat(5,minmax(0,1fr))] gap-x-6 border-b border-border bg-muted/40 px-5 py-2.5 text-[11px] uppercase tracking-wide text-muted-foreground sm:grid">
            <span>Strategy</span>
            <span>Hit@1</span>
            <span>Hit@5</span>
            <span>MRR</span>
            <span>Latency p50</span>
            <span>Cost / 1k</span>
          </div>
          <div className="divide-y divide-border">
            {results.map((r, i) => (
              <StrategyRow key={r.strategy} r={r} index={i} />
            ))}
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Retrieval-stage figures only — generation is strategy-independent. Latency is wall-clock
          around <code className="font-mono text-[11px]">retrieve()</code>; cost is measured OpenAI
          token usage at public rates. Quality bars fill by score; latency and cost bars fill by
          share of the slowest / priciest, so a longer bar always means more.
        </p>
      </section>

      {/* The signature insight: the price of recall. */}
      <section aria-labelledby="tradeoff-heading">
        <h2 id="tradeoff-heading" className="mb-1 text-base font-semibold text-foreground">
          There is no free lunch
        </h2>
        <p className="mb-6 max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          Reranking has the best top-5 recall — but it gets there by reshuffling the top-k, which
          costs it top-1 precision, and it pays in latency and dollars. Plain vector similarity
          keeps the best MRR for a rounding error of the cost.
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          <TradeoffCard
            label="Recall bought"
            value={`+${recallGain.toFixed(1)}pp`}
            sub="Hit@5 vs. vector similarity"
            magnitude={0.08}
          />
          <TradeoffCard
            label="Latency paid"
            value={`${latencyMult.toFixed(0)}×`}
            sub="slower per query"
            magnitude={latencyMagnitude}
          />
          <TradeoffCard
            label="Cost paid"
            value={`${Math.round(costMult).toLocaleString()}×`}
            sub="more expensive"
            magnitude={1}
          />
        </div>
      </section>

      {/* When to reach for each. */}
      <section aria-labelledby="pick-heading">
        <h2 id="pick-heading" className="mb-4 text-base font-semibold text-foreground">
          When to reach for each
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {results.map(r => {
            const copy = STRATEGY_COPY[r.strategy]
            return (
              <div
                key={r.strategy}
                className="rounded-lg border border-border px-4 py-3.5 transition-colors hover:border-foreground/25"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-sm font-semibold text-foreground">{copy?.label}</h3>
                  <code className="font-mono text-[11px] text-muted-foreground/70">
                    {r.strategy}
                  </code>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                  {copy?.bestFor}
                </p>
              </div>
            )
          })}
        </div>
      </section>

      {/* Provenance. */}
      <section className="border-t border-border pt-5">
        <p className="text-xs leading-relaxed text-muted-foreground">
          Reference run · {generatedAt} · {embeddingModel} + {chatModel}. Reproduce from{' '}
          <code className="font-mono text-[11px] text-foreground">backend/</code>:{' '}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
            uv run python eval/benchmark_strategies.py
          </code>
          . Method and full numbers in{' '}
          <a
            className="text-foreground underline decoration-muted-foreground/40 underline-offset-2 transition-colors hover:decoration-foreground"
            href="https://github.com/Padraigobrien08/rag-eval-observe/blob/main/docs/BENCHMARKS.md"
            target="_blank"
            rel="noreferrer"
          >
            docs/BENCHMARKS.md
          </a>
          .
        </p>
      </section>
    </div>
  )
}

function TradeoffCard({
  label,
  value,
  sub,
  magnitude,
}: {
  label: string
  value: string
  sub: string
  magnitude: number // 0..1, drives bar fill
}) {
  return (
    <div className="rounded-lg border border-border px-4 py-4">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-foreground">
        {value}
      </div>
      <span className="text-xs text-muted-foreground">{sub}</span>
      <span className="mt-3 block h-1 w-full overflow-hidden rounded-full bg-muted">
        <span
          className="strat-bar block h-full rounded-full bg-foreground/70"
          style={{ width: `${Math.max(6, magnitude * 100)}%` }}
        />
      </span>
    </div>
  )
}
