---
target: c3-224
scope: block
base: c3-224#n11969@v1:sha256:260de46abf1afcb101185e0063ff4395040d4f53dd15b3e7015965eafe7f00f6
---
| Rotation herd when N owners simultaneously detect limit/401 on shared token | acquireRotationSlot in agent.ts does not dedupe within TOKEN_ROTATION_DEDUPE_WINDOW_MS or skips stagger application | All N respawns fire at once; cold-boot stampede; second pickActive on same chatId double-claims | Existing bun test src/server/agent.oauth-rotation.test.ts + manual smoke (cap=2 on one token, force 401, observe staggered respawn) |
