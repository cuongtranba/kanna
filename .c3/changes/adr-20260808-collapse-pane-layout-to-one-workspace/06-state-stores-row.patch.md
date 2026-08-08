---
target: c3-102
scope: block
base: c3-102#n7039@v1:sha256:0f1e0525aedada9c69be265769c0abc7a56eab1ccf9bc250546cf6a49d3ee319
---
| usePaneLayoutStore | OUT | ONE persisted pane tree for the whole app — not keyed by project — seeded from the pre-rewrite layout keys on first read; per-pane UI slices are scoped off it by the pane-scoped store factory | c3-104 | src/client/stores/paneLayoutStore.ts |
