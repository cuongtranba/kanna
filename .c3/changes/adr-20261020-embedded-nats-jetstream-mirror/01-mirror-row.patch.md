---
target: c3-246
scope: insert
base: c3-246#n14059@v1:sha256:ada2a5d4df0e57b2e321a780db443cc35755931b32088757e1ffcaf0cc63c076
---
| NATS mirror | OUT | When settings.serviceBus is enabled, every envelope is also published to a JetStream stream with Nats-Msg-Id set to its idempotencyKey; the first subject token is swapped for the configured prefix and the JSON body keeps the original subject; publishes queue in a bounded ring of 2000 and drop oldest with a counter when the broker is away | publish only pushes to the ring; connect, reconcile and drain never throw into the caller, so a broker outage never fails an EventStore append | src/server/service-bus/nats-mirror.ts |
