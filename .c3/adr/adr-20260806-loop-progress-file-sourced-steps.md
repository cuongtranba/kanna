---
id: adr-20260806-loop-progress-file-sourced-steps
c3-seal: c596b468f4ac5f7fd4e0542f87b4bb432fc1452ccd8db3c352da6bc81fd7e2ee
title: loop-progress-file-sourced-steps
type: adr
goal: |-
    Make the chat footer's Progress card show the armed loop's whole checklist by
    reading the loop's tracking file, instead of listing only the subagent
    delegations this server process happened to start since the current
    `loop_armed`. The tracking file is already documented as the loop's ONLY
    durability contract; nothing on the server read it for display. Concretely:
    add a `listItems` primitive to the structured-doc port, a disk-watch
    read-model over the armed loop's tracking file, and a lifecycle reconcile that
    turns loop arm/disarm into a filesystem watch — then feed both plan-derived
    and run-derived rows through `buildLoopProgress` in one checklist order.
status: accepted
date: "2026-08-06"
---

## Goal

Make the chat footer's Progress card show the armed loop's whole checklist by
reading the loop's tracking file, instead of listing only the subagent
delegations this server process happened to start since the current
`loop_armed`. The tracking file is already documented as the loop's ONLY
durability contract; nothing on the server read it for display. Concretely:
add a `listItems` primitive to the structured-doc port, a disk-watch
read-model over the armed loop's tracking file, and a lifecycle reconcile that
turns loop arm/disarm into a filesystem watch — then feed both plan-derived
and run-derived rows through `buildLoopProgress` in one checklist order.

## Context

`LoopProgressSection.tsx` renders a per-chat Progress card from
`LoopProgressSnapshot.rows`, and `buildLoopProgress` (`src/shared/loop-progress.ts`)
built those rows from exactly one source: `SubagentRunSnapshot[]` filtered to
top-level delegations started at or after `loopArmedAt`. Three consequences,
all observed:

- **Usually one row.** A loop delegates one chunk per iteration and the runs
map is per-process, so the panel showed the current delegation and nothing
else — a progress card with no progress in it.
- **Work finished before the arm was invisible.** Re-arming a loop over a
tracking file with twelve recorded chunks reset the panel to empty, even
though the plan on disk carried every one of them.
- **`LoopRowStatus: "pending"` was dead code.** The client renders a distinct
icon for it; no producer ever emitted it, so the step about to be delegated —
the one thing a human watching a loop wants to see — could not be shown.

The information was never missing, only unread. `## Progress` and
`## Next chunk` in the tracking file are written by every worker under the
rendered loop prompt (adr-20260711-setup-loop-template,
adr-20260805-loop-oracle-hardening), and adr-20260721-tracking-file-mdast-query
already stood up an mdast-backed structured-doc engine that parses exactly
those sections for the MCP tracking-doc tools. What did not exist was a read
path: the engine's port could return a section's TEXT (`query`) but not its
ITEMS, and no server module watched the file.

Topology involved: the chat projection (c3-207), the WS broadcast fan-out
(c3-208), the coordinator's auto-continue append path (c3-210), the loop
read-model that `deriveLoopState` projects (c3-227), and the workflow disk-watch
adapter whose watcher this reuses (c3-229). The panel itself, the pure
`buildLoopProgress` reducer, the structured-doc engine and the three new
`loop-tracking-*` server modules are unmapped files.

## Decision

**The armed loop's tracking file is the step source; live runs supply only the
current step and failures.**

**1 — `StructuredDoc.listItems(content, section)`.** A new port method
(`src/shared/structured-doc/types.ts`), implemented in the markdown adapter by
reusing the existing private `findSection` + `firstListInSection` and slicing
each top-level item by its mdast `position`. Item-level, not line-level:
tracking-log entries are free markdown where continuation lines and nested
sub-lists are normal, and a line regex cannot tell an item's second line from
the next item. `query` could not be reused — its output includes the
`## Heading` line, joins multiple sections with `\n\n`, and injects the
`listLimit` elision marker. Keeping the parse in the existing adapter also
keeps ONE markdown parser in the repo, per adr-20260721-tracking-file-mdast-query.

