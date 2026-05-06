---
id: c3-110
c3-version: 4
c3-seal: 94e1e94d1fec5ece2405ba51a402e28297fd2598709f26ca3a44f7a905d36c86
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

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Snapshot/projection desync | Hook subscribing to wrong topic | Stale page after server change | bun run test src/client/app/useKannaState.test.ts and manual chat smoke |
| Route regression | Router config edit drops route | 404 on previously-working URL | Manual nav across /chat, /settings, /projects |
| Global keybinding leak | Event listener not cleaned up | Listener fires after unmount | Component unmount test in chatFocusPolicy.test.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/client/app/App.tsx | c3-110 Contract | Layout chrome detail | src/client/app/App.tsx |
| src/client/app/useKannaState.ts | c3-110 Contract | Memoization detail | src/client/app/useKannaState.ts |
| src/client/hooks/** | c3-110 Contract | Hook composition allowed | src/client/hooks |
