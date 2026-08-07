---
id: adr-20260807-phone-tab-strip-scroll
c3-seal: 30f0dc9cab4a126a461453dd91b3d0cb7dd69308e65a8ae0d8193076fbfd8d0f
title: phone-tab-strip-scroll
type: adr
goal: |-
    Make the pane tab strip usable on a phone: it must scroll horizontally under the
    finger, keep its tabs wide enough to read, and glide the newly selected tab into
    view instead of jumping.
status: done
date: "2026-08-07"
---

## Goal

Make the pane tab strip usable on a phone: it must scroll horizontally under the
finger, keep its tabs wide enough to read, and glide the newly selected tab into
view instead of jumping.

## Context

Below BREAKPOINT_MD the pane tree flattens into ONE pane carrying every tab, so
the strip is the only way to reach a chat. Two properties made it unusable
there. First, every tab carried `touch-none` so dnd-kit's PointerSensor could
own the gesture; because `touch-action` intersects down the ancestor chain, a
touch that starts on a tab — that is, anywhere on the strip — could never pan
the `overflow-x-auto` parent, so the strip was scrollable in markup and frozen
in the hand. Second, `computeTabStripLayout` shrank tabs toward a 60px
icon-only floor before enabling scrolling, and every chat tab carries the same
icon, so a phone with six chats showed six identical unlabelled slivers.

A third interaction sat on top: the app-wide sidebar swipe gesture claims any
rightward swipe starting within 60px of the left edge — which is inside the
first tab — so scrolling the strip back toward its first tab would have flung
the sidebar open instead.

## Decision

Keep the existing shrink-then-scroll algebra and move only the point at which
shrinking stops: `computeTabStripLayout` takes an optional `minTabWidth`
(clamped into [MIN_TAB_WIDTH, MAX_TAB_WIDTH]) and the strip passes
PHONE_MIN_TAB_WIDTH (124) on a phone. Three tabs still fill a 390px strip; the
fourth clips, which is the affordance that says there is more.

On a phone the tab element carries `touch-pan-x` instead of `touch-none` and
`useDraggable` is disabled, because a phone renders the whole tree as one pane —
a tab drag can only merge a tab into the pane it already sits in, so the gesture
buys nothing and costs the scroll. The scroll container adds
`overscroll-x-contain`, `-webkit-overflow-scrolling: touch` and
`motion-safe:scroll-smooth`, and an effect keyed on the focused tab calls
`scrollIntoView({block:"nearest", inline:"nearest"})` with NO `behavior`
argument, so the CSS scroll-behavior decides — which makes prefers-reduced-motion
land the same scroll instantly with no JS media query. The first alignment after
mount is explicitly instant so a freshly mounted strip does not animate from
zero.

The scroll container marks itself `data-swipe-scroll-x` while it overflows, and
SwipeGestureContext gains `startedInHorizontalScroller`: both pure swipe
predicates bail when it is set. The DOM lookup (`closest`) happens once at
touchstart inside the hook, so the decision functions stay pure, and because the
attribute is only rendered while the strip has something to scroll, the sidebar
gesture is untouched everywhere else.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-104 | component | Owns the tab strip and its sizing; gains a phone contract for the scrolling strip and the touch-action ownership it depends on | c3-104#n7017@v1:sha256:66cc0e56e82609fc540ea28c269128bca8d90d8654201c9be5adcdf1c1de642a | Contract row + Change Safety row for a touch-none regression |
| c3-110 | component | Owns the app-wide swipe gesture, which now yields to a horizontal scroller | c3-110#n7072@v1:sha256:b1b29b881b0ee8fc8a40dfee9ef7c5ea2d03a7a4d84f4d854f6d80dbac4f6dd6 | Contract row naming the exemption |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-zustand-store | The strip reads the viewport width through a store selector to decide phone behaviour, so the selector must stay reference-stable | ref-zustand-store#n9883@v1:sha256:53e3365a2350860110617c32292965a5051709854e758fc7470752136627d86e | comply — the selector returns a number, no fallback allocation |
| ref-colocated-bun-test | The raised floor is pure layout math and the phone rendering is store-dependent, so both need tests beside the module | ref-colocated-bun-test#n9581@v1:sha256:9490f9305f79ff29d492d099b81c1227c5d277e4a16bf251c1779ddc338f4be8 | comply — tabStripLayout.test.ts extended, PaneTabStrip.mobile.test.tsx added |
| ref-strong-typing | The layout input gains an optional numeric field and the swipe context an optional boolean, both crossing into pure predicates | ref-strong-typing#n9784@v1:sha256:390cd8fee6d22c17530c1b9551d02cbd40ea33c56574b7ebc313f21961a707af | comply — both are explicitly typed, no unknown or as |
| ref-cqrs-read-models | The strip renders only from projected layout state, so the phone branch must not reach for events | ref-cqrs-read-models#n9614@v1:sha256:768802027896fc8c9ebd415cf63483f64e0c5f2f4bc10f21079a8f7d51c38dcd | comply — the phone branch reads viewport width and the pane tree, nothing else |
| ref-ws-subscription | The swipe gesture lives in the app shell this ref governs, so the edit must not introduce a second subscription path | ref-ws-subscription#n9850@v1:sha256:856dbc5b26887801a91ee1acf2a59bd940bd7592ddaa57b46a8689de86dd07cc | comply — the gesture stays one window-level listener set, no transport involved |

## Verification

| Check | Result |
| --- | --- |
| bun test --conditions production src/client/components/panes/ src/client/app/sidebarSwipeGesture.test.ts | 151 pass, 0 fail |
| bun run test | 5004 pass, 2 skip, 0 fail |
| bun run lint && bun run typecheck && bunx ast-grep test | clean; 14 ast-grep rule suites pass |
| Headed browser at 390x844, 5 chat tabs open | strip scrollWidth 620 vs clientWidth 390; tab width 124 with labels; container touch-action pan-x, overscroll-behavior-x contain, scroll-behavior smooth; clicking the first tab from scrollLeft 230 animates 230→227→185→82→…→0 |
| Same, with prefers-reduced-motion: reduce | computed scroll-behavior falls back to auto and the tab lands instantly at 230 |
