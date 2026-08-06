---
target: c3-227
scope: insert
base: c3-227#n8785@v1:sha256:aad88a0a1b45b5672ceb7b7d5e66f0b888412dae00dc8884d3ddfc7faf326ad0
---
| Armed-loop watch lifecycle | OUT | deriveLoopState is the only authority for which tracking file is watched: syncLoopTracking projects it, confines trackingFileRel to workdirAbs, and registers or unregisters the loop-tracking watch. rehydrateLoopTracking replays it on boot, since an armed loop outlives the process that armed it | c3-207 | src/server/loop-tracking-sync.ts, src/server/auto-continue/read-model.ts |
