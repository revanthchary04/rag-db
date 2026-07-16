# Vector Retrieval Methods

Retrieval is the process of finding relevant chunks from a knowledge base given a query. Several methods exist for efficient vector similarity search.

## Similarity Metrics

### Cosine Similarity

Measures the angle between two vectors, ignoring magnitude. Best for normalized embeddings.

Formula: `cos(θ) = (A · B) / (||A|| × ||B||)`

### Dot Product

Measures both direction and magnitude. Requires normalized embeddings for best results.

### Euclidean Distance

Measures straight-line distance in vector space. Less common for text embeddings.

## Index Types

### HNSW (Hierarchical Navigable Small World)

- **Performance**: Very fast approximate nearest neighbor search
- **Memory**: Higher memory usage
- **Best for**: Production systems with frequent queries
- **Trade-off**: Slight accuracy loss for significant speed gain

### IVFFLAT (Inverted File with Flat Compression)

- **Performance**: Fast for large datasets
- **Memory**: Lower than HNSW
- **Best for**: Large-scale deployments
- **Trade-off**: Requires tuning of list parameters

### Exact Search (No Index)

- **Performance**: Slow for large datasets
- **Accuracy**: 100% accurate
- **Best for**: Small datasets or when accuracy is critical

## Hybrid Retrieval

Combine vector search with keyword search (BM25) for better results:

1. Retrieve top-K from vector search
2. Retrieve top-K from keyword search
3. Merge and re-rank results

This approach leverages both semantic understanding and exact keyword matching.
