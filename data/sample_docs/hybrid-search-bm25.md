# Hybrid Search with BM25

Hybrid search combines dense vector retrieval with sparse lexical retrieval to
cover each other's blind spots. Dense embeddings capture semantic similarity but
can miss exact terms, rare identifiers, or codes; BM25, a bag-of-words scoring
function based on term frequency and inverse document frequency, nails exact
keyword matches but misses paraphrase. Running both and merging their result
lists retrieves documents that are either semantically or lexically relevant.
Fusion is often done with reciprocal rank fusion, which sums the reciprocal of
each document's rank across the two lists so that items ranked highly by either
method rise to the top without needing calibrated scores. Hybrid retrieval
reliably improves recall on corpora full of product names, acronyms, or numeric
identifiers where pure vector search underperforms.
