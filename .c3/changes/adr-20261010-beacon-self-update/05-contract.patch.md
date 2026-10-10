---
target: c3-241
scope: insert
base: c3-241#n13101@v1:sha256:c14811b7b346f2cffaf0ee465f6b7cc4882c349e4c5daf1ac55c4ac920a4c579
---
| Self-update | IN/OUT | Installs the handshake serverVersion only when it is newer and in strict release form, from the fixed GitHub release download URL; checks SHA256SUMS and the new binary's version command, waits for in-flight requests, swaps by rename, and restarts through exit code 75 under a self-spawned supervisor; the desktop app uses the Electrobun updater gated on the same version | c3-202 | src/beacon/self-update.adapter.ts |
