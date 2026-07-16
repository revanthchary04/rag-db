# Prompt Templates for RAG

The prompt that assembles retrieved context into a question shapes answer quality
as much as retrieval does. A good RAG template separates instructions, the
retrieved passages, and the user question with clear delimiters so the model can
tell context from task. It instructs the model to answer only from the provided
context and to say when the context is insufficient, which curbs hallucination. It
specifies citation format so answers can point back to sources. Passage ordering
matters because models attend unevenly across a long context, often weighting the
beginning and end more than the middle. Templates also decide how to handle
conflicting passages and how much context to include before diminishing returns
set in. Small template changes can move faithfulness noticeably, so prompts belong
under evaluation and version control, not buried as string literals.
