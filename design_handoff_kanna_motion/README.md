# Handoff: Kanna motion system

## Overview

This package specifies a motion layer for Kanna (`cuongtranba/kanna`) — the web UI for the
Claude Code and Codex CLIs. Kanna's information design is already strong; what it lacks is
*continuity*. Almost every state change is instant, so the app never tells you where anything
went: a new chat appears with no relationship to the button you pressed, a project expands as a
jump-cut, a panel blinks into existence with no sense of which edge it came from, and Settings
replaces its whole content pane twelve times an evening.

The work is one vocabulary — six duration tokens, four easings, two libraries — applied across
eight surfaces. Nothing here changes layout, copy, colour or information density. Every value in
this document was lifted from the repo's own source; the motion is additive.

**Libraries this specifies** (both requested by the project owner):

- **[anime.js v4](https://animejs.com/)** — state transitions and choreographed sequences.
  Timelines, springs, stagger, and `text.split` for the hero. Used imperatively.
- **[Motion](https://github.com/motiondivision/motion)** (`motion/react`) — interaction states.
  Hover, press, and `AnimatePresence` for mount/unmount. Used declaratively in components.

The split is deliberate: **anime.js owns sequences that cross component boundaries** (the
new-session transition touches the sidebar, the shell, the composer and the transcript at once —
no single React component owns it). **Motion owns states that live inside one component**
(a row's hover, a button's press, a panel's enter/exit).

## About the design files

The `.dc.html` files in this bundle are **design references**, not production code. They are
self-contained HTML prototypes that recreate Kanna's real screens (from the repo source) and
demonstrate the intended motion on top of them. They are written with inline styles and a small
custom runtime; **do not port them into the app**.

The implementation target is the **existing Kanna codebase**: React 19 + Tailwind CSS v4 +
Zustand, with tokens in `src/index.css`. Every section below names the real files to change. Your
job is to reproduce the specified *behaviour and timing* using the repo's established patterns —
not to recreate the prototypes.

Open them in a browser to feel the timing; read this README to implement it.

## Fidelity

**High-fidelity.** Every duration, easing, offset, distance and colour below is exact and was
either measured from the prototypes or taken from Kanna's own source. Colours are the repo's
existing oklch tokens — this specification introduces **no new colour**. Type, spacing and layout
are unchanged from what ships today.

Where a value already exists in the repo (the empty-state bloom, the 280ms panel curve, the 19ms
typewriter, the 60px swipe threshold), this spec **keeps it** and says so. Those are marked
`(existing — keep)`.

---

## Install

```bash
bun add animejs motion
```

- `animejs@^4` — ESM, tree-shakeable. Import `{ animate, createTimeline, stagger, createSpring, utils, text, eases }`.
- `motion@^12` — import React bindings from `motion/react`.

Both are pure client-side; they belong in `dependencies` and are only imported from
`src/client/**`, which satisfies the side-effect lint seal (no `node:*`, no `Bun.*`).

---

## Design tokens

Add these to `src/index.css` alongside the existing `@theme` block. They are the **only** timing
values any component may use; a literal duration at a call site is the drift this table exists to
prevent (the same rule `shellChrome.ts` already enforces for the top band).

### Durations

| Token | Value | Used for |
| --- | --- | --- |
| `--motion-instant` | `80ms` | Press feedback, checkbox fill |
| `--motion-quick` | `160ms` | Hover, chevron rotate, colour change |
| `--motion-row` | `180ms` | List rows, tool cards, diff rows, board cards |
| `--motion-panel` | `280ms` | Terminal, git panel, drawer, sheet, empty state *(existing — keep)* |
| `--motion-stagger-tight` | `14ms` | Sidebar rows making room |
| `--motion-stagger-row` | `26ms` | Project expand cascade |
| `--motion-stagger-loose` | `40ms` | Transcript tool rows |
| `--motion-sequence` | `860ms` | The whole new-session sentence (sum, not a single tween) |

**Hard ceiling: no single beat exceeds 300ms.** A sequence may total more; one movement may not.

### Easings

| Name | anime.js | CSS equivalent | Used for |
| --- | --- | --- | --- |
| `arriving` | `"out(3)"` | `cubic-bezier(.22,.61,.36,1)` | Anything entering the screen — ~90% of all motion |
| `born` | `"outBack(1.6)"` | — | The **one** newly-created element per transition. Never more than one. |
| `landing` | `createSpring({ stiffness: 190, damping: 17 })` | — | The composer landing; press release |
| `panel` | `"cubicBezier(0.22, 1, 0.36, 1)"` | `cubic-bezier(.22,1,.36,1)` | Panels *(existing — keep; already in `src/index.css`)* |

### Colour

No new colour. Motion uses exactly two existing tokens:

- `--logo` (`oklch(71.2% 0.194 13.428)`) — the "this is new" accent: the spawned row's 2px rail,
  the composer's focus sweep, the session sigil's newest tick, the board's drop line border.
- `--primary` — the board's 1px drop line *(existing — keep)*.

Status colours (`--warning`, `--info`, `--success`, `--destructive`) keep their current meanings
from `chatStatusIndicator.ts`. Motion never introduces meaning through colour.

---

## ⚠ Three pitfalls — read before writing any code

These were each found by breaking them while building the prototypes. All three are cheap to
prevent and expensive to debug.

### 1. Never hide content with an animation that might not run

**The trap.** A reveal written as `animate(el, { opacity: [0, 1] })` sets opacity to `0` on play.
If that animation is then frozen, throttled or never completes, the element is invisible
**permanently** — and no user action can recover it. This cost the most time of anything in this
work: a whole chapter of the spec rendered blank, and it looked like a layout bug.

Ways it happens in practice: a paused animation engine (see #2), a backgrounded tab, a blocked
CDN, a thrown easing function, a missed `IntersectionObserver` callback, an element that is taller
than the viewport so a ratio threshold is mathematically unreachable
(`max ratio = viewport / target`).

**The rule.** A scroll- or mount-triggered reveal animates **transform only** (`y`, `scale`), never
`opacity`. If the animation never runs, the content is simply static — motion is lost, content is
not.

```ts
// ✗ loses the block if it freezes
animate(rows, { opacity: [0, 1], y: [22, 0], duration: 280 })

// ✓ safe in every state
animate(rows, { y: [22, 0], duration: 280, ease: "out(3)" })
```

Opacity is fine in **user-triggered** animations (clicking Send, opening a panel), because the
user can retry and the resting state is visible. It is not fine in anything that fires on
arrival.

### 2. anime.js pauses its engine when the document is hidden

`anime.engine.pauseOnDocumentHidden` defaults to `true`. Background the tab mid-transition and
every running timeline **freezes in place** — leaving the UI in a state no user action produced
(a half-open drawer, a card stranded between columns). Kanna is an app people leave running while
they switch away to watch a build, so this fires constantly.

Flipping the flag is not sufficient: if the engine already paused, it stays paused.

```ts
import { engine } from "animejs"

engine.pauseOnDocumentHidden = false
engine.resume?.()
```

Do this **once**, at client bootstrap (`src/main.tsx` or `AppBootstrap.tsx`), not per component.

### 3. Load the library without blocking first paint

A synchronous `<script src>` for the animation library stalls the whole page when the CDN is slow.
In Kanna this is moot if you `bun add animejs` and import it through Vite (the correct approach) —
but if anyone reaches for a CDN tag, mark it `async` and have the consuming code tolerate the
library being absent for the first few frames.

---

## Reduced motion — one gate, applied once

Kanna's `src/index.css` already forces `animation-duration: .01ms` under
`prefers-reduced-motion: reduce`, which covers CSS. **It does not cover JS-driven animation** —
anime.js and Motion both ignore it.

Add a single helper and gate every timeline on it:

```ts
// src/client/lib/motion.ts
export const prefersReducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches
```

```ts
const tl = buildNewSessionTimeline()
if (prefersReducedMotion()) tl.complete()   // jump to the end state, one frame
```

`tl.complete()` rather than skipping the timeline: the end state is what the UI must look like,
and it must be reached identically by both paths.

**Also treat keyboard-driven navigation as reduced motion.** `⌘N`, `⌘1–9` and the other
`keybindings.ts` actions skip the sequence and jump to the end state. Someone driving the app from
the keyboard is moving faster than the animation and does not need to be shown where things went.

---

## Global rules

1. Only `opacity`, `transform` and `filter` are animated. **No `width`, `height`, `top`, `left` or
   `margin` on anything inside the transcript** — `LegendList`'s `maintainVisibleContentPosition`
   corrects scroll whenever a row's measured height changes, and an animated height would fight it
   every frame.
2. **Stagger caps at 8 elements.** Element 9 onward shares element 8's delay, so a 200-row list
   never queues a visible wave. `stagger(40, { limit: 8 })` if the version supports it; otherwise
   clamp the index yourself.
3. Every animated element **keeps its final inline style**. A hot reload or an unrelated React
   re-render must never re-play a transition.
4. Live values (the running duration, the token pill, a board column's count) update by **text
   swap**, never by animating layout. They are already `tabular-nums`, so the container cannot
   reflow.
5. Nothing animates while the transcript is scrolling under a finger. The existing `scrollBy`
   guard in `ChatTranscriptViewport.tsx` stays authoritative — do not add motion that calls
   `scrollTo`/`scrollBy` during a touch gesture.
6. No new colour, no new shadow at rest, no gradient. Depth is a **response to a state**, never a
   resting style. (This is already the board's design brief; it now applies app-wide.)

---

# The eight surfaces

Each section names the real files to change, the exact behaviour, and the numbers.

---

## 01 · New session — the headline transition

**Files:** `src/client/app/KannaSidebar.tsx`, `src/client/components/chat-ui/sidebar/ChatRow.tsx`,
`src/client/components/chat-ui/sidebar/LocalProjectsSection.tsx`,
`src/client/app/ChatPage/ChatTabContent.tsx`, `src/client/components/chat-ui/ChatInput.tsx`,
`src/client/app/ChatPage/ChatTranscriptViewport.tsx`, `src/client/app/useChatPageSidebarActions.ts`

**Today:** `onCreateChat` → `handleCreateChat` → `navigate('/chat/:id')`. The route swaps, a row
appears in the sidebar, the composer is focused by `chatFocusPolicy`. All of it is instant and
none of it is connected, so the eye has nothing to follow from the button it pressed to the
composer it must now type in.

**Intended:** one continuous sentence in five beats, **860ms total**, no beat over 300ms.

| # | Beat | What moves | Spec |
| --- | --- | --- | --- |
| 1 | The list makes room | Rows below the insertion point | `y: 0 → 31px` (one row height), `180ms`, `out(3)`, `stagger(14)`, starts at `0ms` |
| 2 | The row is born | The new `ChatRow` | `height: 0 → 31px` + `opacity: 0 → 1`, `200ms`, `outBack(1.6)`, starts at `120ms` |
| 2 | …and its rail | A 2px `--logo` bar on the row's left edge | `scaleY: 0 → 1`, transform-origin top, `200ms`, starts at `140ms` |
| 3 | The shell steps back | Sidebar | `scale: 1 → .972`, `x: 0 → -8px`, `opacity: 1 → .55`, `220ms`, starts at `260ms` |
| 3 | …and comes forward | Chat surface | `scale: 1.035 → 1`, `opacity: 0 → 1`, `220ms`, starts at `260ms` |
| 3 | …carrying the title | FLIP the row's title to the navbar position | `240ms`, `out(4)`, starts at `280ms` |
| 4 | The composer arrives focused | `ChatInput` wrapper | `y: 56 → 0`, `scale: .96 → 1`, `opacity: 0 → 1`, `260ms`, `spring(190, 17)`, starts at `420ms` |
| 4 | …focus rule sweeps | 1.5px `--logo` bar on the composer's bottom edge | `scaleX: 0 → 1`, origin left, `220ms`, `out(4)`, starts at `480ms` |
| 4 | …caret pulses | The text caret | `opacity` blink ×3, `280ms`, `steps(6)`, starts at `520ms` |
| 5 | The transcript opens | Empty-state flower | `scale: .1 → 1`, `filter: blur(12px) → blur(0)`, `opacity: 0 → 1`, `280ms`, `out(4)`, starts at `600ms` *(the existing `kanna-empty-state-flower-in` keyframe, retimed from 420ms)* |
| 5 | …and types | `EMPTY_STATE_TEXT` | `19ms`/char *(existing — keep; `EMPTY_STATE_TYPING_INTERVAL_MS`)* |

**Beat 3's FLIP** is the beat that does the real work — it is what stops the new chat from feeling
like a page load. Measure the row's title rect and the navbar title rect, translate a positioned
clone between them, then fade the clone out and the real navbar title in at `470ms`.

```ts
import { createTimeline, stagger, createSpring, utils } from "animejs"
import { prefersReducedMotion } from "../lib/motion"

export function playNewSession(refs: NewSessionRefs) {
  const tl = createTimeline({ defaults: { ease: "out(3)" } })

  tl.add(refs.rowsBelow, { y: [0, ROW_H], duration: 180, delay: stagger(14) }, 0)
    .add(refs.spawnRow,  { height: [0, ROW_H], opacity: [0, 1], duration: 200, ease: "outBack(1.6)" }, 120)
    .add(refs.spawnRail, { scaleY: [0, 1], duration: 200 }, 140)
    .add(refs.sidebar,   { scale: [1, .972], x: [0, -8], opacity: [1, .55], duration: 220 }, 260)
    .add(refs.surface,   { scale: [1.035, 1], opacity: [0, 1], duration: 220 }, 260)
    .add(refs.flyer,     { ...flipTo(refs.navTitle), duration: 240, ease: "out(4)" }, 280)
    .add(refs.navTitle,  { opacity: [0, 1], duration: 160 }, 470)
    .add(refs.composer,  { y: [56, 0], scale: [.96, 1], opacity: [0, 1],
                           duration: 260, ease: createSpring({ stiffness: 190, damping: 17 }) }, 420)
    .add(refs.sweep,     { scaleX: [0, 1], duration: 220, ease: "out(4)" }, 480)
    .add(refs.caret,     { opacity: [0, 1, 0, 1, 0, 1], duration: 280, ease: "steps(6)" }, 520)
    .add(refs.flower,    { scale: [.1, 1], filter: ["blur(12px)", "blur(0px)"],
                           opacity: [0, 1], duration: 280, ease: "out(4)",
                           onComplete: () => typeEmptyState(19) }, 600)

  if (prefersReducedMotion()) tl.complete()
  return tl
}
```

**Where this lives.** Not in a component — it spans four of them. Put it in a
`src/client/lib/motion/newSession.ts` module that takes element refs, and call it from
`useChatPageSidebarActions.ts` where `handleCreateChat` already coordinates the create + navigate.
Register the refs through a small context or a Zustand slice holding `HTMLElement | null`s.

---

## 02 · Sidebar — a list that shows it is alive

**Files:** `src/client/components/chat-ui/sidebar/ChatRow.tsx`,
`src/client/components/chat-ui/sidebar/LocalProjectsSection.tsx`,
`src/client/lib/chatStatusIndicator.ts` (read only — tones are already correct)

### Status, as a pulse

The status dot already carries the right colour. Add a halo behind it so a live chat reads as live
from across the desk:

- **running / starting** — halo `scale: 1 → 2.1`, `opacity: .28 → 0`, `1600ms`, `out(2)`, looping.
  Matches the existing `shiny-pulse` 1.6s period so the sidebar and the transcript breathe together.
- **waiting_for_user** — halo `opacity: 0 → .3 → 0`, `600ms`, `inOut(2)`, loop with `1400ms` delay.
  A tick, not a breath: waiting is a prompt, not activity.
- **idle** — **nothing.** Stillness is the signal. Do not animate the resting state.
- **failed** — nothing. A failure should not draw the eye repeatedly; the colour and label do the work.

CSS keyframes are fine here (no JS needed), which means the existing reduced-motion block already
covers them.

### Expand as a cascade

`LocalProjectsSection`'s `onToggleSection` currently mounts/unmounts the rows.

- Chevron: `rotate: 0 → 90deg`, `160ms`, `out(3)` *(the existing `transition-transform duration-150` is close — align to 160ms)*
- Rows on open: `opacity: [0,1]`, `y: [-8, 0]`, `180ms`, `out(3)`, `stagger(26, { from: "first" })`
- Rows on close: reversed, `stagger(26, { from: "last" })` — the group folds **towards** its header

The direction reversal is the point: collapse that staggers from the top reads as the list falling
over; from the bottom it reads as folding shut.

### Hover and press — Motion, in the component

`ChatRow`'s fork/archive buttons are currently always rendered and always visible. Slide them in
instead:

```tsx
<motion.div whileHover="on" initial="off" animate="off"
  transition={{ type: "spring", stiffness: 320, damping: 26 }}>
  <motion.div variants={{ off: { opacity: 0, x: 8 }, on: { opacity: 1, x: 0 } }}>
    <ForkButton /><ArchiveButton />
  </motion.div>
</motion.div>
```

Press: `scale: .985` over `80ms`, releasing on `spring(420, 18)`. Forgiving on a mis-tap, and on
mobile it is the only feedback a 44px target gives.

**Keep** the existing `group-hover:opacity-0` on the trailing timestamp — the timestamp fading as
the actions arrive is already correct.

---

## 03 · Transcript — work arriving, not appearing

**Files:** `src/client/app/ChatPage/ChatTranscriptViewport.tsx`,
`src/client/components/messages/ToolCallMessage.tsx`,
`src/client/app/KannaTranscript.tsx`, `src/client/components/ui/reduction.tsx`

### Tool rows land in sequence

- Per row: `opacity: [0,1]`, `y: [6, 0]`, `180ms`, `out(3)`
- `stagger(40)`, **capped at 8 rows**

Only **incoming** rows animate. Everything already rendered is untouched — this is what keeps
scroll position and `maintainVisibleContentPosition` honest. Key the animation off row identity
(`item.id`), not off list length.

`6px` of travel and no scale: enough to read as a sequence, cheap enough that a 400-row transcript
never thrashes. Both properties are compositor-only.

### The session sigil earns a tick

`reduction.tsx` already draws one stroke per turn. When a turn closes, the newest tick **grows from
the baseline** rather than appearing: animate the `<line>`'s `y2` from `baselineY` to `topY`,
`240ms`, `out(4)`. It is the session's history being written live, and it is the one place in the
app where an SVG attribute animation is worth it.

### Keep as-is

`AnimatedShinyText`'s `shiny-pulse`, the `Loader2` spin, and the scroll-to-bottom button's
`scale .75 → 1` + opacity over 200ms `cubic-bezier(.22,1,.36,1)` are all already right. Do not
touch them.

---

## 04 · Panels — arriving from where they live

**Files:** `src/client/components/chat-ui/TerminalPane.tsx`,
`src/client/components/chat-ui/RightSidebar.tsx`, `src/index.css`
(the `[data-terminal-visual]` / `[data-right-sidebar-visual]` blocks)

**Today** both panels animate `opacity` plus a 4px nudge over `280ms cubic-bezier(.22,1,.36,1)`.
The timing is right; the **direction** is missing — 4px is too little to say where the panel came
from.

- **Terminal** — `y: 100% → 0` (its own height), `280ms`, `panel` easing. It opens **upward from
  the bottom edge**.
- **Git panel** — `x: 100% → 0`, `280ms`, `panel` easing. It slides in **from the right**.
- **Diff rows inside the git panel** — `opacity: [0,1]`, `x: [10, 0]`, `180ms`, `out(3)`,
  `stagger(34, { start: 120 })`. They arrive after the panel has landed, not with it.

Exit reverses the same travel, so the panel returns to the edge it came from. Use Motion's
`AnimatePresence` here — this is a mount/unmount inside one component, which is exactly what it is
for:

```tsx
<motion.aside
  initial={{ x: "100%", opacity: 0 }}
  animate={{ x: 0, opacity: 1 }}
  exit={{ x: "100%", opacity: 0 }}
  transition={{ duration: .28, ease: [.22, 1, .36, 1] }}
/>
```

Keep the existing `--terminal-toggle-duration` custom property and the
`[data-terminal-animated="false"]` escape hatch — both are already correct and the escape hatch is
what lets a layout restore skip the animation.

---

## 05 · Boards — a card that moves because you moved it

**Files:** `src/client/components/boards/KannaBoard.tsx`,
`src/client/components/boards/BoardDrag.store.ts`, `src/client/lib/boards/columnStyle.ts`

The board's design brief (`docs/kanban-boards-design-brief.md`) is already strict and this spec
**does not relax it**: a column at rest is the page with a 1px divider, its colour is a 6px dot
never a background wash, the drop target is a 1px line that exists only while dragging, and a
healthy card shows no badges.

Motion adds exactly three things:

| Beat | What | Spec |
| --- | --- | --- |
| 1 | Lift — the card is in your hand | `scale: 1 → 1.02`, `120ms`, `out(3)` |
| 2 | The line says where it lands | `scaleX: 0 → 1`, origin left, `140ms`, `out(4)` |
| 3 | Travel | FLIP to the target slot, `260ms`, `spring(210, 24)` |
| 4 | Land | `opacity: 0 → 1`, `160ms` |

`@atlaskit/pragmatic-drag-and-drop` already provides `onDragStart` / `onDrop` and the
`BoardDrag.store` already tracks `cardDrop`. Hook the lift to `startCardDrag`, the line to
`setCardDrop`, and the travel to `resolveCardDrop` — a real FLIP between the source rect and the
resolved destination rect, so the card ends where the data says it went.

**What must NOT animate**, and why each one matters:

- A resting card gains **no shadow and no left stripe**. Depth is a state response.
- A column gains **no tint on hover**. The divider is the whole affordance.
- The status dot **does not pulse** here (unlike the sidebar). A board is scanned, not watched — 200
  pulsing dots is noise, and `cardWorkSignal.ts` already puts the meaning in the label beside it.
- The column count **swaps text**, never animates. It is `tabular-nums`, so a growing column's
  header cannot reflow — the header stays still while the cards do the moving.

---

## 06 · Settings — twelve sections, one place your eye returns to

**Files:** `src/client/app/SettingsPage.tsx` (the `sidebarItems` nav and `SettingsRow`),
`src/client/components/settings/SettingsList.tsx`

**Today** the nav highlight is a `bg-muted` class that moves by re-render, and switching a section
replaces the content pane wholesale. Twelve sections means the reader loses their place twelve
times an evening.

**Intended:** one continuous element that travels.

- **Selection indicator** — a single absolutely-positioned block behind the nav rows, animated
  `y → clicked row's offset`, `240ms`, `spring(240, 26)`. **One reused node.** Never a fade-out /
  fade-in pair: a crossfade has no direction, so it cannot lead the eye — it only resets it.
- **Content rows** — `opacity: [0,1]`, `y: [12, 0]`, `180ms`, `out(3)`, `stagger(32)`, capped at 8.
- **Section heading + subtitle** — `filter: blur(4px) → blur(0)`, `200ms`, `out(3)`. Reuses the
  existing `kanna-empty-state-text-in` treatment, so the app has one idea of what "new text" looks
  like.

Measure the indicator's target from the row's `offsetTop` relative to the nav container, and
reposition it (without animation) on mount and on resize so it is never stranded.

---

## 07 · Mobile & PWA

**Files:** `src/client/app/sidebarSwipeGesture.ts`, `src/client/app/KannaSidebar.tsx`
(the mobile overlay branch), `src/client/components/chat-ui/ChatNavbar.tsx` (the mobile status
row), `src/client/components/chat-ui/ChatInput.tsx` (the Chat settings dialog),
`src/client/lib/viewport.ts`

Below `BREAKPOINT_MD` (768) Kanna already swaps to one column. That layout is correct; what it
lacks is any sense of motion, and on a phone motion **is** the navigation.

### The drawer becomes finger-tracked

This is the important one. `evaluateSidebarSwipe` already decides the outcome correctly — the
gesture is not changing. What is missing is the frames between finger and result.

```ts
const DRAWER_W = el.offsetWidth

// While the finger is down: 1:1, no easing. Easing only ever
// describes what happens AFTER release.
onTouchMove: (dx) => {
  const t = clamp(base + dx / DRAWER_W, 0, 1)
  drawer.style.transform = `translateX(${(t - 1) * 100}%)`
  scrim.style.opacity = String(t)
  scrim.style.backdropFilter = `blur(${t * 6}px)`
}

// On release: evaluateSidebarSwipe() decides, a spring executes.
onTouchEnd: (outcome) => {
  animate(drawer, {
    x: outcome === "open" ? "0%" : "-100%",
    duration: 280,
    ease: createSpring({ stiffness: 210, damping: 22 }),
  })
}
```

**Every threshold stays exactly as shipped** — `SIDEBAR_SWIPE_MIN_HORIZONTAL_PX` (60),
`SIDEBAR_SWIPE_HORIZONTAL_RATIO` (1.5), `SIDEBAR_SWIPE_OPEN_START_MAX_X` (60),
`SIDEBAR_SWIPE_PREVENT_MIN_DX` (8), `SIDEBAR_SWIPE_MAX_DURATION_MS` (500). A gesture the user has
already learned must not change meaning.

Note the two grab regions differ: **opening** starts anywhere in the screen's `0–60px` edge band
(the panel is off-screen), **closing** starts on the open panel itself. Attaching the open handle
to the panel is wrong — it is off-screen and clipped.

Drawer rows stagger in behind the panel: `opacity: [0,1]`, `x: [-14, 0]`, `190ms`, `out(3)`,
`stagger(22, { start: 70 })`.

### Chat settings becomes a sheet

`ChatInput`'s mobile branch opens a centred `Dialog`. Make it a bottom sheet:

- Sheet: `y: 100% → 0`, `280ms`, `spring(200, 21)`; exit `240ms` `panel` easing
- Scrim: `opacity: 0 → 1`, `200ms`, `out(3)`
- Rows: `opacity: [0,1]`, `y: [10, 0]`, `180ms`, `stagger(30, { start: 90 })`
- Pad by `env(safe-area-inset-bottom)` — nothing animates into the home indicator

### Mobile deltas

| What | How | Existing hook |
| --- | --- | --- |
| Status row → pill | `StateMark` + label; live duration returns at ≥430px. The mark gains the running halo. | `min-[430px]` |
| Preference pills → sheet | Spring entrance, 30ms row stagger | `md:hidden` |
| Targets reach 44px | Press `scale .955`, spring back | `icon-mobile` |
| Composer travel | `40px`, not desktop's 56px — the keyboard owns that space | — |
| Safe area | Sheet and composer both pad by `env()` | `.safe-area-inset-bottom` |

**Additional mobile rules:** `backdrop-filter` on **one element at a time**, only during a 240ms
transition — never left running behind a static overlay (it is the most expensive thing here on a
phone GPU). And native edge swipe-back is claimed only after 8px of committed horizontal travel,
so vertical scrolling is never intercepted — that is what `shouldPreventNativeBack` already does.

---

## State management

Almost none of this needs new state. Kanna's Zustand stores already hold what the motion reads:

| Store | Already has | Motion uses it for |
| --- | --- | --- |
| `kannaSidebarStore` | `collapsedSections`, `expandedGroups`, `isResizingSidebar` | Cascade direction; suppress motion during a resize drag |
| `chatPageStore` | `typedEmptyStateText`, `isEmptyStateTypingComplete` | Beat 5 |
| `BoardDrag.store` | `draggingCardId`, `cardDrop`, `columnDrop` | Lift, drop line, travel |
| `paneLayoutStore` | terminal / right-sidebar visibility | Panel direction |
| `settingsPageStore` | — | **Add** `sectionId` if the indicator needs it (it can read the route instead) |

**New state to add:** exactly one thing — a slice (or context) holding the `HTMLElement | null`
refs the new-session timeline needs, because that sequence spans four components and no single one
of them owns it. Keep it out of React state (refs, not renders) so a pointer-move never triggers a
re-render — the same reason `KannaSidebar` keeps `resizeStartRef` in a ref today.

## Assets

**No new assets.** Every icon is an existing `lucide-react` import. `icons.js` in this bundle is
only there so the prototypes can render without npm — do not port it.

The one drawn element the motion adds is the spawned row's 2px rail and the composer's 1.5px focus
sweep: both plain `<span>`s filled with `var(--logo)`, no SVG.

---

## Suggested PR sequence

Each step is independently shippable and independently revertable.

1. **Foundation.** `bun add animejs motion`; add the token block to `src/index.css`; add
   `src/client/lib/motion.ts` (`prefersReducedMotion`, easing constants); flip and resume the anime
   engine at bootstrap (pitfall #2). No visible change.
2. **Sidebar** (§02). Self-contained, lowest risk, immediately felt. Good place to validate the
   token table before it is used widely.
3. **Panels** (§04). Small diff — the timing already exists, only direction is added.
4. **Transcript** (§03). Watch the stagger cap and re-verify scroll behaviour on a long chat.
5. **Settings** (§06) and **Boards** (§05). Independent of each other.
6. **New session** (§01). Last on purpose: it depends on the ref plumbing and touches the most
   files. Everything before it is a prerequisite you will already have shipped.
7. **Mobile** (§07). Needs a real device; the drawer cannot be judged with a mouse.

## Acceptance checklist

- [ ] No single animation exceeds 300ms
- [ ] `prefers-reduced-motion: reduce` jumps every sequence to its end state in one frame — drawer, sheet, typing included
- [ ] Keyboard navigation (`⌘N`, `⌘1–9`) skips sequences entirely
- [ ] No `width` / `height` / `top` / `left` animated anywhere in the transcript
- [ ] A 400-row transcript scrolls at 60fps while a turn streams
- [ ] Backgrounding the tab mid-transition and returning leaves **no** element stranded (pitfall #2)
- [ ] No scroll- or mount-triggered reveal animates `opacity` (pitfall #1)
- [ ] Every swipe threshold matches `sidebarSwipeGesture.ts` unchanged
- [ ] `bun run lint` passes with zero warnings; no `node:*` / `Bun.*` import added under `src/client/**`
- [ ] Both light and dark themes verified — motion introduces no new colour

---

## Files in this bundle

| File | What it is |
| --- | --- |
| `Kanna Shell.dc.html` | **Baseline.** Today's desktop chat screen, recreated from repo source with no motion. The before. |
| `Kanna Motion.dc.html` | **The showcase.** Scroll-driven, chapters 01–06 and 08 (the spec chapter). Every sequence is playable. |
| `Kanna Mobile.dc.html` | **Chapter 07.** The phone, in a device frame. The drawer is genuinely draggable — grab the left 60px band and pull. |
| `design-notes.md` | Every token, geometry value and existing-motion inventory lifted from `src/index.css` and friends. |
| `icons.js` | Lucide glyphs, so the prototypes render offline. **Not for the app.** |
| `github.md` | Source association and the screen → repo-file map. |

Open `Kanna Motion.dc.html` first, and use the `speed` tweak to slow a sequence to 0.35× when you
need to see what a beat actually does.

## Source of truth

Everything above traces to files read in `cuongtranba/kanna@main`:
`src/index.css`, `src/client/lib/shellChrome.ts`, `src/client/app/App.tsx`,
`src/client/app/KannaSidebar.tsx`, `src/client/app/SidebarUtilityNav.tsx`,
`src/client/components/chat-ui/sidebar/ChatRow.tsx`,
`src/client/components/chat-ui/sidebar/LocalProjectsSection.tsx`,
`src/client/components/chat-ui/ChatNavbar.tsx`, `src/client/components/chat-ui/ChatInput.tsx`,
`src/client/components/chat-ui/ChatPreferenceControls.tsx`,
`src/client/components/chat-ui/SessionTokenPill.tsx`,
`src/client/components/chat-ui/ContextWindowMeter.tsx`,
`src/client/app/ChatPage/ChatTabContent.tsx`,
`src/client/app/ChatPage/ChatTranscriptViewport.tsx`, `src/client/app/ChatPage/utils.ts`,
`src/client/components/messages/*`, `src/client/components/ui/{button,card,reduction,state-mark,session-mark,animated-shiny-text}.tsx`,
`src/client/lib/{statusLabel,stateMark,chatStatusIndicator,viewport}.ts`,
`src/client/app/sidebarSwipeGesture.ts`, `src/client/stores/kannaSidebarStore.ts`,
`src/client/components/boards/KannaBoard.tsx`,
`src/client/lib/boards/{columnStyle,cardWorkSignal}.ts`, `src/client/app/SettingsPage.tsx`,
`src/client/components/settings/SettingsList.tsx`.
