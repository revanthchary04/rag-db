# Metadata Filtering

Metadata filtering constrains retrieval to documents matching structured
attributes — date, author, source, language, access level — alongside semantic
similarity. It answers questions vector similarity alone cannot, like restricting
results to the current quarter or to documents a user is allowed to see. Filters
can be applied pre-search, narrowing the candidate set before the nearest-neighbor
scan, or post-search, discarding non-matching hits afterward; pre-filtering is
more correct but can interact awkwardly with approximate indexes that assume a full
scan. Well-designed metadata also powers routing, sending a query to the right
sub-index. The main cost is discipline at ingestion time: metadata must be
extracted and stored consistently, or filters silently drop valid results.
Security-sensitive applications treat access-control filters as mandatory, never
optional.
