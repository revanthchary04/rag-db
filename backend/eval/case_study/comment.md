<!-- eval-regression-gate -->
### 🧪 Eval regression gate — 🔴 **Regression**

Comparing this run against baseline the pinned baseline on **dataset.jsonl** (78 cases), tolerance ±2pp.

| Metric | Baseline | Current | Δ | |
| --- | ---: | ---: | ---: | :---: |
| Hit@1 | 76.9% | 70.5% | -6.4pp | 🟡 |
| Hit@3 | 88.5% | 91.0% | +2.6pp | 🟢 |
| **Hit@5** | 94.9% | 97.4% | +2.6pp | 🟢 |
| Hit@8 | 97.4% | 98.7% | +1.3pp | ➖ |
| **MRR** | 0.840 | 0.812 | -0.028 | 🔴 |

**🔴 Hit@5 flipped to miss on 1 case(s):** `case-14`
- `case-14` — What is the difference between HNSW and IVFFLAT?

**🟢 Hit@5 recovered on 3 case(s).**

**Verdict:** MRR dropped beyond the ±2pp tolerance — this check fails.
