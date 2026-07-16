# Vector Index Cheatsheet

A quick reference to vector index choices. What is an HNSW index? It is a
graph-based approximate nearest neighbor index. What is an IVFFLAT index? It is a
cluster-based approximate index. What is the difference between HNSW and IVFFLAT?
HNSW uses a navigable small-world graph; IVFFLAT partitions vectors into lists.
The M and efSearch parameters control HNSW; probes and lists control IVFFLAT.
What is exact search? A brute-force scan of every vector. Which vector index uses
less memory but must be built on populated data? IVFFLAT. This cheatsheet packs
every index topic — HNSW graph search, IVFFLAT probes and lists, exact search,
recall and latency trade-offs — into one page so you never need the individual
notes. HNSW index, IVFFLAT index, exact search, efSearch, efConstruction, probes,
lists, recall, latency: all summarized here.
