'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/page-header'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { fetchQueryLogsList, type QueryLogDetail } from '@/lib/api/client'
import { shortFetchError } from '@/lib/fetch-error'

function fmtMs(ms: number | null): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

function fmtCost(usd: number | null): string {
  if (usd == null) return '—'
  if (usd === 0) return '$0'
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(2)}`
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** A labelled figure in the detail panel. */
function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd
        className={`mt-0.5 text-foreground ${mono ? 'font-mono text-sm tabular-nums' : 'text-sm'}`}
      >
        {value}
      </dd>
    </div>
  )
}

export default function QueryLogsExplorerClient() {
  const [logs, setLogs] = useState<QueryLogDetail[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [ragModel, setRagModel] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState<QueryLogDetail | null>(null)
  const limit = 40

  const load = useCallback(
    async (nextOffset: number) => {
      setLoading(true)
      setError(null)
      try {
        const data = await fetchQueryLogsList({
          limit,
          offset: nextOffset,
          rag_model: ragModel.trim() || undefined,
          start_date: startDate.trim() ? `${startDate.trim()}T00:00:00` : undefined,
          end_date: endDate.trim() ? `${endDate.trim()}T23:59:59` : undefined,
        })
        setLogs(data.logs)
        setOffset(nextOffset)
      } catch (e) {
        setError(shortFetchError(e instanceof Error ? e.message : 'Failed to load'))
      } finally {
        setLoading(false)
      }
    },
    [ragModel, startDate, endDate]
  )

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      setError(null)
      try {
        const data = await fetchQueryLogsList({ limit, offset: 0 })
        if (!cancelled) {
          setLogs(data.logs)
          setOffset(0)
        }
      } catch (e) {
        if (!cancelled) setError(shortFetchError(e instanceof Error ? e.message : 'Failed to load'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const applyFilters = () => void load(0)

  // Latency bars share one scale so slow queries stand out at a glance.
  const maxLatency = useMemo(() => Math.max(1, ...logs.map(l => l.latency_ms ?? 0)), [logs])

  return (
    <div className="min-h-screen bg-background pb-12 pt-6 md:pb-16 md:pt-8">
      <div className="mx-auto max-w-6xl space-y-6 px-4 md:px-8">
        <PageHeader
          title="Query logs"
          subtitle="Every RAG request, with latency and cost — the same rows chat and evals link to"
        />

        {/* Filters — inline, not a card */}
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <label className="flex min-w-[8rem] flex-1 flex-col gap-1 text-xs font-medium text-muted-foreground">
            RAG model
            <Input
              placeholder="e.g. vector-similarity"
              value={ragModel}
              onChange={e => setRagModel(e.target.value)}
              className="h-9"
            />
          </label>
          <label className="flex min-w-[8rem] flex-1 flex-col gap-1 text-xs font-medium text-muted-foreground">
            From
            <Input
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              className="h-9"
            />
          </label>
          <label className="flex min-w-[8rem] flex-1 flex-col gap-1 text-xs font-medium text-muted-foreground">
            To
            <Input
              type="date"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
              className="h-9"
            />
          </label>
          <div className="flex gap-2">
            <Button type="button" onClick={applyFilters} disabled={loading}>
              Apply
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void load(offset)}
              disabled={loading}
            >
              <RefreshCw className={`mr-1 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {loading && logs.length === 0 ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : null}

        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[720px] text-sm">
            <caption className="sr-only">Query audit log entries</caption>
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2.5 font-medium" scope="col">
                  Time
                </th>
                <th className="px-3 py-2.5 font-medium" scope="col">
                  Query
                </th>
                <th className="px-3 py-2.5 font-medium" scope="col">
                  Model
                </th>
                <th className="px-3 py-2.5 text-right font-medium" scope="col">
                  Latency
                </th>
                <th className="px-3 py-2.5 text-right font-medium" scope="col">
                  Cost
                </th>
                <th className="px-3 py-2.5 text-right font-medium" scope="col">
                  Cites
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {logs.map(log => (
                <tr
                  key={log.id}
                  className="cursor-pointer transition-colors hover:bg-muted/50"
                  onClick={() => setSelected(log)}
                >
                  <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs tabular-nums text-muted-foreground">
                    {fmtTime(log.created_at)}
                  </td>
                  <td className="max-w-sm truncate px-3 py-2.5 text-xs text-foreground">
                    {log.query_text}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5">
                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                      {log.rag_model}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="flex items-center justify-end gap-2">
                      <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-muted sm:block">
                        <span
                          className="block h-full rounded-full bg-foreground/70"
                          style={{ width: `${((log.latency_ms ?? 0) / maxLatency) * 100}%` }}
                        />
                      </span>
                      <span className="w-14 text-right font-mono text-xs tabular-nums text-foreground">
                        {fmtMs(log.latency_ms)}
                      </span>
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums text-muted-foreground">
                    {fmtCost(log.cost_usd)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums text-muted-foreground">
                    {log.citations_count ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {logs.length === 0 && !loading ? (
            <p className="p-6 text-center text-sm text-muted-foreground">No rows match.</p>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            Same rows via <code className="rounded bg-muted px-1">query_log_id</code> in chat and{' '}
            <Link href="/eval/runs" className="text-foreground underline-offset-2 hover:underline">
              eval runs
            </Link>
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loading || offset === 0}
              onClick={() => void load(Math.max(0, offset - limit))}
            >
              Previous
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loading || logs.length < limit}
              onClick={() => void load(offset + limit)}
            >
              Next
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={selected != null} onOpenChange={open => !open && setSelected(null)}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Query log</DialogTitle>
          </DialogHeader>
          {selected ? (
            <div className="space-y-5">
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Query</dt>
                <dd className="mt-1 whitespace-pre-wrap text-sm text-foreground">
                  {selected.query_text}
                </dd>
              </div>

              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Field label="Latency" value={fmtMs(selected.latency_ms)} mono />
                <Field label="Cost" value={fmtCost(selected.cost_usd)} mono />
                <Field
                  label="Tokens"
                  value={
                    selected.token_usage?.total_tokens != null
                      ? selected.token_usage.total_tokens.toLocaleString()
                      : '—'
                  }
                  mono
                />
                <Field label="Citations" value={String(selected.citations_count ?? '—')} mono />
                <Field label="Model" value={selected.rag_model} />
                <Field
                  label="top_k"
                  value={selected.top_k != null ? String(selected.top_k) : '—'}
                  mono
                />
                <Field
                  label="Answer len"
                  value={selected.answer_length != null ? `${selected.answer_length} ch` : '—'}
                  mono
                />
                <Field label="Created" value={fmtTime(selected.created_at)} mono />
              </dl>

              {selected.token_usage && Object.keys(selected.token_usage).length > 0 ? (
                <div>
                  <dt className="mb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                    Token breakdown
                  </dt>
                  <dl className="divide-y divide-border rounded-md border border-border">
                    {Object.entries(selected.token_usage).map(([k, v]) => (
                      <div
                        key={k}
                        className="flex items-center justify-between px-3 py-1.5 text-sm"
                      >
                        <dt className="text-muted-foreground">{k.replace(/_/g, ' ')}</dt>
                        <dd className="font-mono tabular-nums text-foreground">
                          {v.toLocaleString()}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ) : null}

              <div className="grid gap-3 text-xs text-muted-foreground sm:grid-cols-2">
                <div>
                  <dt className="text-[11px] uppercase tracking-wide">Query log id</dt>
                  <dd className="mt-0.5 font-mono break-all">{selected.id}</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wide">Request id</dt>
                  <dd className="mt-0.5 font-mono break-all">{selected.request_id ?? '—'}</dd>
                </div>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
