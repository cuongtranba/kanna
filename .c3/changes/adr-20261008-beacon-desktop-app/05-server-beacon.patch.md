---
target: c3-202
scope: insert
base: c3-202#n10953@v1:sha256:e63c412f398193232f386f8bbd3a9035619aa2f901e993c7f2f2869f792489cd
---
| /beacon scope sync | IN/OUT | Persists a validated set-scope, deletes the beacon on unpair, refuses unknown or disabled beacons before the challenge, and pushes the stored scope to connected protocol-2 beacons on every settings change | c3-241 | src/server/beacon-connection.ts |
