# Multilingual Embeddings

Multilingual embedding models map text from many languages into a shared vector
space so a query in one language can retrieve documents written in another.
Cross-lingual alignment is learned from parallel or translated data, letting
semantically equivalent sentences land near each other regardless of language.
This enables a single index for a multilingual corpus instead of one index per
language. Quality varies by language: high-resource languages retrieve better
than low-resource ones, and code-switching or transliteration can degrade
matches. Tokenizer coverage matters, since out-of-vocabulary scripts fragment
into many subword tokens. Evaluate multilingual retrieval per language rather
than on an aggregate score, because a strong average can hide weak performance on
the languages that matter most for your users.
