---
target: c3-232
scope: block
base: c3-232#n11179@v1:sha256:8b6c6559fe8c8930b3bd77d65293e63693d309ec68e94a9b3218128618707dc7
---
| Tracker sync | IN/OUT | One board holds one binding per repo and a repo binds to one board; pull and push loop over listBindings, each binding reconciling per field watermark against its own cursor, and a failing binding is reported on BindingPullResult rather than stopping the others; a created card is stamped with its binding's projectId, which on a Stack board is the only thing that can tell Start work which checkout the issue came from; an agent-origin change is held with heldReason: "agent_push_disabled" unless the binding allows it | c3-232 | src/server/board-sync.ts |
