# Query Expansion

Query expansion improves recall by enriching a short or ambiguous user query
before retrieval. Classic expansion adds synonyms or related terms. LLM-based
expansion rewrites the query into a clearer form or generates several paraphrases
that are searched in parallel and merged. A popular variant, hypothetical document
embeddings, asks a model to draft a plausible answer and embeds that draft, on the
theory that a fake answer sits closer in vector space to real relevant passages
than the terse question does. Expansion helps most when queries are keyword-sparse
or when vocabulary mismatch separates the question from the documents. The risk is
drift: an expanded query can pull in off-topic results, so expansion is usually
paired with a reranking step that restores precision after recall is widened.
