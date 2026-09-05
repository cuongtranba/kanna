---
id: c3-110
c3-version: 4
c3-seal: 2f299cc66565faeefddc07eaec99a61ffc2a4aecfd5a187183736dbd8e672a24
title: app-shell
type: component
category: feature
parent: c3-1
goal: 'Own the top-level React shell: routing, Kanna state hook (useKannaState), socket wiring, global keybindings, and layout chrome.'
uses:
    - ref-cqrs-read-models
    - ref-ws-subscription
---

# app-shell

## Goal

Own the top-level React shell: routing, Kanna state hook (useKannaState), socket wiring, global keybindings, and layout chrome.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-1 (client) |
| Parent Goal Slice | "Subscribe to server snapshots… and stay synchronized with server state via WebSocket subscriptions" |
| Category | feature |
| Lifecycle | Mounts once at boot; unmounts only on full reload |
| Replaceability | Hard to replace — defines container linkages for every feature page |

## Purpose

Composes the React tree at boot: react-router, the central `useKannaState` hook, socket bring-up, global keybinding listeners, and persistent layout chrome (sidebar + page outlet). Non-goals: feature-specific rendering, transcript composition, or business logic.

**Chat slice lifecycle.** `useKannaState` refcounts chat subscriptions in a module-scoped `liveChatSubscriptions` map keyed `${chatId}:${chatResyncNonce}`, so one chat may hold several keys at once and several tabs may share one key. Tearing down the LAST subscription for a CHAT — not for a key — is the moment its `chatStateStore` slice (snapshot + transcript + history cursor) becomes provably unreachable, and is where `releaseChat` is called. Without it the slice outlives every tab that showed the chat: tabs stay mounted behind the pane retention cap, and when one is finally unmounted only the socket subscription was torn down (measured heap 129 → 212 MB across ~30 switches, never recovering; now 99–139 MB, reclaimed). Two weaker signals are wrong and must not be substituted: tab unmount, because two tabs can show one chatId (that is why the refcount exists); and subscription-key teardown, because a resync releases the old nonce key and acquires the new one inside ONE commit, so a key-scoped release wipes a chat that never left the screen and forces a refetch. The release is therefore chat-scoped and deferred by one microtask, by which time a resync's replacement subscription is registered. The key → chatId split takes the LAST colon, since chat ids may contain one. Trade-off: a tab the retention cap has unmounted refetches its transcript when revisited.

**One subscription means one snapshot, so nothing may reset the slice of a chat being entered.** The scrollback cursor (`history.olderCursor`) reaches the client on exactly one event — the chat snapshot, through `adoptServerHistory` — and the refcount hands that snapshot only to the consumer that CREATED the subscription. Every later `useKannaState` for the same chat (the route-level hook in App.tsx, plus one per ChatTabRoot) joins a live subscription and is never called back, so any write it makes on mount is the last word on the slice and there is no second snapshot to repair it. An effect that cleared the incoming chat's scrollback state used to sit here: it was correct when this state was GLOBAL (one chat at a time), and became destructive once #624 mapped it onto per-chat slices. Measured on a cold load, the adopt wrote a cursor at t+111ms and the second consumer's reset wiped it at t+788ms, after which `loadOlderHistory` early-returned forever — scrolling to the top showed no loader and fetched nothing. A chat never opened already reads as the empty slice, so entering one has nothing to clear.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | Browser DOM ready and auth cookie or anonymous mode resolved | c3-203 |
| Input — socket | Single socketClient instance opened at mount | c3-101 |
| Input — stores | Preference + layout stores hydrated from localStorage | c3-102 |
| Input — primitives | UI primitives composed throughout chrome | c3-103 |
| Internal state | useKannaState hook holds projections from snapshot pushes | c3-110 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | Every feature page sees a hydrated, route-aware app shell | c3-1 |
| Primary path | Boot → connect socket → subscribe → render <Routes> | ref-ws-subscription |
| Alternate — auth required | Render login overlay until cookie present | c3-203 |
| Alternate — disconnected | Show degraded banner; route still mounts | c3-101 |
| Failure — snapshot decode error | Log and surface error toast; keep last good state | ref-cqrs-read-models |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-ws-subscription | ref | How shell opens + threads snapshots | must follow | Single socket per session |
| ref-cqrs-read-models | ref | Consume derived projections, never raw events | must follow | No event-log access on client |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| Mounted <Routes> | OUT | Provides routes for chat-page, settings, projects | c3-112, c3-116, c3-117 | src/client/app/App.tsx |
| useKannaState() hook | OUT | Returns snapshot-derived view models | c3-112, c3-115 | src/client/app/useKannaState.ts |
| Global keybinding handlers | OUT | Dispatches commands like number-jump, toggle terminal | c3-111, c3-118 | src/client/hooks |
| Viewport measurement | OUT | Mounts the single window-resize subscription and owns BREAKPOINT_MD, the one responsive pivot | c3-102, c3-111, c3-112 | src/client/lib/viewport.ts |
| Sidebar swipe gesture | OUT | Window-level swipes open and close the sidebar below BREAKPOINT_MD, except when the gesture starts inside a surface marked data-swipe-scroll-x — that surface owns its own horizontal scroll, and it advertises the attribute only while it overflows | c3-104 | src/client/app/sidebarSwipeGesture.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Snapshot/projection desync | Hook subscribing to wrong topic | Stale page after server change | bun run test src/client/app/useKannaState.test.ts and manual chat smoke |
| Route regression | Router config edit drops route | 404 on previously-working URL | Manual nav across /chat, /settings, /projects |
| Global keybinding leak | Event listener not cleaned up | Listener fires after unmount | Component unmount test in chatFocusPolicy.test.ts |
| Scrollback permanently dead | Any mount-time write that clears a chat slice field only adoptServerHistory sets | Scrolling a long chat to the top shows no loader and loads no older messages | bun run test src/client/app/useKannaState.scrollback.test.tsx |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/client/app/App.tsx | c3-110 Contract | Layout chrome detail | src/client/app/App.tsx |
| src/client/app/useKannaState.ts | c3-110 Contract | Memoization detail | src/client/app/useKannaState.ts |
| src/client/hooks/** | c3-110 Contract | Hook composition allowed | src/client/hooks |
