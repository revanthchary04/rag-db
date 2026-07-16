# RAG Architecture Patterns

A retrieval-augmented generation system is a pipeline of stages, and several
patterns exist for arranging them. Naive RAG retrieves once and generates once.
Advanced RAG adds pre-retrieval steps (query rewriting, routing) and
post-retrieval steps (reranking, compression) around the same core. Modular RAG
treats retrieval, reranking, and generation as swappable components connected by
a controller. Two-stage retrieval first fetches a broad candidate set with a fast
dense index, then narrows it with a slower, more accurate reranker. Fusion
patterns issue several queries and merge their result lists. Choosing a pattern
is a latency-versus-accuracy trade: more stages usually improve answer quality
but add per-request cost. Most production systems start naive and add stages only
where evaluation shows a measurable retrieval or faithfulness gain.
