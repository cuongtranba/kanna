---
target: c3-113
scope: insert
base: c3-113#n6551@v1:sha256:80e52bc76142872f29db8e86d72a5572c560e70b0b8190a173cebd0722b120cd
---
| Row-spacing re-measure jitter | Gap moved from padding-above to padding-below, or gap stored on the reused row object | Transcript jitters at the bottom anchor while streaming, or a row keeps a stale gap after a neighbour changes kind | bun run test src/client/app/transcriptSpacing.test.ts + manual streaming scrollback |
