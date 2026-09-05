---
id: adr-20260811-board-in-the-workspace
c3-seal: 837b0f5e219398311e9bf1d772f9f8afb695fa47464b576d0d6b30ace3f5046c
title: board-in-the-workspace
type: adr
goal: |-
    Stop treating a board as a destination and make it a surface the user keeps
    open. `/boards/:projectId/:boardId` now mounts the SAME page `/chat/:chatId`
    mounts and opens the board as a tab, so moving between a board and the chat
    working one of its cards is a tab click instead of a round trip through the
    sidebar. The page that does this is no longer the chat page: it is route-neutral,
    exported as `WorkspacePage`, renders on whether the workspace has tabs rather
    than on whether a chat exists, and titles every open tab from every project's
    snapshots rather than the active project's.
status: done
date: "2026-08-11"
---

# A board in the workspace, rendering its own schema

## Goal

Stop treating a board as a destination and make it a surface the user keeps
open. `/boards/:projectId/:boardId` now mounts the SAME page `/chat/:chatId`
mounts and opens the board as a tab, so moving between a board and the chat
working one of its cards is a tab click instead of a round trip through the
sidebar. The page that does this is no longer the chat page: it is route-neutral,
exported as `WorkspacePage`, renders on whether the workspace has tabs rather
than on whether a chat exists, and titles every open tab from every project's
snapshots rather than the active project's.

A board only earns that permanence if its cards are worth looking at while it
sits open, so the same unit makes a card face carry its linked chat's LIVE
status from the shared indicator table the sidebar and the tab strip already
use, and makes a card's fields come from the board's own `cardFields` schema —
which the board's owner can now edit — instead of a hardcoded Labels / Assignee
/ Source list.

## Context

Boards shipped as their own route. `BoardsRoutePage` rendered both the list and
a single board; `BoardPane` took `onBack`, `onOpenBesideChat` and
`besideChatStartsChat` so the page could offer a way back out and a way to
smuggle the board into the workspace. `openTab({kind: "board"})` already
existed, but only that smuggle path reached it, so the arrangement a user had
built was not the arrangement a board opened into.

The tab strip already knew how to draw a board tab: it reads
`TabPresentationContext.boardTitles`, and nothing ever populated it, so every
board tab read the literal fallback "Board". The cause is structural rather than
an oversight. The workspace is ONE tree shared by every project
(adr-20260808-collapse-pane-layout-to-one-workspace), so a tab opened in project
A stays open while the user works in project B — a title derived from the active
project's snapshots renames that tab to its fallback the moment the user moves.
Landing straight on `/boards/:projectId/:boardId` is worse again: a refresh or a
bookmark subscribes to that ONE board and never to the project's board list, so
the list alone cannot title the tab either.

Card content had its own version of the same gap. A board carries a `cardFields`
schema, but the drawer rendered a fixed Labels / Assignee / Source list, so a
field the board declared was invisible and a field it did not declare was shown
anyway. `board.card.update` had no way to carry field content at all, and the
schema itself was only reachable through a template at creation time.

The constraint that shapes the rest of this decision is that a board's field
schema has TWO kinds of reader with opposite needs. Storage is history: a row
written by an older build, or written by the GitHub sync engine onto a board
that never declared `description`, must stay readable. A write arriving on the
wire is an instruction: quietly dropping the one field it could not read would
ack an edit that never landed. `decodeCardContent` and `validateCardContent`
were both written for the first reader and were the only gates available to the
second.

Affected topology: the workspace route (c3-112) is the only fact whose contract
this unit rewrites; the pane tree (c3-104) receives the board tab through
machinery it already has, the WS router (c3-208) gains two command fields, and
the protocol (c3-302) carries them.

## Decision

