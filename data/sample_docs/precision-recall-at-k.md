# Precision and Recall at K

Precision at K and recall at K are the core retrieval metrics for ranked results.
Precision at K is the fraction of the top K retrieved items that are relevant; it
penalizes irrelevant results in the window the model will actually read. Recall at
K is the fraction of all relevant documents that appear in the top K; it penalizes
missing relevant material regardless of ranking. The two trade off: enlarging K
raises recall but usually lowers precision. Hit@k is a coarse special case that
asks only whether any relevant document made the top K, while mean reciprocal rank
rewards placing the first relevant item high. Choose the metric that matches the
task: precision matters when the prompt window is tight, recall matters when
missing a document is costly. Report several K values, since a single cutoff hides
how quality changes with window size.
