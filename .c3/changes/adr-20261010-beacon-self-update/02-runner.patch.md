---
target: c3-241
scope: block
base: c3-241#n13099@v1:sha256:073e8748b8cd240629b8ad439dd3ec70136fd6ac7db49bad13097e7ae7c84c51
---
| Runner | IN/OUT | Owns the reconnect loop for the CLI and the desktop app: pause, resume, stop, unpair, typed status snapshots, and the update decision on ready, incompatible or an update frame, ending the run with exit update once the new build is in place | c3-202 | src/beacon/runner.ts |
