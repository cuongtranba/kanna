---
id: c3-118
c3-version: 4
c3-seal: ae80c9943ef2f3236c67075f626fe562f51944e9360398c8378cd2bbced01400
title: terminal-workspace
type: component
category: feature
parent: c3-1
goal: Host the embedded xterm terminal panel with layout animation + resize + preference persistence.
uses:
    - ref-ws-subscription
    - ref-zustand-store
    - rule-zustand-store
---

# terminal-workspace

## Goal

Host the embedded xterm terminal panel with layout animation + resize + preference persistence.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-1 (client) |
| Parent Goal Slice | "Accept user input: … terminal keystrokes" |
| Category | feature |
| Lifecycle | Mounts inside chat-page when terminal panel is enabled |
| Replaceability | Replaceable provided PTY stream contract preserved |

## Purpose

Hosts the embedded xterm.js panel inside chat-page: bidirectional PTY streaming, layout animation, resizable splitter, preference persistence. Non-goals: server-side PTY allocation, agent integration, scrollback persistence.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | Chat-page mounted; user toggles terminal on | c3-112 |
| Input — terminal layout store | Sizes, last-open state | c3-102 |
| Input — primitives | Splitter, kbd | c3-103 |
| Input — server terminal manager | PTY stream over WS | c3-216 |
| Internal state | xterm instance, resize observer, animation state | c3-118 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | User runs a shell next to the agent without leaving the chat page | c3-1 |
| Primary path | Toggle on → request PTY → stream stdin/stdout via WS | ref-ws-subscription |
| Alternate — resize | User drags splitter → resize PTY rows/cols | c3-216 |
| Alternate — persist layout | Layout sizes persisted via store | ref-zustand-store |
| Failure — PTY drop | Show "terminal disconnected"; offer retry | c3-216 |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-ws-subscription | ref | Stream PTY over single WS | must follow | No separate connection |
| ref-zustand-store | ref | Persist layout via store | must follow | One terminal store |
| rule-zustand-store | rule | Compliance target added by c3x wire; refine what must be reviewed or complied with before handoff. | wired compliance target beats uncited local prose | Added by c3x wire for explicit compliance review. |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| <TerminalWorkspaceShell> | OUT | Renders xterm + splitter | c3-112 | src/client/app/ChatPage/TerminalWorkspaceShell.tsx |
| Resize callback | OUT | Reports rows/cols to server | c3-216 | src/client/app/terminalLayoutResize.ts |
| Toggle animation | IN/OUT | Driven by chat-page hook | c3-112 | src/client/app/terminalToggleAnimation.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Resize drift | Resize observer + xterm fit mismatch | Wrapping or ghost cursor | bun run test src/client/app/terminalLayoutResize.test.ts |
| Animation jank on toggle | Timing edit | Visible flash | bun run test src/client/app/terminalToggleAnimation.test.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/client/app/ChatPage/TerminalWorkspaceShell.tsx | c3-118 Contract | Layout detail | src/client/app/ChatPage/TerminalWorkspaceShell.tsx |
| src/client/app/terminalLayoutResize.ts | c3-118 Contract | Resize math detail | src/client/app/terminalLayoutResize.ts |
| src/client/app/terminalToggleAnimation.ts | c3-118 Contract | Animation timing detail | src/client/app/terminalToggleAnimation.ts |
