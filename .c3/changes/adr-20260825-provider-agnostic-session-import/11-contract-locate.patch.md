---
target: c3-214
scope: block
base: c3-214#n12667@v1:sha256:a50189248d5785dfebebe92e368cbdda9f93a70d73684ae1310b848f9c7aeb2c
---
| SessionSource.locate(homeDir, sessionId) | OUT | Path of the file holding sessionId, or null when this provider has none. Sources are probed in registry order with claude first, so an id present under both providers resolves to the claude session | c3-214 | src/server/session-source-registry.ts |