**2 — `loop-tracking-io.adapter.ts`.** `readTrackingFile(abs)` (sync, null on
any error) and `watchTrackingFile(abs, onChange, opts)`. The watch delegates to
`watchWorkflowDir(dirname(abs), …, { filterBasename: basename(abs) })` — the
adapter gained that one optional field and gates `fire()` on the listener's
filename, with an event that reports NO filename still firing (some platforms
omit it; a redundant read beats a missed change). Watching the parent directory
rather than the inode survives rename-based writes — how editors and many
workers commit a file — and inherits the existing debounce, the
nearest-existing-ancestor re-arm (a loop may arm before its skeleton lands), and
the FSEvents-race poll. Building a second file-watch adapter to avoid one
optional field would have duplicated all four behaviours.

**3 — `loop-tracking-registry.ts`.** `createLoopTrackingRegistry({read, watch,
resolveDoc, maxDoneEntries = 200})` with `register` / `unregister` /
`snapshot` / `subscribe`, mirroring `workflow-registry.ts` — a sibling
disk-watch read-model that never feeds the transcript or turn event pipeline.
Two deliberate departures from WorkflowRegistry:

- `register` early-returns when the path is unchanged. It is called on EVERY
auto-continue event, and an unconditional dispose-and-re-arm would thrash the
watcher through rate-limit churn.
- The read is **synchronous**. `snapshot()` must be sync because
`deriveChatSnapshot` is pure and sync. Async would additionally let two
overlapping debounced refreshes commit out of order, and would stop
`register()` warming the cache before it returns — so the first snapshot
after arming would be empty.

**4 — `loop-tracking-sync.ts`.** `syncLoopTracking(deps, chatId)` is a total,
idempotent reconcile: `deriveLoopState` → `confinePathToDir(trackingFileRel,
workdirAbs)` → `register`, else `unregister`. The else branch covers disarm, a
legacy loop replaying with `trackingFileRel: null`, and a confinement refusal
with one code path. Hooked at exactly two places: `AgentCoordinator.emitAutoContinueEvent`
— the single append path for `loop_armed` / `loop_disarmed`, so arm, `stop_loop`,
user takeover, chat delete and the repeated-failure disarm all route through it
without five separate call sites — and `src/server/server.ts` beside
`scheduleManager.rehydrate(...)` for boot replay, since an armed loop outlives
the process that armed it. A register/unregister pair at each lifecycle site was
rejected: it is the shape that lets one site be forgotten.

**5 — `buildLoopProgress` gains `tracking?: LoopTrackingSnapshot | null`** and
emits four blocks in checklist order: done rows from the plan's `## Progress`
items (reversed to oldest-first, synthetic ids `progress:<i>`), a count-based
top-up for a completion the worker never recorded, errored runs, then the
current step — live `running` runs, else one `pending` row derived from
`## Next chunk` when armed. A completed run whose chunk the plan already records
is DROPPED rather than label-matched: the plan is the authority for finished
work, and fuzzy label matching would make rows flicker as a worker reworded its
own entry. `tracking == null` falls back to exactly the previous run-only
behaviour, so a chat with no armed loop and every existing call site are
unchanged.

**6 — Ordering flip.** `LoopProgressSnapshot.rows` goes latest-first →
**oldest-first** on BOTH paths, docstring in `src/shared/subagent-types.ts`
updated. A checklist reads top-down; keeping the run-only path latest-first
would have left two orderings behind one type.

