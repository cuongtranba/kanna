---
target: c3-202
scope: insert
base: c3-202#n11051@v1:sha256:80476c1a98832340599b6feec9bab8d8ca99422f5e502af2f2b892462b43b71d
---
| /beacon update | IN/OUT | Sends the server version in ready and incompatible, keeps each beacon's last update_status until it reconnects, and answers beacons.update with a field-less update frame, refusing a beacon that is offline or below protocol 4; it never sends a URL or a version | c3-241 | src/server/beacon-registry.ts |
