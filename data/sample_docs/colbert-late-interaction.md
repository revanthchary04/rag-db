# ColBERT and Late Interaction

ColBERT is a retrieval model built on late interaction, a middle ground between
single-vector search and cross-encoder reranking. Instead of compressing a
document into one embedding, it keeps a separate vector per token. At query time
it scores a document by summing, for each query token, the maximum similarity to
any document token — the MaxSim operation. This preserves fine-grained term-level
matching while still allowing document vectors to be precomputed and indexed,
unlike a cross-encoder that must run at query time. The cost is storage: many
vectors per document inflate the index substantially, so ColBERT often uses
compression to stay practical. Late interaction tends to generalize better than
single-vector dense retrieval to out-of-domain corpora, at the price of a larger,
more complex index.
