import type { EvalRunDetail } from '@/lib/api/client'

function downloadBlob(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function csvCell(v: string | number | boolean | null | undefined): string {
  if (v == null) return ''
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'number') return String(v)
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`
  return v
}

function csvLine(cells: (string | number | boolean | null | undefined)[]) {
  return cells.map(csvCell).join(',')
}

/** Per-case CSV from a run detail (aligned with server export). */
export function evalRunDetailToCsv(run: EvalRunDetail): string {
  const lines: string[] = []
  lines.push(
    csvLine([
      'run_id',
      'created_at',
      'dataset_path',
      'hit_at_1',
      'hit_at_3',
      'hit_at_5',
      'hit_at_8',
      'mrr',
      'successful',
      'failed',
      'total_cases',
    ])
  )
  lines.push(
    csvLine([
      run.id,
      run.created_at,
      run.dataset_path,
      run.hit_at_1,
      run.hit_at_3,
      run.hit_at_5,
      run.hit_at_8,
      run.mrr,
      run.successful,
      run.failed,
      run.total_cases,
    ])
  )
  lines.push('')
  lines.push(
    csvLine([
      'case_index',
      'case_id',
      'query',
      'hit_at_1',
      'hit_at_3',
      'hit_at_5',
      'hit_at_8',
      'mrr',
      'error',
    ])
  )
  for (const c of run.cases) {
    lines.push(
      csvLine([
        c.case_index,
        c.case_id,
        c.query,
        c.hit_at_1,
        c.hit_at_3,
        c.hit_at_5,
        c.hit_at_8,
        c.mrr,
        c.error ?? '',
      ])
    )
  }
  return lines.join('\n')
}

export function downloadEvalRunJson(run: EvalRunDetail) {
  downloadBlob(`eval-run-${run.id}.json`, JSON.stringify(run, null, 2), 'application/json')
}

export function downloadEvalRunCsv(run: EvalRunDetail) {
  downloadBlob(`eval-run-${run.id}.csv`, evalRunDetailToCsv(run), 'text/csv;charset=utf-8')
}
