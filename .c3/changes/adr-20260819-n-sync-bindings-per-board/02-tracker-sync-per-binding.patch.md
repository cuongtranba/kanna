---
target: c3-232
scope: block
base: c3-232#n10996@v1:sha256:28fe7b611fd0d438ec110ecef2695bed2d2b30b16e18edfebef5e4bff5d9eb9f
---
| Tracker sync | IN/OUT | One board holds one binding per repo; pull and push loop over listBindings, each binding reconciling per field watermark against its own cursor, and a failing binding is reported on BindingPullResult rather than stopping the others; an agent-origin change is held with heldReason: "agent_push_disabled" unless the binding allows it | c3-232 | src/server/board-sync.ts |
