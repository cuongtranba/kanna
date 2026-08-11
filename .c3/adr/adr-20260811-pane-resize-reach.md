---
id: adr-20260811-pane-resize-reach
c3-seal: d60ae00f3a2c0865cc0d01904c27692a37f0de4b187cd6e4c518399fe5901e81
title: pane-resize-reach
type: adr
goal: |-
    Make pane resizing reachable. Panes have always been drag-resizable, but the affordance was
    an 8px mouse-sized strip whose only mark was a 1px hairline; there was no keyboard path at
    all (`resizeGroup` shipped documented as "the pairwise one used for keyboard nudges" and had
    no caller anywhere); and the tab strip's shrink floor was a hardcoded constant. This decision
    adds a visible, touch-sized divider, four rebindable resize actions built on a divider-moves-
    with-the-arrow model, and a server-backed tab-width preference.
status: done
date: "2026-08-11"
---

## Goal

Make pane resizing reachable. Panes have always been drag-resizable, but the affordance was
an 8px mouse-sized strip whose only mark was a 1px hairline; there was no keyboard path at
all (`resizeGroup` shipped documented as "the pairwise one used for keyboard nudges" and had
no caller anywhere); and the tab strip's shrink floor was a hardcoded constant. This decision
adds a visible, touch-sized divider, four rebindable resize actions built on a divider-moves-
with-the-arrow model, and a server-backed tab-width preference.

## Context

Three separate gaps, all reported as "can't resize the panel tab":

1. `ResizableHandle` drew a hairline inside an 8px strip with pointer-only sizing, and carried
a vestigial `void withHandle` that read as "grip deliberately disabled".
2. `paneKeyboard.ts` had no resize command, so `resizeGroup` / `clampPairSizes` — written and
tested for exactly this — were dead code reachable only by the library's own separator keys.
3. `computeTabStripLayout` already accepted a clamped `minTabWidth`, but only the phone floor
(`PHONE_MIN_TAB_WIDTH`) ever set it; on a pointer viewport tabs always shrank to the
icon-only floor with no way to prefer wider, scrolling tabs.

Touch resize needed no layout work: the phone-flatten gate is width-based
(`isMobileViewport(width) = width < 768`), so tablets and landscape phones already render the
real tree with separators, and `sidebarSwipeGesture` stands down below 768 — there is no
gesture conflict to resolve. The phone-flatten contract is deliberately untouched.

## Decision

**The divider moves the way the arrow points — always.** The nudge's sign is a pure function
of the direction pressed, never of where the focused pane sits in its group. For a last child,
whose outer edge *is* the group's edge, the boundary on its left is used with the same sign —
so pressing right slides that divider right and narrows the pane. The tempting alternative
("right always grows the focused pane") is geometrically impossible there and makes the only
divider on screen travel against the key. This matches tmux's `resize-pane` fallback and the
resize library's own separator keys, so nudging from a pane and from a focused divider agree.

Boundary resolution is a new pure module (`src/client/lib/paneTree/resize.ts`,
`findResizeBoundary`) that walks outward from the focused pane past wrong-axis ancestors,
mirroring `findNearestSiblingPaneId`. The store action `resizeFocusedPane(direction)` derives
its whole subject internally, per `rule-zustand-store`. Step is `0.05` — half `MIN_PANE_FRACTION`,
so no single press can pin a pane, and equal to the library's own 5% separator step.

Divider state is driven by the library's `data-separator` attribute rather than `:hover` /
`:active`, because a drag holds pointer capture and travels outside the strip; a pseudo-class
would drop the highlight mid-drag.

Tab-width bounds move to `src/shared/pane-tab-width.ts` so the settings clamp and the layout
floor are one fact. The preference is server-backed (`AppSettingsSnapshot.panes.tabMinWidth`),
mirroring `terminal.minColumnWidth`, so it follows the user rather than dying with localStorage.
Its default is `MIN_TAB_WIDTH`, which reproduces the pre-preference layout exactly.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-104 | component | Gains a divider-affordance contract, four more keyboard actions (nine → thirteen), and a tab-width preference input; the pure tree algebra gains a resize-boundary resolver | c3-104#n7727@v1:sha256:75e514a2de822bcb2c0f55d2e994ec7f6392e383fcf808660661366a456103d8 | Confirm the phone-flatten and phone-strip contracts are unchanged, and that the new store action derives its subject internally |

## Verification

| Check | Result |
| --- | --- |
| `bun run typecheck` | Clean — `AppSettingsSnapshot.panes` forced every construction site |
| `bun run lint` | Clean at `--max-warnings=0` (caught a banned `unknown` in the clamp; retyped generic like `clampNumber`) |
| `bunx ast-grep test && bun run lint:usestate` | 14 rules pass; the new `tabMinWidth` selector is a scalar, so reference-stable |
| `bun test --conditions production` | 5551 pass, 2 skip, 0 fail across 460 files |
| `bun test --conditions production src/client/lib/paneTree/resize.test.ts` | 10 pass — pins the axis mapping, the last-child sign, and the ancestor walk |
| `bun test --conditions production src/client/stores/paneLayoutStore.test.ts` | Includes the end-to-end divider proof: focus on either side of one boundary moves it identically |
