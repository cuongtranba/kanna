---
target: c3-232
scope: block
base: c3-232#n8030@v1:sha256:0b2cbdbc212ca695157a303ca25aef215c204a6ae141fc930b950fe7720d26a3
---
Owns: `src/server/orchestration-queue.ts` (OrchestrationQueue class), `src/server/orchestration-diff.ts` (boundDiff — pure {{DIFF}} budget packing), `src/server/orchestration-review.ts` (parseReviewFindings / dedupeFindings / renderFindings / combineReviewOutputs — pure structured-review pipeline), `src/server/orchestration-git.adapter.ts` (commitAll, diffAgainstBase), `src/server/orchestration-worktree.adapter.ts` (ensureWorktree, resetHard, removeWorktree), `src/shared/orchestration-types.ts` (pure types), and the 18-variant OrchestrationEvent extensions in events.ts / event-store.ts.
