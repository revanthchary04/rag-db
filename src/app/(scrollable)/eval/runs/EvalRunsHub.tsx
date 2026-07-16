'use client'

import { useSearchParams } from 'next/navigation'
import EvalCompareClient from './EvalCompareClient'
import EvalRunDetailClient from './EvalRunDetailClient'
import EvalRunsListClient from './EvalRunsListClient'

export default function EvalRunsHub() {
  const sp = useSearchParams()
  const id = sp.get('id')
  const compare = sp.get('compare')
  const to = sp.get('to')
  if (id) return <EvalRunDetailClient runId={id} />
  if (compare && to) return <EvalCompareClient runIdA={compare} runIdB={to} />
  return <EvalRunsListClient />
}
