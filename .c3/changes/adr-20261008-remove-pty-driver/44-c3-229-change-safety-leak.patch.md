---
target: c3-229
scope: block
base: c3-229#n12345@v1:sha256:65b24e6bf989b3933e5fd8e77edaea21c77207a2925588d82779591d317325d2
---
| fs.watch handle leak | unregister(chatId) not called on session close | Registry holds stale watchers; memory grows per chat | bun test src/server/workflow-registry.test.ts |
