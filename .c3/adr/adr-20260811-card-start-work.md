---
id: adr-20260811-card-start-work
c3-seal: 606122be9b8434cb2bd5d168603de00318563af1a9547276d8cd127dceeeacda
title: card-start-work
type: adr
goal: |-
    Give a kanban card one button that produces an isolated agent session: a git
    worktree, a branch derived from the card, and a chat whose cwd IS that
    worktree. One card, one worktree, one branch, one chat — so three agents
    working three cards cannot touch each other's files. The button is idempotent
    by construction: a card that already has a live chat opens it, a card whose
    worktree survived resumes into it, and a card that has neither starts fresh.
    Reaching a `done` column asks once what should happen to the worktree.
status: proposed
date: "2026-08-11"
---

# Start work — a card becomes a worktree, a branch and a chat

## Goal

Give a kanban card one button that produces an isolated agent session: a git
worktree, a branch derived from the card, and a chat whose cwd IS that
worktree. One card, one worktree, one branch, one chat — so three agents
working three cards cannot touch each other's files. The button is idempotent
by construction: a card that already has a live chat opens it, a card whose
worktree survived resumes into it, and a card that has neither starts fresh.
Reaching a `done` column asks once what should happen to the worktree.

To make the chat's cwd land on the worktree this ADR also relaxes one
event-store invariant: a chat may carry `stackBindings` without a `stackId`.

## Context

`resolveSpawnPaths` (`claude-session-config.ts`) derives a Claude turn's `cwd`
from the chat's `stackBindings` primary entry — that is the only mechanism in
Kanna for running a chat somewhere other than `project.localPath`. But
`buildCreateChatEvent` (`event-store-write-ops.ts`) refused bindings unless a
`stackId` came with them, and a one-project Stack cannot be created:
`buildCreateStackEvent` requires at least two projects, and
`buildRemoveProjectFromStackEvent` enforces the same floor. So the shape a card
needs — one project, one worktree — was unreachable through the supported path.

Nothing else needs the stack. `StackBinding` (`shared/types.ts`) carries
`projectId`, `worktreePath`, `role` and no stack reference, and every consumer
reads it without resolving one: `resolveSpawnPaths`, `resolveStackProjects`,
`deriveChatSnapshot`, the `## Stack projects` prompt block, and `ChatNavbar`.
The single coupling was the validator. The shape is also not novel to the log —
`forkChat` already writes `chat_created` events bypassing that validator.

The client side has its own constraint: a card's links are stored facts, but
whether the linked chat still EXISTS is not. The stale-empty-chat reaper
deletes a chat nobody wrote to, and a worktree can be removed with plain git.
A label derived on the client would therefore say "Open chat" about a chat that
is gone.

Affected topology: the event store (c3-206) owns the relaxed invariant, the WS
router (c3-208) gains two commands, the diff store (c3-215) is reused
read-and-write for the merge, and the pane layout (c3-104) receives the opened
chat tab.

## Decision

**Let a worktree binding stand on its own.** `buildCreateChatEvent` accepts
`stackBindings` with no `stackId`; a `stackId` still requires bindings, and the
stack-membership check is gated on a stack being named. Every other invariant is
untouched: exactly one primary, unique project ids, non-empty `worktreePath`,
and the primary matching the chat's project. The UI needs no change — the
sidebar's Stacks section already skips a chat with no `stackId`, and
`KannaSidebar` already leaves such a chat in its project group.

**Derive the button's state on the server, from one resolver.** `resolveStartWork`
reads the card's links against what still exists — live chat ids, worktree paths
present on disk — and both `startWorkView` (read) and `startWork` (act) consume
it. The view rides `board.card.detail`, so a stale label costs a round-trip and
never the wrong outcome, and a server without the wiring sends `startWork: null`
and the drawer paints no button.

**Worktrees are siblings of the checkout, namespaced by repo name**
(`<parent>/.kanna-worktrees/<repo>/<branch-slug>`). A nested worktree appears to
its parent as an untracked directory — measured, not assumed — which would dirty
every `git status` the Changes pane and the loop oracle's workspace digest read.
The repo-name segment stops two projects sharing a parent from colliding on a
slug.

**Order the writes so a crash resumes.** The worktree is linked to the card
before the chat is created, so a failure between the two leaves a card that
resumes into its checkout rather than an orphaned worktree nothing points at. A
branch that outlived its worktree is reattached rather than failing on the name.

**Cleanup is a refusal, not a confirmation.** `discard` is rejected while the
worktree holds uncommitted files or unmerged commits, and names what would be
lost. Uncommitted work exists nowhere else and a column drag has no undo, so
"are you sure?" is the wrong question. Merging goes through `previewMergeBranch`
/ `mergeBranch`, giving the card's branch the same rules and conflict detection
as a merge from the Changes panel; the preview also supplies the commit count
and conflict flag shown before the user chooses.

