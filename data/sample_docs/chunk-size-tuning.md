# Tuning Chunk Size

Chunk size is one of the highest-leverage knobs in a retrieval pipeline. Small
chunks give precise matches and tight citations but may omit surrounding context
the model needs to answer; large chunks preserve context but dilute the embedding
so relevant passages rank lower and irrelevant text is injected into the prompt.
There is no universal best size; it depends on document structure and query type.
Factual lookup favors smaller chunks, while synthesis over long passages favors
larger ones. Overlap between adjacent chunks reduces the chance of splitting a key
sentence across a boundary. The reliable way to set chunk size and overlap is to
sweep a few values, run the eval harness, and compare Hit@k and answer quality —
treat it as a hyperparameter, not a default you set once and forget.
