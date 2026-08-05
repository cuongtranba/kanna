---
target: c3-102
scope: insert
base: c3-102#n6509@v1:sha256:2df708c7835fc05f0843c7446f178056f0f7bdd54946823b2bd751496a018431
---
| usePaneLayoutStore | OUT | One persisted pane tree per project, seeded from the pre-rewrite layout keys on first read; per-pane UI slices are scoped off it by the pane-scoped store factory | c3-104 | src/client/stores/paneLayoutStore.ts |
