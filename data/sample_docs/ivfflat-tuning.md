# Tuning IVFFlat Indexes

IVFFlat is a cluster-based approximate nearest neighbor index. During build it
partitions vectors into lists using k-means; each list has a centroid. At query
time it compares the query to the centroids and searches only the nearest few
lists rather than the whole dataset. Two knobs govern the trade-off: the number of
lists set at build time, and probes, the number of lists scanned per query. More
lists make each list smaller and search faster but risk missing neighbors near
partition boundaries; more probes raise recall at the cost of latency. A common
rule sizes the list count near the square root of the row count. IVFFlat builds
faster and uses less memory than graph indexes like HNSW, making it attractive for
very large or frequently rebuilt collections where memory is the binding
constraint. It must be built on populated data.
