/**
 * Example prompts aligned with `backend/scripts/seed_eval_corpus.py` (introduction-to-rag,
 * vector-embeddings, chunking-strategies, retrieval-methods, evaluation-metrics).
 * After `make seed` / `pnpm seed:corpus`, these should retrieve well from the demo corpus.
 */
export interface DemoExampleQuery {
  id: string
  /** Button label (kept short for layout) */
  label: string
  /** Full text sent to the model */
  prompt: string
  /** Short topic tag shown on the empty-state suggestion tile */
  topic: string
}

export const DEMO_EXAMPLE_QUERIES: DemoExampleQuery[] = [
  {
    id: 'rag-basics',
    label: 'How does RAG combine retrieval and generation?',
    prompt:
      'How does retrieval-augmented generation combine a retrieval phase with language model generation, and why does that reduce hallucinations?',
    topic: 'Retrieval-augmented generation',
  },
  {
    id: 'embeddings',
    label: 'Explain vector embeddings and cosine similarity',
    prompt:
      'Explain vector embeddings and cosine similarity in simple terms. How do they help semantic search?',
    topic: 'Embeddings',
  },
  {
    id: 'chunking',
    label: 'What chunking strategies and overlap are used for RAG?',
    prompt:
      'What chunking strategies are common for RAG (fixed-size, sentence, paragraph, semantic), and why is overlap between chunks useful?',
    topic: 'Chunking',
  },
  {
    id: 'retrieval',
    label: 'What are HNSW, hybrid search, and BM25?',
    prompt:
      'What are HNSW and IVFFLAT in vector search, and how does hybrid retrieval combine dense vectors with keyword or BM25 signals?',
    topic: 'Vector search',
  },
  {
    id: 'eval-metrics',
    label: 'Which metrics evaluate RAG retrieval and answers?',
    prompt:
      'Which metrics are commonly used to evaluate RAG: precision at K, recall, MRR, and answer faithfulness?',
    topic: 'Evaluation',
  },
  {
    id: 'summarize-corpus',
    label: 'Summarize main topics in my knowledge base',
    prompt: 'Summarize the main topics covered in my ingested documents about RAG and retrieval.',
    topic: 'Your corpus',
  },
]
