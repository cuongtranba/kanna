---
target: c3-246
scope: insert
base: c3-246#n14059@v1:sha256:ada2a5d4df0e57b2e321a780db443cc35755931b32088757e1ffcaf0cc63c076
---
| JetStream reconcile | OUT | On every connect the stream named in settings is created or updated from the configured limits, subjects, discard and duplicate window, and the configured durable consumers are created or updated; consumers Kanna created earlier and no longer lists are deleted by their kanna-managed metadata tag, consumers it did not create are never touched | A change to retention, storage or replicas, or to an existing consumer's ack or deliver policy, is reported as an error naming the field rather than applied, because the server refuses it; a stream is never deleted | src/server/service-bus/jetstream-reconcile.ts |
