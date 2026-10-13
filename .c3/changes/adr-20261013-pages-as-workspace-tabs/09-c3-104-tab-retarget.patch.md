---
target: c3-104
scope: insert
base: c3-104#n14555@v1:sha256:df7eb35450e00c2aadb09a1baf549ead64573837e28903e2d92d3bd4a931ed78
---
| Tab retarget | OUT | openTab on an id that already exists replaces the stored target when the new one differs and keeps the tab where it is, instead of treating open as a no-op, so one tab can follow a changing path | c3-112 | src/client/lib/paneTree/operations.ts |
