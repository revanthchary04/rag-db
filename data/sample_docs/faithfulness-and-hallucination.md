# Faithfulness and Hallucination

Faithfulness measures whether a generated answer is supported by the retrieved
context rather than invented. An answer can be fluent, relevant, and still
unfaithful if it asserts facts the sources do not contain — a grounding failure
distinct from retrieving the wrong documents. Faithfulness is assessed by checking
each claim in the answer against the provided passages, often by an LLM judge or by
natural-language-inference entailment scoring. Low faithfulness despite good
retrieval points at the generation step: the prompt may invite speculation, the
context may be too long to attend to, or the model may pad gaps with parametric
knowledge. Fixes include instructing the model to answer only from context, citing
sentences inline, and abstaining when evidence is absent. Faithfulness and
retrieval quality are separate axes and should be measured separately.
