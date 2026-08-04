---
target: c3-111
scope: insert
base: c3-111#n6451@v1:sha256:5e037fbdc0e9f98d0e20c5709c15886a9d01605f4ea184d40eb9fe6ea1aa028e
---
| Stored width lost to the clamp | Viewport clamp written back to storage instead of only to the rendered width | Sidebar never returns to the user's chosen width after the window widens | bun run test src/client/stores/kannaSidebarStore.test.ts + widen-window smoke |
