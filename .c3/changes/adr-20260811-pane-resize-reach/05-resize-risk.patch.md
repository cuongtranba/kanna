---
target: c3-104
scope: insert
base: c3-104#n7738@v1:sha256:547abc510eafec0f8395dd9f3e12ec448ced594ec92074c14c0a7cb0a71d452f
---
| Keyboard resize travels against the key | Flipping the nudge's sign for a last child, to make "right" always grow the focused pane | The divider under the focused pane's left edge slides the wrong way; from the other pane the same boundary answers the same key differently | bun test --conditions production src/client/lib/paneTree/resize.test.ts src/client/stores/paneLayoutStore.test.ts |
