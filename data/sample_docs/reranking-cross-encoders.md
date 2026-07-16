# Reranking with Cross-Encoders

Reranking is a second retrieval stage that reorders an initial candidate set for
precision. First-stage dense retrieval encodes the query and documents separately,
which is fast and lets documents be indexed ahead of time but limits accuracy. A
cross-encoder instead feeds the query and a candidate document together through a
transformer, letting attention compare every query token against every document
token, producing a far more accurate relevance score. Because it runs per
candidate at query time, a cross-encoder is too slow to score a whole corpus, so
it is applied only to the top candidates from the fast first stage. This
two-stage design — wide, cheap recall then narrow, expensive precision — is one
of the most reliable ways to lift answer quality, often improving MRR and top-rank
accuracy more than swapping the base embedding model.
