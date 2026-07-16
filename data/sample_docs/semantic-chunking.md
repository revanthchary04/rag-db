# Semantic Chunking

Semantic chunking splits a document at meaning boundaries rather than at a fixed
token count. Instead of cutting every N tokens, it embeds sentences and starts a
new chunk where the similarity between consecutive sentences drops below a
threshold, keeping topically coherent passages together. This produces chunks that
align with ideas, which can improve retrieval precision because each chunk
embedding represents a single concept rather than a blur of several. The cost is
extra preprocessing: every sentence must be embedded before indexing, and the
threshold needs tuning per corpus. Semantic chunking helps most on documents that
mix many topics without clear headings; on well-structured documents,
heading-based or paragraph splitting often does just as well for less effort.
Evaluate it against fixed-size chunking before adopting it.
