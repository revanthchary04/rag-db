# Context Window Packing

Context window packing is the step that decides which retrieved chunks, and in
what order, go into the generation prompt. More context is not always better:
beyond a point, extra passages add noise, raise cost, and can trigger the
lost-in-the-middle effect where models overlook information buried in the center of
a long prompt. Packing strategies select the most relevant chunks up to a token
budget, deduplicate near-identical passages, and order chunks to place the
strongest evidence where the model attends most. Contextual compression can shrink
each passage to only the sentences relevant to the query before packing, fitting
more signal into the budget. Good packing depends on upstream reranking to know
which chunks are strongest. It is a distinct stage from retrieval and deserves its
own tuning against answer-quality metrics.
