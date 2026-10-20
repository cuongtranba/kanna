---
target: c3-246
scope: block
base: c3-246#n14046@v1:sha256:56dc1dac83406afb5f943358ad9d2224937192bc9dc4eb605c47edcee1e0d432
---
Owns the BusEnvelope contract in src/shared/service-bus, the NATS-style subject matching, the in-memory ServiceBus with subscribers and mirrors, the table that decides which StoreEvent kinds become which subject (and which never leave the process), the transcript kind allow-list, the EventStore tap that turns an applied event or an appended entry into an envelope, and the optional NATS JetStream mirror: the JetStream settings model, the write-only token, the embedded nats-server installer and supervisor, the mirror with its bounded queue, the create-or-update reconcile of the stream and its durable consumers, the service-bus status topic and the Settings section. Non-goals: it does not store events, does not retry a failed subscriber, and never makes the EventStore wait for a broker.
