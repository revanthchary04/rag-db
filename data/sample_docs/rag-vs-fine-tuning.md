# RAG versus Fine-Tuning

RAG and fine-tuning are two ways to give a language model domain knowledge, and
they solve different problems. Fine-tuning adjusts model weights on curated
examples; it is best for teaching format, style, or a fixed skill, but it bakes
knowledge in at training time and is expensive to update. RAG leaves weights
untouched and injects knowledge at inference by retrieving documents, so the
knowledge base can change continuously without retraining and answers can cite
their sources. RAG reduces hallucination on factual queries by grounding output
in retrieved text, while fine-tuning shines when you need consistent behavior
rather than fresh facts. The two are complementary: teams often fine-tune for
tone and tool-use and rely on retrieval for up-to-date, verifiable content.
