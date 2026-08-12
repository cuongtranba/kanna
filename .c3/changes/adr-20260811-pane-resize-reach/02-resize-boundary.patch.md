---
target: c3-104
scope: insert
base: c3-104#n7730@v1:sha256:d119a29ac0ca621408075e2fb895c3bf52696a5e2c775fb1981ba182a5db7306
---
| Resize boundary | OUT | Which divider a keyboard nudge moves is resolved purely: walk outward from the focused pane past wrong-axis ancestors to the nearest group on the pressed axis, taking the boundary after the branch or, for a last child, the one before it. The step is half MIN_PANE_FRACTION, so no single press can pin a pane, and a nudge at the floor returns null so held key-repeat causes no re-render | c3-112 | src/client/lib/paneTree/resize.ts |
