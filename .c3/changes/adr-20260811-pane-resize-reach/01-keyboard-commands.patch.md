---
target: c3-104
scope: block
base: c3-104#n7727@v1:sha256:8135ddff76641832a93992a4faa8fffe4d214f6ad95433f2d728d79da9c9821c
---
| Keyboard commands | OUT | Thirteen rebindable actions map to pane intents through one pure resolver; each command's subject is derived in the store, and only modifier-less bindings are suppressed while typing. Resize adds Shift to the focus arrows (modifier matching is exact, so they cannot collide) and moves the DIVIDER the way the arrow points — the sign depends only on the direction pressed, never on where the focused pane sits, so a last child (whose outer edge is the group's own) uses the boundary on its left with that same sign | c3-222 | src/client/components/panes/paneKeyboard.ts |
