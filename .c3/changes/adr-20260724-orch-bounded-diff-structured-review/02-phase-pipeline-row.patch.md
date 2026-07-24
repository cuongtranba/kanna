---
target: c3-232
scope: block
base: c3-232#n8045@v1:sha256:99a4778c1b4f1bec21cdd63b68da3e58ed2eabf54d54240f011f8582d19fa3d1
---
| Phase pipeline (F4) | Ordered OrchPhaseSpec list; each phase spawns fresh worker via StartWorker; {{TASK}}, {{DIFF}}, {{PRIOR}} template vars assembled by composePrompt. {{DIFF}} is bounded by boundDiff (orchestration-diff.ts, 64k budget, per-file packing with omitted markers). Review-kind phase outputs are combined by combineReviewOutputs (orchestration-review.ts): conformant fenced-JSON OrchReviewFinding replies are merged, deduped across parallel reviewers, and rendered as the {{PRIOR}} block; any unparsed reply falls back to the raw join | N.A - new component, no existing entity |