**One workspace, two addresses.** `ChatPage` is renamed `WorkspacePage` and
made route-neutral: it reads an optional `boardId` route param, opens
`{kind: "board", boardId}` when present, and gates its own render on
`workspaceHasTabs` rather than on a resolved chat. Both routes therefore mount
one page and differ only in which tab they open, and `BoardPane` sheds `onBack`,
`onOpenBesideChat` and `besideChatStartsChat` — a tab needs no way back, because
the thing it came from is still open beside it. In its place the pane grows a
`Boards /` breadcrumb, gated on the board being project-owned — a stack-owned
board shows none rather than a link that would have to pick one of the stack's
projects. `BoardsRoutePage` keeps only the list, which answers "what boards does
this project have" and is genuinely not a workspace question; its
chat-manufacturing path (`handleOpenBesideChat` calling `handleCreateChat` when
the project had none) goes with it, because a workspace that renders on tabs no
longer needs a chat conjured to have somewhere to put the board.

**A tab is titled from the whole workspace, not the current view.**
`buildTabPresentationContext` (`ChatPage/tabPresentationContext.ts`) is a pure
function over the live snapshots, flattening starred and unstarred project
groups and every chat bucket, so a tab keeps its title after the user changes
projects. Board titles are read from the OPEN board views as well as the
project's board list, and the list is written second so a rename that has
reached the list wins over the view's older copy. Extracting it as a pure module
is what makes the failure testable at all — the bug was invisible because the
context was assembled inline in a component.

**Strict on the wire, lenient out of storage — two decoders, on purpose.**
`decodeContentForFields` and `decodeFieldDefsForWrite` (`shared/boards/decode.ts`)
are the strict counterparts of `decodeCardContent` and `decodeFieldDefs`. They
refuse the WHOLE patch rather than dropping the part they cannot read, and
because they are handed the board's schema they can check a value against its
DEFINITION and not merely against itself — `FieldValue` is discriminated by the
same names as `FieldKind` precisely so `value.kind !== field.kind` is a question
that can be asked. The strict schema decoder additionally refuses a duplicate
field id (card content is keyed by field id, so two fields would fight over one
value forever), a duplicate option id within a field, and a colour outside
`COLUMN_COLOR_TOKENS` — the palette is closed because a stored hex is correct in
exactly one of the two themes.

**The store's gate reports contradictions only.** `validateCardContent` runs
under `createCard` / `updateCard`, so it stands under the sync engine and the
board MCP tools, not just the drawer. It was narrowed to report only values that
contradict their field — wrong kind, an option the board does not offer, a
number that is not one, a date that is not epoch milliseconds — because each of
those already reads as unset and would be dropped by the next write. It stopped
reporting an undeclared field id, because a schema is edited under content
already written and an orphaned value is kept on purpose so re-adding the field
restores it; refusing there would also turn every GitHub pull into a hard
failure on any board created without a template. It stopped enforcing
`required`, because a patch names only the fields it changes, so completeness is
not knowable at that point — and `required` marks a field in this product, it
never refuses a save. The wire decoder CAN afford to refuse an undeclared id,
because the drawer that sends to it renders exactly this schema.

**Removing a load-bearing field warns and is allowed.**
`LOAD_BEARING_FIELD_NOTES` (`shared/boards/cardSchema.ts`) names the five field
ids the rest of Kanna reads by name — the ones GitHub sync and the start-work
prompt builder map onto. The schema editor says what stops working at the point
of removal and permits it, matching how every other soft constraint in boards
behaves (an unmapped sync column warns, a WIP limit is advisory). Blocking would
make the product's conventions unremovable from a board that has neither a
tracker nor an agent.

**Linked-chat status is derived per read and scoped to the page.**
`BoardViewSnapshot.chatLinksByCard` is built in `boardView` from one
`listCardLinksForBoard` query rather than one read per card, and carries only
cards actually shipped in the page — a 5000-card board must not pay for the
links of the 4970 cards it left behind. Cards with no chat are omitted rather
than carrying an empty array. The card face and drawer then render through the
SHARED `chatStatusIndicator` table, so a chat cannot read "Running" in the
sidebar and plain on its card. This swaps what the card's status row means:
it read `card.updatedBy.kind === "agent"` and showed a static "Agent", which is
ATTRIBUTION — who wrote last — and it now shows whether that chat is running
right now. A card outlives its chats (the reaper deletes chats nobody wrote to),
so a link whose chat is gone is dropped from the signal rather than offered as a
dead button.