**7 — Wiring.** `deriveChatSnapshot` gains a TRAILING
`getLoopTracking: (chatId) => LoopTrackingSnapshot | null = () => null`
injected reader — the same precedent as its `getMessages` / `getTunnelEvents`
parameters. Injection, not import: the projection stays pure and its
side-effect seal holds, and the default makes "no registry" ≡ "no tracking
file" so every existing call site keeps compiling. Both production call sites
in `ws-router-envelope.ts` pass `(id) => loopTrackingRegistry?.snapshot(id) ?? null`.
`BroadcastManager` (`ws-router-broadcast.ts`) gains a third registry
subscription that re-pushes the CHAT topic rather than a topic of its own,
because the Progress panel rides the chat snapshot. The registry is constructed
in `server.ts` beside `workflowRegistry` and threaded through `createWsRouter`
and `AgentCoordinatorOptions`.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-207 | component | deriveChatSnapshot gains the trailing getLoopTracking injected reader and threads its result into buildLoopProgress | c3-207#n7693@v1:sha256:fcde78a59ac52af675e32b8beffd96f801400deee2a39a336bba00bef3382138 "Project events into derived views (sidebar, chat, projects, discovery) that ws-router broadcasts to clients." | Tracking must be PASSED IN, never read — the projection stays pure per ref-cqrs-read-models |
| c3-208 | component | BroadcastManager gains a third registry subscription; envelope builder threads the registry into both deriveChatSnapshot call sites | c3-208#n7742@v1:sha256:3b682e08c742ff6ed2ec0fe7e93f9508e535bd265f8c630d292aa17868013d79 "Multiplex WS traffic: route subscribe/unsubscribe/command envelopes, push projections on every state change." | The push must reuse the CHAT topic — no new WS topic for a panel that rides the chat snapshot |
| c3-210 | component | emitAutoContinueEvent reconciles the tracking watch after appending, making it the single lifecycle hook | c3-210#n7843@v1:sha256:ca6753652cc74facb772fe9c0b2c181c8ccf8285292b29d8bde2240ded58671b "Drive turn lifecycle across providers: start/cancel/resume Claude + Codex sessions, emit normalized transcript events." | Reconcile must be total and idempotent; the coordinator must not gain IO of its own |
| c3-227 | component | deriveLoopState gains a consumer that turns loop arm/disarm into a filesystem-watch lifecycle | c3-227#n8742@v1:sha256:0ef718fb27e7c02a2e8fbf87c689c52d8fff12f8b2db15415c79e8d40e8dca12 "Detect provider rate-limit and auth-error endings on a Kanna chat," | The loop read-model stays the only authority for which file is watched; no second arm-state source |
| c3-229 | component | workflow-watch-io.adapter.ts gains filterBasename and now backs a second consumer, the loop-tracking file watch | c3-229#n8880@v1:sha256:6728e6c117ef6fb0b257996d7e08a1626bd65af1f2b7f843ff04cd2146e71240 "Owns the workflow sidecar read-model lifecycle: receives " | The adapter must stay a leaf module with no domain logic while serving two owners |
| c3-2 | container | Container of every affected component and the home of the three new loop-tracking-* modules; the registry is constructed in server.ts beside workflowRegistry and threaded into the coordinator and ws-router | c3-2#n7341@v1:sha256:87984e312939cc03eed326c220cafc5c1bc82c40e789678100477a162a4901ce "Run the local Bun backend: serve HTTP+WebSocket on localhost, coordinate Claude + Codex agent turns, persist events, and broadcast derived read models." | Parent Delta: none — no fact is created, retired or reparented, so c3-2's Components table is synthesized unchanged |
| c3-0 | system | Top-down completeness: the whole change lands inside the server container; the client keeps consuming the existing chat snapshot, so no cross-container contract moves | c3-0#n3@v1:sha256:c9f10a833b3e499d1329f9637c65ac8e7c7b9f78b6210e91ff3f44b8d31e38bc "${GOAL}" | Confirm no new WS topic and no protocol-version bump are required |
| structured-doc engine | N.A - src/shared/structured-doc/** unmapped | Port gains listItems; markdown adapter implements it over mdast positions | N.A - unmapped file | Must reuse the existing parser — one markdown parser in the repo |
| loop-tracking read-model | N.A - src/server/loop-tracking-{io.adapter,registry,sync}.ts unmapped | The three new modules: leaf IO, per-chat registry, lifecycle reconcile | N.A - unmapped file | IO injected into the registry so the side-effect seal holds; adapter suffix on the leaf |
| Loop progress reducer + panel | N.A - src/shared/loop-progress.ts, src/client/app/LoopProgressSection.tsx unmapped | buildLoopProgress gains tracking and emits four ordered blocks; row order flips to oldest-first | N.A - unmapped file | tracking == null must reproduce the previous behaviour exactly |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-cqrs-read-models | The tracking snapshot is a derived view crossing to the client via the existing chat projection; deriveChatSnapshot must stay a pure projection, which is why the reader is injected rather than imported | ref-cqrs-read-models#n9454@v1:sha256:768802027896fc8c9ebd415cf63483f64e0c5f2f4bc10f21079a8f7d51c38dcd "Separate write path (event log) from read path (derived views) so subscribers consume fast snapshots without replaying the log." | comply |
| ref-side-effect-adapter | New node:fs reads and watches enter src/server/**; they are confined to loop-tracking-io.adapter.ts and the registry takes them as injected deps | ref-side-effect-adapter#n9587@v1:sha256:0f7e313537878f2b9a40701637fa22c1081236a88c5738c704244e97f3e0ddc3 "Two-shape adapter convention, both colocated next to the module that owns the port:" | comply |
| ref-zustand-store | Cited by c3-229, whose watch adapter this change extends; reviewed because the panel gains rows but no client state — the steps ride the existing WS-fed chat snapshot, no store and no useState is added, and LoopProgressSection stays a pure render of its prop | ref-zustand-store#n9723@v1:sha256:53e3365a2350860110617c32292965a5051709854e758fc7470752136627d86e "Client UI state lives in small Zustand stores scoped by concern (chat input, preferences, sidebar, terminal), persisted selectively via localStorage." | review |
| ref-strong-typing | LoopTrackingSnapshot crosses the WS chat snapshot and LoopTrackingRegistry / its deps cross module boundaries; all are named exports in src/shared or src/server with no any | ref-strong-typing#n9624@v1:sha256:390cd8fee6d22c17530c1b9551d02cbd40ea33c56574b7ebc313f21961a707af "No any / untyped shapes at boundaries — everything that crosses client↔server, provider↔coordinator, or log↔read-model is a named type in src/shared or " | comply |
| ref-colocated-bun-test | Three new server modules ship, each with a colocated <module>.test.ts, plus a real-file end-to-end case in loop-tracking-registry.test.ts | ref-colocated-bun-test#n9421@v1:sha256:9490f9305f79ff29d492d099b81c1227c5d277e4a16bf251c1779ddc338f4be8 "Tests sit next to the file under test, named *.test.ts(x), and run under bun test — no separate test directory, no framework churn." | comply |
| ref-ws-subscription | Reviewed because the panel gains a live push path: no new topic, no new envelope and no protocol change — the registry re-pushes the existing chat topic through BroadcastManager | ref-ws-subscription#n9690@v1:sha256:856dbc5b26887801a91ee1acf2a59bd940bd7592ddaa57b46a8689de86dd07cc "A single typed WebSocket handles both subscriptions (push) and commands (pull), with a shared envelope defined in src/shared/protocol.ts." | review |
| ref-local-first-data | Reviewed because a new filesystem read enters the server: it is confined to the armed loop workdir by confinePathToDir, reads only a file the loop already owns, and writes nothing | ref-local-first-data#n9520@v1:sha256:6b71d8a9c2f48d47b9acda0a867f9936d76727141dc2efbbdfead90101e7fd49 "All persistent state sits under ~/.kanna/data; the server binds to 127.0.0.1 by default and only exposes wider surfaces (LAN, tunnel) when the user opts in." | review |
| ref-tool-hydration | N.A for this change — the tracking file is read as a document, never as a provider tool call; no transcript entry or ToolKind is added | ref-tool-hydration#n9657@v1:sha256:376e5fee261bd3b463633f19523020439854d9bd11ddc28ff5cffe12d8ed485e "Provider tool calls (Read, Edit, Bash, plan, diff, ...) are normalized into unified transcript entries by src/shared/tools.ts before rendering." | review |
| ref-provider-adapter | N.A for this change — nothing here branches on provider; the read-model is fed by the loop's tracking file, not by a provider stream | ref-provider-adapter#n9553@v1:sha256:6c354267518fab769e6ba895dc71c3d27f8216ea10e1cb84a52a488e8ff7e972 "Normalize Claude Agent SDK and Codex App Server into one transcript + tool-call model so the UI never branches on provider." | review |
| ref-event-sourcing | The tracking file is an external artifact, not a Kanna event; this read-model is disk-fed under the SAME scoped override c3-229 already carries, and mirrors its registry shape rather than duplicating the file into the event log | ref-event-sourcing#n9487@v1:sha256:1ff5f5fcbeeb85e1ccfe24b3e3e63babaec81436d2a50381b8e0b560132fd0aa "Every state mutation is first captured as an immutable event appended to a JSONL log; system state is derived by replay + periodic snapshot compaction." | review |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-strong-typing | LoopTrackingSnapshot, LoopTrackingRegistry, LoopTrackingRegistryDeps and LoopTrackingSyncDeps are new boundary types crossing the WS chat snapshot and module boundaries; all are named exports with no any | rule-strong-typing#n9817@v1:sha256:7e110467821b764c655f13db69c1331592e23c71af38ac5825037c97b15ea180 "All values crossing a Kanna boundary (client↔server WebSocket envelopes, JSONL events↔read-models, provider adapter↔agent coordinator, shared module expor" | comply |
| rule-zustand-store | Cited by c3-229, whose watch adapter this change extends; reviewed because the panel gains rows but no client state: the steps arrive on the existing WS-fed chat snapshot, no store and no useState is added, and LoopProgressSection stays a pure render of its prop | rule-zustand-store#n9849@v1:sha256:f4987b0b2521426050c0c2a5307760c102f3ed1e0a9334b074ed1913fe818f64 "All client state in Kanna lives in Zustand stores, and so does every transition of it." | review |
| rule-colocated-bun-test | Three new impl modules ship, each needing a colocated <module>.test.ts; all three exist and run under bun test | rule-colocated-bun-test#n9774@v1:sha256:f16688b9257e9c88fbd4217bbee99da98b88d1b06a45a5d9cb173a1b0290aae9 "Server, client, and shared packages alike" | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Structured-doc port | Add listItems(content, section) to the port and implement it over mdast positions in the markdown adapter | src/shared/structured-doc/types.ts, src/shared/structured-doc/markdown.ts |
| File-watch adapter | Add optional filterBasename to watchWorkflowDir; gate fire() on the listener filename, still firing on a null filename | src/server/workflow-watch-io.adapter.ts |
| Loop-tracking IO leaf | readTrackingFile + watchTrackingFile delegating to the parent-dir watch | src/server/loop-tracking-io.adapter.ts |
| Loop-tracking registry | createLoopTrackingRegistry with register/unregister/snapshot/subscribe, sync read, no-op re-register | src/server/loop-tracking-registry.ts |
| Lifecycle reconcile | syncLoopTracking / rehydrateLoopTracking over deriveLoopState + confinePathToDir | src/server/loop-tracking-sync.ts |
| Progress reducer | buildLoopProgress gains tracking; four ordered blocks; rows flip to oldest-first | src/shared/loop-progress.ts, src/shared/subagent-types.ts |
| Server wiring | Registry construction, boot rehydrate, coordinator hook, envelope readers, broadcast subscription | src/server/server.ts, src/server/agent-coordinator.ts, src/server/ws-router-envelope.ts, src/server/ws-router-broadcast.ts, src/server/read-models.ts |
| C3 doc patches | Contract edits landed on c3-207, c3-210, c3-227, c3-229. c3-208 is NOT patched: its doc carries a section (## chat.ops delta broadcast) that is not in the component canvas, so the apply gate rejects any merged c3-208 body. Pre-existing defect, out of scope here — resolving it (fold into Business Flow, or raise the canvas) needs its own decision, and silently deleting the section to unblock this unit would destroy content someone added deliberately. The ws-router change is recorded in Affected Topology above | .c3/changes/adr-20260806-loop-progress-file-sourced-steps/ |
| Parent delta | none — no fact is created, retired or reparented, so c3-2's Components table is untouched and no member's Goal Contribution framing changes | c3-2 membership synthesized from parent: links; no parent: link changes in this unit |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Reuse StructuredDoc.query instead of adding listItems | Its output carries the ## Heading line, joins multiple sections with \n\n, and injects the listLimit elision marker — the registry would have to strip all three back out, re-deriving item boundaries the parser already knows |
| Line-based regex over ## Progress | Tracking-log entries are free markdown: continuation lines and nested sub-lists are normal and a line scan cannot tell them from the next item. It would also introduce a second markdown parser, which adr-20260721-tracking-file-mdast-query exists to prevent |
| Watch the tracking file's inode directly | A rename-based write — how editors and many workers commit a file — orphans an inode-bound watcher, and a loop that arms before its skeleton lands would never attach at all |
| A dedicated loop-tracking WS topic | The Progress panel already rides the chat snapshot; a second topic would mean a second subscription, a second client store and two orderings to keep in step, for the same payload |
| Emit tracking state as Kanna events into the log | The tracking file is written by the worker, not by Kanna; mirroring it into the append-only log pollutes it with non-Kanna mutations — exactly the reasoning adr-20260603-workflow-disk-watch-read-model already settled for workflow sidecars |
| Match completed runs to plan rows by label | Workers reword their own ## Progress entries; a fuzzy match would make rows appear, disappear and re-appear between broadcasts. Dropping run rows the plan already covers is deterministic |
| Read the tracking file inside deriveChatSnapshot | The projection is pure and sync by contract; a read there breaks the side-effect seal and makes the chat snapshot untestable without a filesystem |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Errored runs sort after every plan-derived done row | Accepted, stated plainly: a ## Progress row carries no machine-readable timestamp to interleave against, and parsing the free-text date a model wrote is exactly the fragility this change avoids | bun test --conditions production src/shared/loop-progress.test.ts — failed-placement case pins the position |
| progress:<i> ids renumber once if the 200-entry cap is crossed | Accepted: they are React keys, not identity claims, and the client's sameLoopProgress compares label alongside runId | bun test --conditions production src/shared/loop-progress.test.ts — id-stability case pins that recording a newer chunk leaves every existing id untouched |
| A chat deleted without a loop_disarmed event leaks one idle watcher until restart | Accepted, and identical to the behaviour workflowRegistry already has; the reconcile is total, so any later auto-continue event on that chat still cleans it up | bun test --conditions production src/server/loop-tracking-sync.test.ts |
| The parent-directory watcher sees every root-level file change in the workdir (PROGRESS.md usually sits at the repo root) | filterBasename drops non-matching events and the existing 250 ms debounce bounds the rest; each surviving event costs one sync read | bun test --conditions production src/server/loop-tracking-io.adapter.test.ts — sibling-file change does not fire |
| Watcher thrash from re-registering on every auto-continue event | register early-returns on an unchanged path, so rate-limit churn never disposes and re-arms the watch | bun test --conditions production src/server/loop-tracking-registry.test.ts — end-to-end case asserts propagation with no re-register |
| The tracking file grows unbounded on disk | Intentional — history is preserved; only the broadcast payload is capped, by maxDoneEntries (200) | bun test --conditions production src/server/loop-tracking-registry.test.ts |
| Ordering flip breaks an existing consumer | Both paths flip together and the docstring on LoopProgressSnapshot.rows is updated, so one ordering contract remains | bun test --conditions production src/shared/loop-progress.test.ts src/client/app/LoopProgressSection.test.tsx |

## Verification

| Check | Result |
| --- | --- |
| bun test --conditions production src/shared/structured-doc/ | 27 pass — listItems over multi-line items, nested sub-lists, missing section, later-section list |
| bun test --conditions production src/shared/loop-progress.test.ts | 26 pass — incl. 10 new tracking-path cases (ordering flip, pending row, no-duplicate, unrecorded-completion top-up, failed placement, DONE plan, id stability, null fallback) |
| bun test --conditions production src/server/loop-tracking-registry.test.ts | 9 pass — incl. an end-to-end case over a REAL temp file: a plan on disk becomes checklist rows and a worker's append propagates through the real watcher with no re-register |
| bun test --conditions production src/server/loop-tracking-sync.test.ts | 6 pass |
| bun test --conditions production src/server/loop-tracking-io.adapter.test.ts | 4 pass — sibling-file change does not fire; a null filename still fires |
| bun test --conditions production src/server/read-models.test.ts | 33 pass — default-arg guarantee + file-derived rows |
| bun test --conditions production src/client/app/LoopProgressSection.test.tsx src/client/app/useKannaState.test.ts | 60 pass — all four statuses render distinct icons; checklist order; dedup on a reworded plan row |
| bun run test | 4965 pass, 2 skip, 0 fail |
| bun run lint / bun run typecheck / bunx ast-grep test / bun run lint:usestate | all clean |
| Manual, post-merge | Arm a loop over a PROGRESS.md with existing entries; the panel shows every recorded chunk plus the pending next one, and a worker's append lands without a reload |
