# LLM-as-Judge Evaluation

LLM-as-judge uses a language model to grade another model's output, scaling
evaluation beyond what human raters can label. A judge prompt presents the
question, the generated answer, and often the retrieved context or a reference,
then asks for a verdict on dimensions like correctness or faithfulness. It is far
cheaper than human annotation and correlates reasonably with human judgment on
many tasks. The method has known biases: judges can prefer longer answers, favor
their own model family, and be swayed by answer position in pairwise comparisons.
Mitigations include clear rubrics, requiring the judge to cite evidence,
randomizing order, and calibrating against a small human-labeled set. LLM-as-judge
complements deterministic retrieval metrics rather than replacing them — it scores
answer quality, which Hit@k and MRR cannot see.