**The pending cleanup question is derived, not event-driven.** A card sitting in
a `done` column with a live worktree IS the question, however it got there — so
a missed move event cannot lose the prompt and a replayed one cannot double it.
Declining is remembered as a `cleanup_declined` card link keyed by worktree
PATH, so the same checkout is never asked about twice and the next one is asked
about again. `card_link` already stores exactly (card, target) pairs, so this
needs no migration.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-0 | system | N.A - ancestor named for top-down descent | c3-0#n1@v1:sha256:533930f3ab44e0288af3d70362ad58920bf69e1ac573c89db53a58c98b5bf487 | N.A - ancestor named for top-down descent |
| c3-1 | container | N.A - ancestor named for top-down descent; the delta is in c3-104 | c3-1#n7151@v1:sha256:948fe603f61dc036b5c596dc09fe3ce3f3d30dc90f024c85f3c82db2ccab679d | N.A - ancestor named for top-down descent |
| c3-2 | container | N.A - ancestor named for top-down descent; the delta is in c3-206, c3-208 and c3-215 | c3-2#n7865@v1:sha256:cdbf6975e8a35b0d03558be6822dfae166482c24fb86b0433f60e8167f5c91e4 | N.A - ancestor named for top-down descent |
| c3-206 | component | buildCreateChatEvent now accepts a worktree binding with no stack; the persisted chat_created event may carry stackBindings alone | c3-206#n8167@v1:sha256:4bbe28051be1ca893e66e498279b8364077c001c1ffd682ea36f2f8c16266178 | Confirm the remaining binding invariants are unchanged and that replay of an existing log is unaffected |
| c3-208 | component | Gains board.card.startWork and board.card.resolveWorktree, and enriches board.card.detail with the start-work status and cleanup question | c3-208#n8278@v1:sha256:844f303a1dc89a3fb56db4e575721a405353084678086a7abfeda0736c23c284 | Confirm each new dep is actually supplied at the single wiring site, and that an absent dep answers rather than silently no-ops |
| c3-215 | component | previewMergeBranch / mergeBranch are reused to merge a card's branch | c3-215#n8635@v1:sha256:4c543ddead189f1e6941d5273f5b8d278d9fb187f7f86696497a595ae85f9636 | Confirm no branch semantics are re-implemented for boards |
| c3-104 | component | The drawer opens the card's chat as a tab through openTab | c3-104#n7346@v1:sha256:a9d4107c7a4aea59659b92cf3141fe1740f7c9602f99911c614123bdcd1f2395 | Confirm the tab address is the ordinary {kind:"chat"} target, so idempotent open still holds |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-event-sourcing | The chat-creation invariant this ADR relaxes is enforced in the event builder, and the resulting event is replayed on every boot | ref-event-sourcing#n10018@v1:sha256:ee0316401639d91b6d6f6b1c3615cf7eab1abbd5cbf9cef319474a29c2567775 | comply — the change is to a builder's validation, not to the log format; stackBindings was already an optional field on chat_created and the reducer already applied it independently of stackId |
| ref-side-effect-adapter | startWork and the cleanup resolver drive git and the chat store, neither of which they may import | ref-side-effect-adapter#n10118@v1:sha256:d97da3a35cbbfc743202e4b37a53c5ae837c6f8c802bdd22685991e0bfe439ee | comply — both modules take every effect as an injected port and import no IO; localBranchExists was added to worktree-store.adapter.ts rather than inline, and server.ts is the single binding site |
| ref-local-first-data | The worktree a card creates is a real directory on the user's disk, placed by Kanna | ref-local-first-data#n10051@v1:sha256:6c1744cb29d49192d5bb3ac1662201087df01c9ee04f38fb3f53d04844e79485 | comply — worktrees sit beside the checkout under .kanna-worktrees/<repo>/, never inside it, so the project's own tree is never dirtied; nothing leaves the machine |
| ref-ws-subscription | Two new commands ride the existing socket, and board.card.detail grows two fields | ref-ws-subscription#n10221@v1:sha256:262446a7d1764e15397e60f10d9b4c55fae08bc956461d99a6bf0e2c5c62eada | comply — request/ack commands only, no new topic; board state still reaches the client through the existing board snapshot push, which the registry emits on every card-link write |
| ref-cqrs-read-models | The start-work status and cleanup question are derived views served on a read command, not stored state | ref-cqrs-read-models#n9985@v1:sha256:cc9d478fbc03fb946ec0feaf95b2e7bb2d9a0be5222850d04c8b5410718e9369 | comply — both are computed per read from links plus what exists on disk, so nothing can go stale in storage |
| ref-tool-hydration | The merge path reuses c3-215's previewMergeBranch / mergeBranch rather than re-deriving branch state | ref-tool-hydration#n10188@v1:sha256:1cda574e5908fc3b6c85e5bbb9432e5edeee3a0c7d0d11e0230c45ac05c8a718 | comply — the drawer renders the preview's own commit count and conflict flag; no second source of branch truth |
| ref-strong-typing | The new wire types cross client and server, and CardLinkKind gained a member | ref-strong-typing#n10155@v1:sha256:eaa7509d80f8a56b00105ed5d46af5a604bfae2e81889e9dac7d7a095fbf5009 | comply — StartWorkStatus and the cleanup decision are discriminated unions switched exhaustively with no default, so a new variant fails to compile |
| ref-zustand-store | The drawer's in-flight and outcome state lives in CardDrawer.store | ref-zustand-store#n10254@v1:sha256:dbc70d01ac1d611dc6a09e8e8e32d43b2566e4f95364435024f241e5109d3498 | comply — every transition is a named action (beginStartWork / endStartWork / beginCleanup / endCleanup); no inline updater reaches a JSX attribute |
| ref-colocated-bun-test | Every module added here is server or shared code under the colocated-test convention | ref-colocated-bun-test#n9952@v1:sha256:2bc20e87f7c1e3aabe46c42732cca6d91bf2f72516544a2924fe9870e8df4385 | comply — each new module has a sibling *.test.ts(x), plus one *.integration.test.ts for the real-git path |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-colocated-bun-test | c3-206 and c3-208 both carry it, and this ADR adds modules to each | rule-colocated-bun-test#n10287@v1:sha256:2bc20e87f7c1e3aabe46c42732cca6d91bf2f72516544a2924fe9870e8df4385 | comply — see the Enforcement Surfaces table; each new module's tests sit beside it |
| rule-strong-typing | The relaxed chat invariant and the new wire types are both enforced by types before they are enforced by code | rule-strong-typing#n10348@v1:sha256:eaa7509d80f8a56b00105ed5d46af5a604bfae2e81889e9dac7d7a095fbf5009 | comply — startWorkLabel and resolveWorktreeCleanup switch exhaustively with no default, so adding a status or a decision is a compile error until handled |
| rule-zustand-store | c3-104's drawer gains two in-flight flags and an outcome note | rule-zustand-store#n10380@v1:sha256:dbc70d01ac1d611dc6a09e8e8e32d43b2566e4f95364435024f241e5109d3498 | comply — named actions only; bun run lint:usestate and bunx ast-grep test both pass, which is what would catch an inline updater |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| board-start-work.integration.test.ts | Runs real git and a real EventStore: asserts the worktree is on disk, that resolveSpawnPaths on the persisted chat resolves cwd TO it, and that git status --porcelain in the checkout is still empty | 3 tests, 60s budget each |
| board-start-work.test.ts | Pins the branching: resume, reuse, reattach, no-active-column, unresolvable project, and that a failed chat creation keeps the worktree link | 15 tests |
| board-worktree-cleanup.test.ts | Pins that discard is refused while the worktree holds work, that a failed merge leaves the worktree alone, and that a failed removal does not turn a successful merge into a failure | 10 tests |
| ws-router-boards.test.ts | Asserts an unwired startWork dep answers with an error rather than accepting the command and going quiet — the failure mode that hid the board MCP tools for a whole phase | 4 tests |
| CardDrawer.test.tsx | Asserts the label tracks the status, that a server sending no status paints no button, and that discard is disabled with its reason shown | 12 tests |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Create a one-project Stack per card | Not constructible: buildCreateStackEvent requires ≥2 projects, so it would relax MORE invariants than the binding change. It would also add one top-level sidebar row per card and pull the card's chat out of its project group |
| openProject(worktreePath) so the worktree becomes its own project | Dedupes cleanly, but costs one visible project row per card, pollutes the stack-create picker, and grows deriveLocalProjectsSnapshot's O(projects × chats) scan — with no GC anywhere to reclaim it |
| Derive the button label on the client from the card's links | The client cannot know whether a linked chat or worktree still exists, so it would confidently offer to open a chat the reaper deleted |
| Put card worktrees under <repo>/.worktrees/ | Measured: git reports the nested worktree as ?? .worktrees/, dirtying the Changes pane and the loop oracle's workspace digest |
| Store "cleanup declined" in a new table | card_link's primary key is already exactly (card, kind, target) — the pair being recorded — so a table would be a migration for no new shape |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| A relaxed chat invariant lets a malformed binding through | Only the two stack-coupled lines are gated; one-primary, unique-projects, non-empty-path and primary-matches-project all still throw | event-store-write-ops.test.ts asserts each refusal still fires with no stackId present |
| Card worktrees accumulate with nothing to reclaim them | Reaching done asks, and the question is derived so it cannot be lost; nothing is ever deleted without an answer | board-worktree-cleanup.test.ts; the decline is scoped to one worktree path so a later one asks again |
| Merging from the drawer diverges from merging in the Changes panel | There is one implementation — the drawer calls previewMergeBranch / mergeBranch | board-worktree-cleanup.test.ts injects the merge port; server.ts binds it to DiffStore |

## Verification

| Check | Result |
| --- | --- |
| bun run typecheck | clean |
| bun run lint (--max-warnings=0) | clean |
| bunx ast-grep test | 14 passed, 0 failed |
| bun run build:client | built |
| bun run test | 5395 pass, 2 skip, 0 fail |
| bun test src/server/board-start-work.integration.test.ts | 3 pass — real git, real event store, checkout verified clean |
| c3x check | ok, 0 errors |
