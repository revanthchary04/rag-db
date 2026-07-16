# Sentence-Window Retrieval

Sentence-window retrieval decouples what you match on from what you feed the
model. The index stores individual sentences, so retrieval is precise and each
embedding is sharp. When a sentence is retrieved, the system expands it back into
a surrounding window of neighboring sentences before adding it to the generation
prompt, restoring the context that a lone sentence would lack. This gives the
precision of small chunks with the context of larger ones, avoiding the usual
trade-off. The window size controls how much neighboring text is pulled in.
Implementation stores each sentence with pointers to its document position so the
window can be reconstructed at query time. It works well for dense reference
material where answers hinge on one exact sentence but need nearby text to be
interpreted correctly.
