---
target: c3-104
scope: block
base: c3-104#n7140@v1:sha256:4749384938d606f238c496de4be8717fb188506c2c11524bc3dc9337419164fb
---
| Workspace layout store | OUT | Persists ONE tree for the whole app, seeded from the pre-rewrite layout keys on first read; chats from different projects accumulate as tabs in it, and a terminal tab resolves its owning project from its own id | c3-102 | src/client/stores/paneLayoutStore.ts |
