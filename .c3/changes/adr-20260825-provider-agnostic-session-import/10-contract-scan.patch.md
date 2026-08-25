---
target: c3-214
scope: block
base: c3-214#n12666@v1:sha256:dd4d2f542f69cf915a922ac910aaaabe2948ac6c6cecaad1d4f92da6e6c96f3f
---
| SessionSource.scan(homeDir) | OUT | Every importable session under homeDir as ImportableSession[]; a file the source refuses is simply absent, so callers that must report refusals go through scanAllSessions instead | c3-214 | src/server/session-source-registry.ts |
