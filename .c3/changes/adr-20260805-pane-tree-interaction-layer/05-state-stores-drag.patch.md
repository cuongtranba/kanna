---
target: c3-102
scope: insert
base: c3-102#n6559@v1:sha256:0f1e0525aedada9c69be265769c0abc7a56eab1ccf9bc250546cf6a49d3ee319
---
| usePaneDragStore | OUT | Transient tab-drag state (dragged tab, hovered pane, drop intent); every write is value-guarded so a drag does not publish a snapshot per pointer move | c3-104 | src/client/stores/paneDragStore.ts |
