---
target: c3-110
scope: insert
base: c3-110#n7072@v1:sha256:b1b29b881b0ee8fc8a40dfee9ef7c5ea2d03a7a4d84f4d854f6d80dbac4f6dd6
---
| Sidebar swipe gesture | OUT | Window-level swipes open and close the sidebar below BREAKPOINT_MD, except when the gesture starts inside a surface marked data-swipe-scroll-x — that surface owns its own horizontal scroll, and it advertises the attribute only while it overflows | c3-104 | src/client/app/sidebarSwipeGesture.ts |
