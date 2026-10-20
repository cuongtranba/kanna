---
target: c3-206
scope: insert
base: c3-206#n11777@v1:sha256:e9ea030e8ae6c4f116b4c0c0574c2519eff81f10b78a8fd0a7914e4e3359f25f
---
| tap (EventStoreTap) | OUT | Optional slot called after applyStoreEvent for every applied event and after the transcript write for every appended entry; set by server boot after initialize so replay publishes nothing | c3-246 | src/server/event-store.ts |
