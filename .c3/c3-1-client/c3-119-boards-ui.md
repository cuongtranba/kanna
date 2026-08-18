---
id: c3-119
c3-seal: 70944dc0394dd3456282d51c827e05e2ff4ee486eb692f12eb42031bf7335bbf
title: boards-ui
type: component
category: feature
parent: c3-1
goal: Render a project's boards as a live workspace tab — drag cards, edit a card in a drawer, edit the card schema, drive a sync binding, and start work on a card.
uses:
    - ref-strong-typing
    - ref-ws-subscription
    - ref-zustand-store
    - rule-colocated-bun-test
    - rule-zustand-store
---

## Goal

Render a project's boards as a live workspace tab — drag cards, edit a card in a drawer, edit the card schema, drive a sync binding, and start work on a card.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-1 (client) |
| Parent Goal Slice | "Own the browser-side state surface and stay synchronized with server state" |
| Category | feature |
| Lifecycle | Mounted per open board tab; subscribes on mount, unsubscribes on close |
| Replaceability | Replaceable provided the board topic subscription and the board.* command names are preserved |

## Purpose

Owns the board surface: `BoardsPage` and `BoardPane`, the `KannaBoard` renderer that drives pragmatic drag-and-drop directly, the card drawer, the column settings, the card-schema panel, the sync panel, and the pure client helpers that turn a drop into a move and apply it optimistically. It renders whatever the server last sent and never becomes a second source of truth: a drag applies locally so the card lands under the cursor, and the next snapshot replaces it — which is also how a rejected move self-corrects. Non-goals: persistence, rank arithmetic (the shared domain owns it), and computing an insertion index (the server resolves a rank from neighbours).

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-ws-subscription | ref | The board topic is subscribed on mount and released on unmount; the snapshot is the authority | must follow | A rejected move self-corrects on the next push |
| ref-zustand-store | ref | Board state transitions live in stores, not in JSX attributes | must follow | BoardPane.store, BoardDrag.store, CardDrawer.store, boardsStore |
| rule-zustand-store | rule | Compliance target for board store transitions | wired compliance target beats uncited local prose | bun run lint:usestate and bunx ast-grep test |
| ref-strong-typing | ref | Snapshots are typed from the shared protocol, never widened to any | must follow | Board payloads decode through the shared decoders |
| rule-colocated-bun-test | rule | Every board component and helper carries a sibling test | wired compliance target beats uncited local prose | KannaBoard, CardDrawer, ColumnSettings, dnd, optimistic |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| Board tab | OUT | /boards/:projectId/:boardId and /boards/stack/:stackId/:boardId both mount the same route-neutral workspace page a chat does and open a board tab | c3-112 | src/client/app/BoardsRoutePage.tsx, src/client/app/StackBoardsRoutePage.tsx |
| Board topic subscription | IN | Subscribes to the board topic and renders the last snapshot received | c3-101 | src/client/components/boards/BoardPane.tsx |
| board.* commands | OUT | Emits board / column / card commands; never mutates server state locally except optimistically | c3-208 | src/client/components/boards/BoardPane.tsx |
| Drag translation | OUT | dnd.ts resolves a drop edge to NEIGHBOURS, never to an index | c3-310 | src/client/lib/boards/dnd.ts |
| Optimistic apply | OUT | moveCardInView / moveColumnInView apply to Kanna's own snapshot shape, replaced by the next server push | c3-310 | src/client/lib/boards/optimistic.ts |
| Card drawer | IN/OUT | Renders the card's fields from the board's own schema, its links, its start-work status, and its cleanup question | c3-232 | src/client/components/boards/CardDrawer.tsx |
| Sync panel | IN/OUT | Binds a board to a tracker, shows held and conflicted rows, and triggers a pull | c3-232 | src/client/components/boards/BoardSyncPanel.tsx |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/client/components/boards/*.tsx | c3-119 Contract | Presentation detail | src/client/components/boards/BoardPane.tsx |
| src/client/lib/boards/*.ts | c3-119 Contract | Helper shape | src/client/lib/boards/dnd.ts |
| src/client/stores/boardsStore.ts | c3-119 Contract | Selector shape, provided references stay stable | src/client/stores/boardsStore.ts |

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | An open socket and a project the user can see | c3-101 |
| Input — snapshot | The board topic pushes columns, a bounded card page per column, counts, and sync state | c3-208 |
| Input — pointer | Pragmatic drag-and-drop reports a target element and its closest edge | c3-119 |
| Internal state | Zustand stores for board view, drag, drawer, schema draft, and sync panel | c3-102 |
| Initialization | Subscribe on mount, request the first card page, release on tab close | c3-104 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | The board is a workspace tab beside the chats it starts, not a separate app | c3-112 |
| Primary path | Drag → resolve neighbours → apply optimistically → send the move → server snapshot replaces it | c3-232 |
| Alternate — start work | The drawer's one button reads Start work / Resume / Open chat from the server-derived status | c3-310 |
| Alternate — paging | A column beyond its first page requests more rather than rendering everything | c3-208 |
| Failure — rejected move | The server's next snapshot restores the card's real position; nothing is retried locally | c3-119 |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Render loop | A board selector returns a fresh array or object reference each call | React error #185 in the console | bun run lint:usestate and bunx ast-grep test |
| Unmounted root leak | A board test mounts a portal-opening component without unmounting its root | The preload sweep fails the test that leaked | bun test --conditions production src/client/components/boards/CardDrawer.test.tsx |
| Second source of truth | Optimistic state stops being replaced by the server snapshot | A rejected move sticks on screen | bun test --conditions production src/client/lib/boards/optimistic.test.ts |
| Index-based ordering | A drop starts computing an insertion index instead of neighbours | Two concurrent drags disagree on order | bun test --conditions production src/client/lib/boards/dnd.test.ts |
