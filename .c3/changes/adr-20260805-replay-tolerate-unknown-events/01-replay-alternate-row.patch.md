---
target: c3-206
scope: block
base: c3-206#n6469@v1:sha256:09826a1a3e58cfa01c88d45944b75dcb6712a622b97ca8c270d71fe283cd35cb
---
| Alternate — replay | Boot replay rebuilds state from log + snapshot. An event type outside the current StoreEvent union (written by a different code version) is warned and priced at UNKNOWN_EVENT_PRIORITY, never thrown — applyStoreEvent has no default case, so it is a no-op on apply regardless. See adr-20260805-replay-tolerate-unknown-events. | c3-206 |
