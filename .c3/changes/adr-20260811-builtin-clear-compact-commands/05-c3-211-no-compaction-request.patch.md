---
target: c3-211
scope: insert
base: c3-211#n8818@v1:sha256:394d27051739c1cf4058c89daea3b52872b45a3f414dfcde6e81c3c517ced2d8
---
| Alternate — compaction | The protocol is `initialize`, `initialized`, `thread/{fork,resume,start}`, `turn/{start,interrupt}` — there is no compaction request, so Kanna can observe `thread/compacted` but never ask for it. A user `/compact` is therefore a Kanna-driven summarize turn plus a session-token wipe plus `stopSession`; the stop is required because `startSession` reuses a live session on a cwd match and never consults the token | c3-210 |
