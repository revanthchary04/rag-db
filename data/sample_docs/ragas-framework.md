# The RAGAS Evaluation Framework

RAGAS is a framework for evaluating retrieval-augmented generation without relying
on hand-written reference answers. It defines reference-free metrics computed with
the help of a language model. Faithfulness checks that answer claims are entailed
by the retrieved context. Answer relevance checks that the answer actually
addresses the question. Context precision asks whether the retrieved passages that
matter are ranked highly, and context recall asks whether all information needed to
answer was retrieved. Together these separate retrieval quality from generation
quality, so a regression can be localized to the right stage. Because the metrics
lean on an LLM, they inherit judge biases and cost, and scores should be tracked as
trends rather than treated as absolute truth. RAGAS complements deterministic
retrieval metrics like MRR and Hit@k.
