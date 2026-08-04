---
id: adr-20260804-port-paseo-layout-ia
c3-seal: 60d1ceafcfbbad4988cf8f1da85d124d8008fe382d973279b2c67b0cf6f15af1
title: port-paseo-layout-ia
type: adr
goal: |-
    Record the first tranche of a layout/information-architecture port from
    [getpaseo/paseo](https://github.com/getpaseo/paseo) into Kanna's React client: a single
    owned breakpoint layer, a shell-level viewport measurement, a viewport-aware sidebar
    width clamp, and a pairwise vertical rhythm for the transcript. Design tokens are
    explicitly out of scope and unchanged. Paseo is AGPL-3.0 and is Expo/React Native Web,
    so this is a design-level borrow reimplemented against Kanna's own abstractions — no
    paseo source is vendored, translated, or named.
status: accepted
date: "2026-08-04"
---

# Port paseo layout/IA foundations into the client

## Goal

Record the first tranche of a layout/information-architecture port from
[getpaseo/paseo](https://github.com/getpaseo/paseo) into Kanna's React client: a single
owned breakpoint layer, a shell-level viewport measurement, a viewport-aware sidebar
width clamp, and a pairwise vertical rhythm for the transcript. Design tokens are
explicitly out of scope and unchanged. Paseo is AGPL-3.0 and is Expo/React Native Web,
so this is a design-level borrow reimplemented against Kanna's own abstractions — no
paseo source is vendored, translated, or named.

## Context

Three defects motivated this, all found by auditing the current client rather than by
reading paseo:

1. **Three drifted breakpoints.** `sidebarSwipeGesture.ts` used 768,
`ChatPage/index.tsx` used its own 768, and `useIsMobile` defaulted to 640. No module
owned the pivot, so each new responsive surface picked one by copying a neighbour.
2. **The sidebar ignored the viewport.** `clampSidebarWidth` honoured only its own
[220, 520] bounds, so a 900px window with the sidebar at its maximum left 380px of
chat — narrower than the transcript's own 800px column wants.
3. **The transcript had no rhythm.** Every row carried a flat `pb-5`. That is 20px,
which is not on the project's 4/8/12/16/24/32 spacing scale, and it gave a ~40px
chrome divider (`result`, `context_cleared`, `compact_boundary`) exactly as much air
as a full assistant turn.

Constraint from the client's existing gates: `useState` is banned outside
`components/ui/**`, so new state must be a Zustand store with named actions; and every
component test renders through `renderToStaticMarkup` with no layout, so every measured
value is `0` in tests.

## Decision

Introduce one pure module per concern and keep state in stores, so each rule is unit
testable without a DOM:

- `src/client/lib/viewport.ts` owns `BREAKPOINT_MD` plus `isMobileViewport` /
`isDesktopViewport`. Both predicates report **false** for an unmeasured (0) width, so
hydration falls through to the desktop/CSS default instead of flashing mobile.
- `src/client/stores/viewportStore.ts` holds the measured window size behind a single
resize subscription mounted in the app shell. The pre-existing `chatPageStore.viewportWidth`
could not serve this: its subscription only mounts on the chat route, so the sidebar
and settings would read a stale value.
- `resolveSidebarWidth` in `kannaSidebarStore` serves the content column first and gives
the sidebar the remainder above its own floor. It clamps only the *rendered* width;
the stored preference is untouched, so widening the window restores the user's choice.
- `src/client/app/transcriptSpacing.ts` derives each row's gap from the adjacent *pair*
of rows via a coarse tone (user / assistant / tool / chrome / card).

Two non-obvious calls inside the spacing module, both load-bearing:

**Gap-above, never gap-below.** With gap-below, appending row N+1 changes row N's
rendered height, which forces the virtualized list to re-measure an already-painted row
while `maintainVisibleContentPosition` is holding scroll — visible as jitter during
streaming, exactly when it is least welcome. Gap-above leaves every measured row
immutable.

**The gap lives in a lookup keyed by row id, not on the row objects.**
`computeStableResolvedTranscriptRows` reuses row objects whose own contents are
unchanged, so a gap stored on a row would go stale whenever only its *neighbour* changed.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-102 | component | Gains the viewportStore singleton and resolveSidebarWidth; both are new public store surfaces | c3-102#n6297@v1:sha256:63f3a401d5185cd427e6593783972c9330471af09e3da9a00853ac995f03187a | rule-zustand-store (named actions, no raw setters), rule-colocated-bun-test |
| c3-110 | component | The shell now owns the single viewport measurement for the whole app and hosts the pure breakpoint module under src/client/lib/** | c3-110#n6393@v1:sha256:8ab42d49b61088f14f8e8ee15878bd1663474489bb8f7d47d6cb681bcb7ed9c4 | Subscription must be mounted exactly once, at the shell |
| c3-111 | component | Rendered sidebar width is now a function of the viewport, not only of the stored preference | c3-111#n6451@v1:sha256:5e037fbdc0e9f98d0e20c5709c15886a9d01605f4ea184d40eb9fe6ea1aa028e | Stored preference must remain the user's, not the clamp's |
| c3-113 | component | Owns the new pairwise spacing contract consumed by the chat page's viewport | c3-113#n6546@v1:sha256:781b15e3104ab500a0f9aa31b237f215698cd0b49264d2526b62c55b5261fb70 | Gap-above invariant protects virtualization |
| c3-112 | N.A - consumes c3-113's spacing lookup without changing its own documented contract | N.A - render-detail only | N.A - no contract change | N.A - covered by c3-113 review |
| c3-114 | N.A - user-bubble corner radius is presentation only | N.A - no contract change | N.A - no contract change | N.A - design-gate lint already covers token use |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Breakpoint layer | Add lib/viewport.ts; point sidebarSwipeGesture and shouldUseMobileRightSidebarOverlay at it; make useIsMobile's 640 explicit at its one call site | commit c7fccaf |
| Viewport store | Add stores/viewportStore.ts + useViewportSubscription, mounted once in KannaLayout | commit c7fccaf |
| Sidebar clamp | Add resolveSidebarWidth; KannaSidebar derives the rendered width from it | commit b2eca86 |
| Test decoupling | Count transcript rows by data-transcript-row-id instead of by spacing classes | commit 8edd412 |
| Transcript rhythm | Add app/transcriptSpacing.ts; apply gap classes in ChatTranscriptViewport; normalise footer pb-5 to scale | commit a37a533 |
| User bubble | rounded-tr-sm clipped corner as a speech tail | commit 7128ceb |
| Code map | Map src/client/app/transcriptSpacing.ts and its test to c3-113 | .c3/code-map.yaml |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Reuse chatPageStore.viewportWidth instead of a new store | Its resize subscription mounts only on the chat route, so the sidebar and settings would read a stale width — the exact surfaces the clamp is for |
| Hide the sidebar below a threshold rather than clamp it | Misreads the source design, which clamps; hiding removes the user's navigation without asking, and clamping is ~40 lines against a new visibility state machine |
| Store the gap on each resolved row | computeStableResolvedTranscriptRows reuses unchanged row objects, so the gap would go stale whenever only a neighbour changed |
| Express the gap as a dynamic pt-[Npx] utility | Tailwind's JIT scanner cannot see a computed arbitrary value; the class would never be generated |
| Gap-below (padding under each row) | Appending a row would change the previous row's height and force a re-measure of an already-painted row mid-stream |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| A stale gap survives when only a neighbour row changes | Gap held in a lookup beside the rows, never on the reused row objects | transcriptSpacing.test.ts builds real rows via buildResolvedTranscriptRows and asserts every row receives a class |
| A new transcript kind silently falls back to default spacing | Tone map is a Record over the full HydratedTranscriptMessage["kind"] union, so an unclassified kind is a typecheck error | bun run typecheck; plus a runtime completeness test over every kind |
| Unmeasured (0) width classifies as mobile and flips rendered markup in every static-markup test | Both predicates and the clamp treat 0 as unmeasured and fall through | viewport.test.ts asserts isMobileViewport(0) === false; clamp test asserts SSR passthrough |
| History load (onStartReached) jumps because the first pre-existing row's gap-above changes | One row's height changes at the top boundary only; accepted and called out for manual smoke | Manual long-chat scrollback before merge |

## Verification

| Check | Result |
| --- | --- |
| bun run verify:client-arch (ast-grep + lint + typecheck + test) | Passes; 4437 baseline → 4480 tests, 0 fail |
| bun test --conditions production src/client/lib/viewport.test.ts | 9 pass |
| bun test --conditions production src/client/stores/viewportStore.test.ts | 5 pass |
| bun test --conditions production src/client/stores/kannaSidebarStore.test.ts | 27 pass, including the monotonic-in-viewport-width sweep |
| bun test --conditions production src/client/app/transcriptSpacing.test.ts | 18 pass, including the every-kind completeness test |
| C3X_MODE=agent c3x check | Clean after apply |
| Manual: narrow window to ~900px | Sidebar yields; chat column holds at or above 400px |
| Manual: long tool run + streaming scrollback | Tool activity reads as one block; no re-measure jitter at the bottom anchor |
