---
id: c3-111
c3-version: 4
c3-seal: ef4c635e719798d0857509036331c20f2de761750f54462e4d7ca3865e35b9a0
title: sidebar
type: component
category: feature
parent: c3-1
goal: 'Render the project-first sidebar: grouped chats, live status dots, drag-to-reorder project groups, number-key jumps.'
uses:
    - ref-cqrs-read-models
    - ref-zustand-store
    - rule-zustand-store
---

# sidebar

## Goal

Render the project-first sidebar: grouped chats, live status dots, drag-to-reorder project groups, number-key jumps.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-1 (client) |
| Parent Goal Slice | "Render hydrated transcripts… Accept user input… drag-to-reorder projects" |
| Category | feature |
| Lifecycle | Mounts inside app-shell; persists across route changes |
| Replaceability | Replaceable provided sidebar projection contract preserved |

## Purpose

Renders the project-first navigation: project groups with their chats, live agent status dots, drag-to-reorder, number-key shortcuts to jump chats. Non-goals: chat content, project creation flow, agent control.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | App-shell mounted and socket subscribed | c3-110 |
| Input — sidebar projection | Server sidebarView snapshot streamed over WS | c3-207 |
| Input — sidebar store | Local order + collapsed-group state | c3-102 |
| Input — primitives | Buttons, popover, scroll-area | c3-103 |
| Internal state | Drag in-progress flag, last-jumped index | c3-111 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | User can navigate or reorder projects without leaving the sidebar | c3-1 |
| Primary path | Render projection → click chat → route push | ref-cqrs-read-models |
| Alternate — drag reorder | dnd-kit reorder → persist via store → emit project.reorder command | ref-zustand-store |
| Alternate — number jump | Number key handler maps to nth chat, focuses route | c3-111 |
| Failure — empty projection | Show "no projects" placeholder; still allow add | c3-117 |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-cqrs-read-models | ref | Read sidebarView projection, never raw events | must follow | Server owns derivation |
| ref-zustand-store | ref | Persist drag-order locally with persist middleware | must follow | One sidebar store |
| rule-zustand-store | rule | Compliance target added by c3x wire; refine what must be reviewed or complied with before handoff. | wired compliance target beats uncited local prose | Added by c3x wire for explicit compliance review. |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| Mounted sidebar tree | OUT | Renders projects + chats; click navigates | c3-110 | src/client/app/KannaSidebar.tsx |
| Drag-end command | OUT | project.reorder envelope | c3-208 | src/client/app/sidebarNumberJump.ts |
| Number-jump callback | IN/OUT | App-shell wires global key listeners | c3-110 | src/client/app/sidebarNumberJump.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Reorder desync | Local persisted order differs from server | Sidebar items appear out of order on cold load | bun run test src/client/app/sidebarNumberJump.test.ts plus manual reorder smoke |
| Drag breaking accessibility | dnd-kit upgrade | Keyboard reorder fails | bun run check + keyboard nav smoke on src/client/app/sidebarNumberJump.ts |
| Stored width lost to the clamp | Viewport clamp written back to storage instead of only to the rendered width | Sidebar never returns to the user's chosen width after the window widens | bun run test src/client/stores/kannaSidebarStore.test.ts + widen-window smoke |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/client/app/KannaSidebar.tsx | c3-111 Contract | Layout/skin detail | src/client/app/KannaSidebar.tsx |
| src/client/app/sidebarNumberJump.ts | c3-111 Contract | Key map detail | src/client/app/sidebarNumberJump.ts |
