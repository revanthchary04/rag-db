# Embedding Dimensions and Matryoshka Representation Learning

The dimensionality of an embedding trades retrieval quality against storage and
search speed. Higher dimensions capture more nuance but cost more memory and slow
nearest-neighbor search. Matryoshka Representation Learning trains a single model
whose vectors can be truncated to shorter prefixes with graceful quality loss, so
one model serves 256, 768, or 1536 dimensions without re-embedding. This supports
adaptive retrieval: search a truncated low-dimension index for a fast first pass,
then rerank candidates using the full-dimension vectors. Truncation must be paired
with renormalization for cosine similarity to remain meaningful. Picking a
dimension is an eval-driven decision — measure Hit@k and latency at several widths
and keep the smallest that holds retrieval quality on your corpus.
