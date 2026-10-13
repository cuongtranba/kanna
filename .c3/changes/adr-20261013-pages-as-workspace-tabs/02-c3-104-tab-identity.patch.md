---
target: c3-104
scope: block
base: c3-104#n10420@v1:sha256:9deafdf39f754f25a1f266616ae1ca47ea203c5f229f60ebb466a881b4c86008
---
| Tab identity | OUT | A tab id is derived from its target, making open idempotent and chat/changes singletons by construction; a page tab id is its page kind under a page prefix, so each page kind has exactly ONE tab and its target carries the last path visited there | c3-112 | src/client/lib/paneTree/tabTarget.ts |
