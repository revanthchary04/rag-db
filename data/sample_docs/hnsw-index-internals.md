# HNSW Index Internals

Hierarchical Navigable Small World is a graph-based approximate nearest neighbor
index. It builds a layered proximity graph: upper layers are sparse for fast long
jumps, lower layers are dense for fine-grained search. A query enters at the top
layer and greedily walks toward closer neighbors, descending a layer each time it
reaches a local best, until it converges in the base layer. Two parameters
dominate behavior: M, the number of neighbors per node, controls graph
connectivity and memory; efConstruction and efSearch control how many candidates
are explored while building and querying, trading recall for speed. HNSW offers
excellent query latency and high recall but uses more memory than cluster-based
indexes and is costlier to build. It is the default choice when query speed and
recall matter more than index size or build time.
