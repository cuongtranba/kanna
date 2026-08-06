---
target: c3-207
scope: insert
base: c3-207#n7730@v1:sha256:a140a6c622188c0d374777a5a708ebd04e460668183deb665e87c8b97ade9267
---
| getLoopTracking(chatId) | IN | Injected reader supplying the armed loop's tracking-file view; defaults to `() => null` so the projection stays pure and callers without the registry are unchanged | c3-208 | src/server/read-models.ts |
