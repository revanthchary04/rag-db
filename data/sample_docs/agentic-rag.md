# Agentic RAG

Agentic RAG puts a language model in control of the retrieval loop rather than
running a fixed retrieve-then-generate pipeline. The agent decides whether to
retrieve at all, what query to issue, which tool or index to search, and whether
the retrieved context is sufficient or a second search is needed. This enables
multi-hop question answering, where the answer depends on chaining facts across
several documents that no single query would surface. Common building blocks are
a router that picks among indexes, a self-critique step that judges retrieved
context, and a stopping rule that ends the loop. Agentic approaches raise recall
on complex questions but add latency and cost from extra model calls, and they
are harder to evaluate because the retrieval path varies per question. Guardrails
on loop count keep runaway tool use in check.
