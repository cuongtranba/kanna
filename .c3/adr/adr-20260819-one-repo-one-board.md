---
id: adr-20260819-one-repo-one-board
c3-seal: 491c88f288c69471beef45a5fdd9d38702651c33df01d7781bb03730f814fee6
title: A repo binds to exactly one board, and a binding names its checkout
type: adr
status: accepted
date: "2026-08-19"
relates:
    - adr-20260819-n-sync-bindings-per-board
    - adr-20260811-card-start-work
    - adr-20260811-board-in-the-workspace
---

## Context

`adr-20260819-n-sync-bindings-per-board` made one board hold N bindings, which
is what lets a Stack board — a board owned by a stack of checkouts rather than
one project — pull issues from every repo in the stack. It left two things
unresolved, and each of them breaks a different half of the feature.

**A pulled card did not know which checkout it came from.** "Start work" mints a
worktree from `resolveStartWorkProjectId(card, board)`, which reads
`card.projectId` and falls back to the board's owner when the board is owned by
a project. A Stack board has no owner project, so on the exact board this
feature exists for, the fallback yields null and every pulled card refuses to
start work. Nothing else could supply the answer: the board spans several repos
and names none of them, and the issue payload knows nothing about local disk.

**Nothing stopped two boards binding the same repo.** `sync_link_external_idx`
is unique per `(binding_id, external_id)` — per BINDING, not per issue — so two
bindings on one repo each import every issue as a SEPARATE card, with two sync
links and two outbox entries. Both boards then push to the same real tracker,
last writer wins, and a user who dragged a card on one board watches it silently
revert. This is reachable by clicking Connect twice on two boards; no warning,
no error, and the damage is only visible on GitHub.

## Decision

**A binding records the project whose checkout holds the repo**
(`SyncBinding.projectId`, nullable). `board-sync.ts` stamps it onto every card it
creates, so `card.projectId` — the field Start work already reads — is correct on
a Stack board without any new resolution rule. Null is the honest answer for a
binding created before this existed and for one the caller could not attribute;
on a Stack board that card cannot be worked, which is right, because guessing a
checkout means editing the wrong repository.

**A repo binds to exactly one board, enforced in `bindSync`.** Binding a repo
another board holds is REFUSED unless the caller passes `detachFromBoardId`
naming that board, in which case the old binding is deleted first. The other
board keeps its cards — unbinding cuts the link, it does not delete the work.

**The screen asks before it moves, not after.** `RepoSuggestion.boundTo` carries
`{boardId, boardTitle, cardCount}` so the connect screen can say which board
loses the feed and how many cards stay behind. The button reads "Move here", not
"Connect", and takes two clicks.

## Why not

**A unique index on `(provider_id, source_ref)`.** The rule is cross-board, so
the constraint would have to be global — and a constraint cannot distinguish
"already yours" (a re-bind, which must UPDATE) from "someone else's" (a move,
which must ask). It would also turn a question the UI wants to answer politely
into a SQLite error string. `findBindingsBySource` returns a LIST rather than
the first hit so a database that already violated the rule reports the whole
violation instead of half of it.

**Trusting the screen's `boundTo` and skipping the re-check in `bindSync`.**
`boundTo` is read when the panel loads and confirmed by a human some seconds
later; another tab can bind in between. `bindSync` re-reads the live owner and
refuses a `detachFromBoardId` that no longer matches, so a stale view is
rejected rather than silently detaching a board the user never saw.

**Auto-detaching on conflict.** Connecting a repo would then quietly strip
another board's issue feed. The refusal is the feature: a move is a decision,
and `detachFromBoardId` is what records that someone made it.

**Inferring the project from the repo slug at pull time.** The mapping from
`owner/repo` to a local checkout is not a function — the same repo can be cloned
twice, and a fork's origin does not match its upstream. The binding is created
by a screen that already knows which project it is offering, so the fact is free
at bind time and a guess at any later time.

## Consequences

- `SyncBinding.projectId` is nullable forever; readers must handle null rather
than assume a backfill. On a Stack board a null-project card cannot Start work
— pinned by a test, because the tempting fix (fall back to the first binding)
works in the wrong repository.
- `bindSync` can now throw `BoardStoreError("conflict")`. `board.sync.bind`
surfaces it as a command error; the panel renders it.
- The connect screen reads every suggestion's owner on load
(`repoBindingOwner`), which costs one card-count query per project on a Stack.
- Moving a repo between boards is lossy by design: the old board's cards stay
but stop syncing, and their sync links and outbox rows are cascaded away.
