---
target: c3-246
scope: insert
base: c3-246#n14059@v1:sha256:ada2a5d4df0e57b2e321a780db443cc35755931b32088757e1ffcaf0cc63c076
---
| Embedded nats-server | IN/OUT | In embedded mode Kanna downloads the pinned nats-server release for darwin and linux into the data dir, verifies it against SHA256SUMS, writes a 0600 config with a loopback listener, the JetStream store limits and a generated token, starts it, restarts it with backoff after an unexpected exit and stops it at shutdown; Windows reports that external mode is required | The token lives only in settings.json and the 0600 config file, never in argv; the child inherits PATH only | src/server/service-bus/nats-server-process.adapter.ts |
