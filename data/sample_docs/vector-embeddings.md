# Understanding Vector Embeddings

Vector embeddings are numerical representations of text, images, or other data that capture semantic meaning in a high-dimensional space. They are fundamental to modern information retrieval and RAG systems.

## What Are Embeddings?

Embeddings transform discrete objects (like words, sentences, or documents) into continuous vectors of real numbers. These vectors are designed so that semantically similar items are close together in the embedding space.

For example, the words "king" and "queen" would have embeddings that are closer to each other than "king" and "banana" in the vector space.

## How Embeddings Work

1. **Training**: Embedding models are trained on large text corpora to learn relationships between words, phrases, and concepts.

2. **Encoding**: When you encode a piece of text, the model produces a fixed-size vector (e.g., 1536 dimensions for OpenAI's text-embedding-3-small).

3. **Similarity**: The similarity between two texts can be measured using cosine similarity or Euclidean distance between their embedding vectors.

## Popular Embedding Models

- **OpenAI Embeddings**: text-embedding-3-small (1536 dims), text-embedding-3-large (3072 dims)
- **Sentence Transformers**: all-MiniLM-L6-v2 (384 dims), all-mpnet-base-v2 (768 dims)
- **Cohere**: embed-english-v3.0
- **Voyage AI**: voyage-large-2

## Use Cases

- Semantic search
- Document clustering
- Recommendation systems
- Anomaly detection
- RAG systems for retrieval
