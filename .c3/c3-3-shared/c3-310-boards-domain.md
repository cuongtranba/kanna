---
id: c3-310
c3-seal: 9d33004b8013ea999a42a67bd2197040421288190a646975bee3e8923e90adde
title: boards-domain
type: component
category: feature
parent: c3-3
goal: Define the board domain — boards, columns, cards, fields, ranks — and the pure decisions about it that the server and the client must not be able to disagree on.
uses:
    - ref-colocated-bun-test
    - ref-strong-typing
    - rule-colocated-bun-test
    - rule-strong-typing
---

## Goal

Define the board domain — boards, columns, cards, fields, ranks — and the pure decisions about it that the server and the client must not be able to disagree on.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-3 (shared) |
| Parent Goal Slice | "Define the typed surface shared between client and server" |
| Category | feature |
| Lifecycle | Pure modules — types, guards, decoders, and total functions; no IO |
| Replaceability | Replaceable provided exported names, field ids, and ColumnSemantic values are preserved |

## Purpose

Owns the board vocabulary (`Board`, `BoardColumn`, `Card`, `FieldDef`, `FieldValue`, `CardActor`, `CardLink`), the fractional rank algebra that orders columns and cards, the wire decoders, the card schema notes, and every routing decision keyed off `ColumnSemantic`. It owns these because both sides ask the same questions of them: the sync engine and the sync screen must route a card identically, and the card drawer and the server must derive the same "Start work" label. Non-goals: persistence, network, React, and any knowledge of which tracker a board is bound to.

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-strong-typing | ref | Every board shape is an explicit discriminated union; decoders return typed values, never any | must follow | FieldValue is a tagged union; a decoder narrows, it never asserts |
| rule-strong-typing | rule | Compliance target for the board wire types | wired compliance target beats uncited local prose | Stored JSON is decoded, not cast — see adr-20260810-boards-sqlite-store |
| ref-colocated-bun-test | ref | Every pure module here carries a sibling .test.ts | must follow | rank, decode, start-work, worktree-cleanup, cardSchema, repo-slug all colocate |
| rule-colocated-bun-test | rule | Compliance target for colocated tests | wired compliance target beats uncited local prose | bun test --conditions production src/shared/boards/ |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| Domain types | OUT | Board / BoardColumn / Card / CardLink / CardActor / FieldDef / FieldValue / SyncBinding shapes | c3-2 | src/shared/boards/types.ts |
| ColumnSemantic routing | OUT | findActiveColumn, findStartColumn, findDoneColumn, columnForRemoteState, remoteStateOfColumn — the ONLY mapping between tracker state and a user's columns | c3-2 | src/shared/boards/types.ts |
| Rank algebra | OUT | Fractional indexing for column and card order; a move names neighbours, never an index | c3-1 | src/shared/boards/rank.ts |
| Wire decoders | OUT | decodeContentForFields strict on the wire, lenient over stored rows; decodeFieldDefsForWrite | c3-2 | src/shared/boards/decode.ts |
| Start-work decisions | OUT | deriveStartWorkStatus, startWorkLabel, resolveStartWorkProjectId, findAdvanceColumn, buildStartWorkPrompt | c3-2 | src/shared/boards/start-work.ts |
| Cleanup decision | OUT | pendingCleanupWorktree — derived from a card sitting in done with a live worktree, never from a move event | c3-2 | src/shared/boards/worktree-cleanup.ts |
| Card schema notes | OUT | LOAD_BEARING_FIELD_NOTES — which field ids the start-work prompt reads by name | c3-1 | src/shared/boards/cardSchema.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/shared/boards/*.ts | c3-310 Contract | Internal helper shape | src/shared/boards/types.ts |
| src/server/board-*.ts routing calls | c3-310 Contract | Call site only — no local semantic table | src/server/board-sync.ts |
| src/client/lib/boards/*.ts | c3-310 Contract | Optimistic-apply ordering | src/client/lib/boards/optimistic.ts |

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | TypeScript strict mode; side-effect seal forbids IO in src/shared/** | c3-3 |
| Input — wire | Board payloads decoded from the WS snapshot before use | c3-302 |
| Input — storage | Stored JSON rows decoded leniently so an older row still loads | c3-2 |
| Internal state | None — every export is a pure function or a type | c3-310 |
| Initialization | Imported on demand by both containers; no module-level work | c3-310 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | A column's meaning, a card's order, and a card's next step read the same on both sides of the wire | c3-1 |
| Primary path | Server persists → decodes → projects a snapshot → client renders and reorders by the same rank algebra | c3-2 |
| Alternate — sync | The sync engine routes an incoming item through columnForRemoteState, the same function the sync screen shows | c3-2 |
| Alternate — start work | Server derives the card's status and prompt here, so the drawer's button label and the server's action cannot disagree | c3-2 |
| Failure — unknown semantic | A board that marks no column simply does not move cards; nothing guesses a column from its title | c3-310 |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Routing split-brain | A caller reimplements a semantic lookup locally instead of calling the finder | Review; a second semantic === "done" comparison outside this module | grep -rn 'semantic ===' src/ and bun run test |
| Prompt field drift | A card field the start-work prompt reads by name is deleted from a board schema | cardSchema.test.ts probes every id the prompt reads | bun test --conditions production src/shared/boards/cardSchema.test.ts |
| Rank collision | Two concurrent moves derive the same fractional key | Column or card order flickers after a drag | bun test --conditions production src/shared/boards/rank.test.ts |
| Decoder strictness inversion | Wire decoding relaxed to match storage leniency | A malformed client payload reaches the store | bun test --conditions production src/shared/boards/decode.test.ts |
