---
id: c3-232
c3-seal: 58f5efe5cfbe6712f5cc8b14932789d0b9bb7005ce1e46dff8bbd0ab702b7c13
title: boards
type: component
category: feature
parent: c3-2
goal: Persist boards, project them to subscribers, turn a card into an isolated worktree-branch-chat, reconcile a bound tracker, and expose the board to the agent as a work queue.
uses:
    - ref-cqrs-read-models
    - ref-local-first-data
    - ref-side-effect-adapter
    - ref-strong-typing
    - rule-colocated-bun-test
    - rule-mcp-name-reserved
---

## Goal

Persist boards, project them to subscribers, turn a card into an isolated worktree-branch-chat, reconcile a bound tracker, and expose the board to the agent as a work queue.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-2 (server) |
| Parent Goal Slice | "Own durable state and project it to the client" |
| Category | feature |
| Lifecycle | Long-lived registry over a SQLite file, opened at boot and closed at shutdown |
| Replaceability | Replaceable behind the BoardRegistry interface; the store adapter is the only module that may touch the database |

## Purpose

Owns board persistence (`board-store.ts` port + `board-store.adapter.ts` over `bun:sqlite`), the change-notifying registry the read model subscribes to, the built-in templates, the "Start work" sequencer, the worktree-cleanup resolver, the tracker sync engine and its pure reconcile, the `board.*` WS command surface, and the five `mcp__kanna__*` board tools. Non-goals: rendering, deciding what a column MEANS (that is the shared domain's `ColumnSemantic`), and pushing an agent-origin change to a tracker that has not opted in.

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-side-effect-adapter | ref | Only board-store.adapter.ts imports bun:sqlite; every other module takes its IO injected | must follow | The whole engine runs against a fake provider and an in-memory database |
| ref-local-first-data | ref | Boards live in a local SQLite file at ~/.kanna/data/boards.db, not in the event log | must follow | The one carve-out from event sourcing — see adr-20260810-boards-sqlite-store |
| ref-cqrs-read-models | ref | Writes notify; the read model derives the snapshot and the broadcaster pushes it | must follow | A write never formats a payload |
| ref-strong-typing | ref | Stored JSON is decoded through the shared decoders, never cast | must follow | Board rows outlive the schema that wrote them |
| rule-mcp-name-reserved | rule | The board tools register under the reserved kanna MCP name | wired compliance target beats uncited local prose | mcp__kanna__board_list and siblings |
| rule-colocated-bun-test | rule | Every module here carries a sibling .test.ts | wired compliance target beats uncited local prose | bun test --conditions production src/server/board- |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| BoardRegistry | IN/OUT | Reads (listBoards / boardView / cardPage / cardDetail / findCardsByLink / listBindings / repoBindingOwner) and writes (board, column, card, link, comment, template, bind and unbind); every write notifies subscribers; bindSync refuses a repo another board holds unless detachFromBoardId names that board, re-checked against the live owner so a stale screen cannot detach a board the user never saw | c3-207 | src/server/board-registry.ts |
| SQLite store | OUT | Append-only migrations gated on PRAGMA user_version; listColumns orders by rank | c3-232 | src/server/board-store.adapter.ts |
| board.* WS commands | IN | board.create / update / duplicate / saveAsTemplate / archive, board.column.*, board.card.create / move / archive / comment / update, board.cards.page, board.templates.list | c3-208 | src/server/ws-router-boards.ts |
| Start work | IN/OUT | One card becomes one worktree, one branch, one chat; idempotent — a live chat is reused, a surviving worktree is reattached | c3-210 | src/server/board-start-work.ts |
| Worktree cleanup | IN/OUT | On done, offers merge / discard / leave; discard refuses while the worktree is dirty and says what would be lost | c3-215 | src/server/board-worktree-cleanup.ts |
| Tracker sync | IN/OUT | One board holds one binding per repo and a repo binds to one board; pull and push loop over listBindings, each binding reconciling per field watermark against its own cursor, and a failing binding is reported on BindingPullResult rather than stopping the others; a created card is stamped with its binding's projectId, which on a Stack board is the only thing that can tell Start work which checkout the issue came from; an agent-origin change is held with heldReason: "agent_push_disabled" unless the binding allows it | c3-232 | src/server/board-sync.ts |
| Agent board tools | OUT | board_list, board_get, card_move, card_create, card_comment — every id resolved against the chat's project, writes attributed {kind:"agent", chatId} | c3-226 | src/server/kanna-mcp-boards.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/server/board-*.ts | c3-232 Contract | Internal helper shape | src/server/board-registry.ts |
| src/server/kanna-mcp-boards.ts | c3-232 Contract | Tool description wording | src/server/kanna-mcp-boards.ts |
| src/server/ws-router-boards.ts | c3-232 Contract | Envelope plumbing | src/server/ws-router-boards.ts |

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | A resolved data directory; the board database is opened and migrated at boot | c3-204 |
| Input — client | board.* commands arrive through the WS router envelope | c3-208 |
| Input — agent | Board tools arrive through the kanna-mcp host with a chatId and projectId | c3-226 |
| Input — tracker | A bound provider is polled; the pure reconcile decides who wins | c3-3 |
| Internal state | One SQLite connection plus an in-memory subscriber set and a bounded conflict queue | c3-232 |
| Initialization | Registry constructed once in server bootstrap and handed to the router, the read model, and the MCP host | c3-201 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | A user's board is durable, live for every viewer, and actionable by an agent without leaving the chat | c3-1 |
| Primary path | Command → registry write → notify → read model derives → broadcaster pushes the board topic | c3-207 |
| Alternate — start work | Card → worktree + branch + chat with the worktree as cwd → card moves to the active column → seeded prompt names the card's next column | c3-210 |
| Alternate — sync | Pull remote items → reconcile against field watermarks → apply locally, queue pushes, record conflicts | c3-232 |
| Alternate — agent | An agent reads a bounded window of its project's board and advances its own card | c3-226 |
| Failure — dirty worktree | discard is refused with the file count rather than destroying uncommitted work | c3-215 |
| Failure — agent push | An agent-origin change is held rather than closing a real issue on a tracker | c3-232 |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Migration break | A migration is edited in place rather than appended | A newer user_version than the build understands throws at open | bun test --conditions production src/server/board-store.adapter.test.ts |
| Cross-project reach | A board tool stops resolving an id against the chat's project | An agent moves a card on another project's board | bun test --conditions production src/server/kanna-mcp-boards.test.ts |
| Silent tracker close | Agent attribution dropped from a write path | A card an agent moved closes a real issue | bun test --conditions production src/server/board-sync.test.ts |
| Worktree loss | Cleanup performs instead of asking, or discard stops checking dirtiness | Uncommitted work disappears on a column drag | bun test --conditions production src/server/board-worktree-cleanup.test.ts |
| Orphaned chain | Start work creates a chat before linking the worktree | A crash leaves a card pointing at nothing | bun test --conditions production src/server/board-start-work.test.ts |
