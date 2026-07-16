# Comparing Embedding Models

Not all embedding models retrieve equally well, and the right choice depends on
domain, latency, and cost. OpenAI text-embedding-3 models offer strong general
performance and variable dimensions. Open-source sentence-transformer models such
as the E5 and BGE families are competitive and can be self-hosted to avoid
per-call fees. Cohere embeddings include a rerank-friendly variant. Benchmarks
like MTEB compare models across retrieval, clustering, and classification tasks,
but leaderboard rank rarely transfers directly to a specific corpus, so measuring
retrieval metrics on your own eval set matters more than the public number.
Consider dimension count (memory and speed), maximum input length, whether the
model was trained with a query-versus-document asymmetry, and licensing before
committing an index to a particular model.
