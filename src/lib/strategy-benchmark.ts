/**
 * Retrieval-strategy benchmark — a reference result, not live data.
 *
 * These numbers are the committed output of `backend/eval/benchmark_strategies.py`
 * (see `backend/eval/benchmark_results.json`). Running the sweep live costs real
 * OpenAI calls and minutes, so the app renders the last pinned run and links to
 * the one-command reproduction. Regenerate after changing embeddings/chunking/top_k
 * and paste the new figures here.
 *
 * The per-strategy prose (what it does / when to reach for it) is editorial
 * context the harness can't produce; the metrics are measured.
 */

export interface StrategyResult {
  strategy: string
  hitAt1: number
  hitAt5: number
  mrr: number
  latencyP50Ms: number
  latencyP95Ms: number
  costPer1kUsd: number
  embedCalls: number
  chatCalls: number
}

export interface StrategyCopy {
  label: string
  /** One-line mechanism. */
  howItWorks: string
  /** When this is the right pick. */
  bestFor: string
}

export interface StrategyBenchmark {
  generatedAt: string
  nCases: number
  topK: number
  embeddingModel: string
  chatModel: string
  results: StrategyResult[]
}

export const STRATEGY_COPY: Record<string, StrategyCopy> = {
  'vector-similarity': {
    label: 'Vector similarity',
    howItWorks: 'One embedding, cosine nearest-neighbour over pgvector.',
    bestFor: 'The default. Best MRR and top-1 here, effectively free and fastest.',
  },
  'hybrid-search': {
    label: 'Hybrid search',
    howItWorks: 'Blends vector similarity with BM25 keyword scoring.',
    bestFor: 'Corpora with rare exact terms (codes, names) that pure vectors miss.',
  },
  reranking: {
    label: 'Reranking',
    howItWorks: 'Over-fetches candidates, then an LLM re-scores them for relevance.',
    bestFor: 'Recall-critical retrieval — best Hit@5, at ~5× latency and real cost.',
  },
  'multi-query': {
    label: 'Multi-query',
    howItWorks: 'An LLM writes query variations; results are retrieved and merged.',
    bestFor: 'Vague or under-specified questions. No gain on this corpus.',
  },
}

/**
 * Generated from backend/eval/benchmark_results.json.
 * Bundled 78-case corpus · text-embedding-3-small + gpt-4o-mini · top_k = 8.
 */
export const STRATEGY_BENCHMARK: StrategyBenchmark = {
  generatedAt: '2026-07-15',
  nCases: 78,
  topK: 8,
  embeddingModel: 'text-embedding-3-small',
  chatModel: 'gpt-4o-mini',
  results: [
    {
      strategy: 'vector-similarity',
      hitAt1: 0.7692,
      hitAt5: 0.9487,
      mrr: 0.8405,
      latencyP50Ms: 227,
      latencyP95Ms: 331,
      costPer1kUsd: 0.0002,
      embedCalls: 1,
      chatCalls: 0,
    },
    {
      strategy: 'hybrid-search',
      hitAt1: 0.7564,
      hitAt5: 0.9487,
      mrr: 0.8251,
      latencyP50Ms: 220,
      latencyP95Ms: 292,
      costPer1kUsd: 0.0002,
      embedCalls: 1,
      chatCalls: 0,
    },
    {
      strategy: 'reranking',
      hitAt1: 0.7308,
      hitAt5: 0.9872,
      mrr: 0.8306,
      latencyP50Ms: 1119,
      latencyP95Ms: 1599,
      costPer1kUsd: 0.2361,
      embedCalls: 1,
      chatCalls: 1,
    },
    {
      strategy: 'multi-query',
      hitAt1: 0.7308,
      hitAt5: 0.9487,
      mrr: 0.8274,
      latencyP50Ms: 2089,
      latencyP95Ms: 2906,
      costPer1kUsd: 0.0372,
      embedCalls: 4,
      chatCalls: 1,
    },
  ],
}