**`cardFields` and `content` cross the wire loosely typed and are narrowed
server-side.** Both new command fields are `AnyValue`. The schema they must
satisfy is the board's, which only the server can read; a wire type would be a
second place to state rules the decoders already own, and the two would drift.
Both are whole-value replacements rather than deltas, because the store replaces
rather than merges and a partial map would erase every field it did not name.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-0 | system | N.A - ancestor named for top-down descent | c3-0#n3@v1:sha256:c9f10a833b3e499d1329f9637c65ac8e7c7b9f78b6210e91ff3f44b8d31e38bc | N.A - ancestor named for top-down descent |
| c3-1 | container | N.A - ancestor named for top-down descent; the delta is in c3-112 | c3-1#n7500@v1:sha256:e6ee951578f4d61705ac19fe636ff75594655216f900a12ae302ea0a1d8607a8 | N.A - ancestor named for top-down descent |
| c3-2 | container | N.A - ancestor named for top-down descent; the delta is in c3-208 | c3-2#n8214@v1:sha256:87984e312939cc03eed326c220cafc5c1bc82c40e789678100477a162a4901ce | N.A - ancestor named for top-down descent |
| c3-3 | container | N.A - ancestor named for top-down descent; the delta is in c3-302 | c3-3#n9950@v1:sha256:14758c535c5f7fc755f25004ead7b6d64058321bc3599252e111f640e63dc53e | N.A - ancestor named for top-down descent |
| c3-112 | component | The only fact this unit rewrites. The route component is renamed WorkspacePage, mounts at both /chat/:chatId and /boards/:projectId/:boardId, renders on workspaceHasTabs instead of a resolved chat, and gains the tab-presentation context as a contract surface | c3-112#n7889@v1:sha256:9fbf541a6663e76b20c74a29e86b2b258f12d01c102b9578d71585a9c799b709 | Confirm the page is genuinely route-neutral — that neither route is privileged in the render gate — and that the presentation context reads every project rather than the active one |
| c3-104 | component | Receives the board tab through machinery it already owns: the content registry, target-derived tab identity, and the chatStatusIndicator table its tab strip already imports. No pane-layout contract moves | c3-104#n7693@v1:sha256:a9d4107c7a4aea59659b92cf3141fe1740f7c9602f99911c614123bdcd1f2395 | Confirm no board knowledge leaked into the pane tree — a board tab must stay an ordinary target-addressed tab whose renderer the host supplies |
| c3-110 | component | The route table maps /boards/:projectId/:boardId to the workspace page, and the new pure board modules land under src/client/lib/boards/ which c3-110 owns by glob | c3-110#n7757@v1:sha256:c0e73f886822a6f6cb439f13894c5307ff4b59edf1a1bdfda586a8bd7ab2e9bd | Confirm the board list keeps its own route, so the list is not dragged into the workspace with the board |
| c3-208 | component | board.card.update gains content and board.update gains cardFields; both are decoded strictly at the router before reaching the store | c3-208#n8629@v1:sha256:844f303a1dc89a3fb56db4e575721a405353084678086a7abfeda0736c23c284 | Confirm the router refuses a malformed payload rather than accepting the command and writing a partial patch |
| c3-302 | component | ClientCommand carries the two new fields, and BoardViewSnapshot gains chatLinksByCard | c3-302#n10027@v1:sha256:7b3e2010dde1628e847efb8329ea2f92a4d7328fe8a175ebe8066c07351ce38d | Confirm the loosely-typed payloads are narrowed at exactly one server chokepoint each, so AnyValue never reaches the store |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-ws-subscription | Two existing board commands grow fields and the board snapshot grows a map; all of it rides the one socket | ref-ws-subscription#n10574@v1:sha256:856dbc5b26887801a91ee1acf2a59bd940bd7592ddaa57b46a8689de86dd07cc | comply — no new topic and no new socket; chatLinksByCard rides the existing board snapshot push, and the two command fields ride commands that already exist |
| ref-cqrs-read-models | chatLinksByCard is a derived view, and the workspace page renders only from snapshots | ref-cqrs-read-models#n10338@v1:sha256:768802027896fc8c9ebd415cf63483f64e0c5f2f4bc10f21079a8f7d51c38dcd | comply — the map is computed per read in boardView from card links plus the page it is shipping, so it cannot go stale in storage; nothing about chat liveness is persisted on the card |
| ref-strong-typing | The two new command fields cross the client-server boundary as AnyValue, which is exactly the shape this ref constrains | ref-strong-typing#n10508@v1:sha256:390cd8fee6d22c17530c1b9551d02cbd40ea33c56574b7ebc313f21961a707af | comply — AnyValue is a named shared type, not any, and it is narrowed before use at one chokepoint per field (decodeContentForFields, decodeFieldDefsForWrite), each returning a named CardContent / FieldDef[] or null. The narrowing switch over FieldKind has no default, so a new kind is a compile error until handled |
| ref-zustand-store | The schema editor and the board pane both hold per-instance UI state | ref-zustand-store#n10607@v1:sha256:53e3365a2350860110617c32292965a5051709854e758fc7470752136627d86e | comply — CardSchemaPanel.store.ts and BoardPane.store.ts are colocated scoped stores exposing named intent actions; the draft algebra itself is a pure module (cardSchemaDraft.ts) so the store holds no transition logic |
| ref-colocated-bun-test | Every module added here is client or shared code under the colocated-test convention | ref-colocated-bun-test#n10305@v1:sha256:9490f9305f79ff29d492d099b81c1227c5d277e4a16bf251c1779ddc338f4be8 | comply — all nine new modules carry a sibling *.test.ts(x); see Enforcement Surfaces |
| ref-side-effect-adapter | The new board-wide link query is SQL and must not leak out of the adapter | ref-side-effect-adapter#n10469@v1:sha256:d97da3a35cbbfc743202e4b37a53c5ae837c6f8c802bdd22685991e0bfe439ee | comply — listCardLinksForBoard is declared on the BoardStore port and implemented only in board-store.adapter.ts; board-registry.ts calls the port and imports no database |
| ref-local-first-data | A board's field schema is user data persisted on the machine and now user-editable | ref-local-first-data#n10404@v1:sha256:6b71d8a9c2f48d47b9acda0a867f9936d76727141dc2efbbdfead90101e7fd49 | comply — the schema stays in the existing boards SQLite file under the Kanna data dir; nothing new is written and nothing leaves the machine |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-strong-typing | The strict decoders ARE the boundary narrowing this rule demands, and the wire fields are the thing being narrowed | rule-strong-typing#n10701@v1:sha256:7e110467821b764c655f13db69c1331592e23c71af38ac5825037c97b15ea180 | comply — no any is introduced; decodeValueForField switches exhaustively over FieldKind with no default, so adding a field kind fails to compile until every decoder handles it |
| rule-zustand-store | c3-112 and the board panel both gain client state, and the schema editor is a draft surface with many transitions | rule-zustand-store#n10733@v1:sha256:f4987b0b2521426050c0c2a5307760c102f3ed1e0a9334b074ed1913fe818f64 | comply — named intent actions only, transitions derived inside the store or in the pure draft module; bun run lint:usestate and bunx ast-grep test both pass, which is what would catch an inline updater or an unstable selector |
| rule-colocated-bun-test | c3-112 gains a module, and every other new module sits beside its test | rule-colocated-bun-test#n10640@v1:sha256:ce58e026c1076cb18ede38f3a4bd73793f28bf1392d299399571ba446985623f | comply — tabPresentationContext.test.ts sits beside tabPresentationContext.ts; no \_\_tests\_\_/ directory and no second runner |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| src/client/app/ChatPage/tabPresentationContext.test.ts | Pins the bug this unit fixes: a board tab is titled from an open board VIEW when the project's board list has not loaded, from the list when it has, and the list wins a disagreement; chat and terminal titles survive a project change | 8 tests |
| src/shared/boards/decode.test.ts | Pins the strict-versus-lenient split — that a wire patch naming an undeclared field, a wrong-kind value, an option the board does not offer, a ragged string array, a duplicate field id, a duplicate option id, or an off-palette colour is refused WHOLE, while the storage decoder keeps the rest | 41 tests, 22 added |
| src/client/lib/boards/cardSchemaDraft.test.ts | Pins the draft algebra: add, remove, reorder, retype, and option editing, including that removing a load-bearing field surfaces its note rather than blocking | 20 tests |
| src/client/lib/boards/cardFieldValue.test.ts | Pins per-kind value rendering and editing for every FieldKind, so a new kind cannot render blank | 16 tests |
| src/client/components/boards/CardSchemaPanel.test.tsx | Pins the editor surface: dirty state, discard, save payload shape, and the load-bearing warning | 15 tests |
| src/client/components/boards/CardDrawer.test.tsx | Asserts the drawer walks the board's schema rather than a fixed list, and that a card with a linked chat shows that chat's live status | 33 tests, 21 added |
| src/server/ws-router-boards.test.ts | Asserts a malformed content or cardFields is refused with an error rather than accepted and partially written | 15 tests, 11 added |
| src/server/board-store.adapter.test.ts | Asserts listCardLinksForBoard returns one board's links newest-first in a single query, and that validateCardContent no longer refuses an undeclared field or a missing required one | 58 tests, 12 added |
| src/server/board-registry.test.ts | Asserts chatLinksByCard covers only the cards the page shipped, and omits cards with no link | 16 tests, 2 added |
| src/client/lib/boards/cardChatSignal.test.ts + boardChatFacts.test.ts | Assert the card's status comes from the shared chatStatusIndicator table, so a card and the sidebar cannot disagree | 9 + 4 tests |
| src/shared/boards/cardSchema.test.ts | Checks LOAD_BEARING_FIELD_NOTES against the real start-work prompt builder, so the warning cannot claim a field matters after the prompt stops reading it | 3 tests |
| src/client/components/boards/KannaBoard.test.tsx + BoardPane.store.test.ts | Assert the board renders with no chat facts at all, and that the three panel asides stay mutually exclusive now that the schema panel is a third | 6 + 3 tests |
| src/client/app/BoardsRoutePage.test.tsx | Shrank from 5 tests to 2 with the capability: the four board-rendering and beside-chat cases are deleted, and what remains asserts the list navigates to a board's address and creates nothing | 2 tests |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Keep /boards/:projectId/:boardId on BoardsRoutePage and offer an "open beside chat" button | That is what shipped, and it is what this unit removes. It makes the workspace an opt-in destination for a board rather than where boards live, so refresh and Back drop the user out of the arrangement they built |
| Populate boardTitles inline in the workspace component instead of extracting a pure module | The bug existed precisely because the context was assembled inline and therefore untested. A pure module is the only shape in which "titles survive a project change" is assertable without mounting the whole page |
| Give the two new command fields real wire types instead of AnyValue | The rules a payload must satisfy are the BOARD's schema, which only the server can read. A wire type could only restate shape, not validity, so it would be a second place to state rules the decoders own — and the two would drift |
| Reuse decodeCardContent / decodeFieldDefs for wire writes | They are lenient by design so old rows stay readable. Reusing them on a write would silently drop the one field the client could not spell and ack an edit that never landed |
| Keep validateCardContent rejecting undeclared fields and missing required ones | It sits under the sync engine too. Rejecting an undeclared id would fail every GitHub pull onto a board created without a template; enforcing required would make every existing card unwritable the moment a board added a required field |
| Block removal of a load-bearing field in the schema editor | Makes the product's conventions unremovable from a board that has neither a GitHub binding nor an agent, for a cost that is a thinner prompt rather than data loss. Warning at the point of removal is the same treatment every other soft constraint in boards gets |
| Ship chatLinksByCard for the whole board | A 5000-card board would pay the link query for 4970 cards it never renders. Scoping to the shipped page makes the cost proportional to what is on screen |
| Apply a card field edit optimistically, as card moves already are | A refused write would leave the wrong value standing with nothing to correct it. A move has a visible destination the user can see snap back; a field value does not, so it commits and reloads |
| Re-seed the schema draft from the board snapshot while the editor is open | A board broadcast carries a freshly decoded cardFields array on every card move, so re-seeding would wipe an in-progress edit the first time anyone dragged a card. The draft is seeded once at open |
| Extend a component's Derived Materials globs so src/client/components/boards/** maps somewhere | Discussed under Risks — it would file board rendering under a component that names it as a non-goal, and would not fix c3x lookup anyway |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| The board feature stays invisible to file-to-component lookup | Named here as known modelling debt rather than papered over. src/client/components/boards/\*\*, src/server/board-\*.ts and src/shared/boards/\*\* are bound to no component in .c3/code-map.yaml; they want a component of their own, which is out of scope for this unit. The parts that DO map — src/client/lib/boards/** to c3-110, src/client/app/ChatPage/** to c3-112, src/client/stores/** to c3-102, src/shared/protocol.ts to c3-302 — are covered above | grep board .c3/code-map.yaml returns nothing; a follow-up unit that introduces the component is the fix |
| A route-neutral page privileges one route by accident | The render gate is workspaceHasTabs, which neither route can satisfy specially, and the board route's only extra work is one openTab call | BoardsRoutePage.test.tsx plus the workspace page's own suite; landing on a board URL with no chats renders the board |
| A board tab silently falls back to "Board" again | The title is sourced from two places — the open view and the project list — so either alone suffices, and the merge order is asserted | tabPresentationContext.test.ts covers view-only, list-only, and disagreement |
| The relaxed store gate lets a contradictory value reach storage from a non-drawer caller | Only the two checks that were unknowable at that layer were dropped; every contradiction check remains, and the wire path adds the stricter decoder on top | board-store.adapter.test.ts asserts each remaining refusal still fires |
| New component tests destabilise unrelated suites in the same process | The new board component tests joining the Bun process surfaced a latent teardown bug rather than causing one: happy-dom registers one document per process and the test preload wipes document.body after each test, so a React root left mounted keeps portal children registered against an emptied body and the next flush crashes deleting a missing node. SubagentsSection.test.tsx and WorkflowsSection.test.tsx gained a closeRoot helper that unmounts inside act before removing the container | Zero test cases added to either file — the diff is teardown only, and the full suite is green |
| A pre-existing flaky test masks a real regression | src/server/event-store.test.ts subagent_message_delta accumulates into finalText fails roughly one run in three on this machine and is unrelated to this unit — it touches no board, workspace or protocol code. It passed on the run recorded below. Not fixed here, and deliberately not suppressed | Re-run bun test --conditions production src/server/event-store.test.ts on a red suite before attributing a failure to this change |

## Verification

| Check | Result |
| --- | --- |
| bun run typecheck | clean, exit 0 |
| bun run lint (--max-warnings=0) | clean, exit 0 |
| bunx ast-grep test | 14 passed, 0 failed |
| bun run lint:usestate | clean, exit 0 |
| bun run build:client | built in 6.67s |
| bun run test | 5663 pass, 2 skip, 0 fail — 5665 tests across 467 files in 73.79s |
| c3x check | ok, 0 errors, 189 facts |
| c3x check --include-adr --only adr-20260811-board-in-the-workspace | ok, 0 issues |
