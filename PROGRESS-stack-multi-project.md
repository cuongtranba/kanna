# PROGRESS — Stack multi-project support

Tracking file for `PLAN-stack-multi-project.md`. Structured for the loop
tooling: read it with `mcp__kanna__query_tracking_file({ file:
"PROGRESS-stack-multi-project.md", sections: ["next chunk"] })` and write to it
with `append_tracking_row` (Progress, Failed approaches) and
`replace_tracking_section` (Next chunk — replace, never append, or completed
chunks pile up and get redone).

## Handoff

**All four phases are implemented.** Phase 3's ADR is `accepted` and Option A
(card dependencies) shipped in its three slices; Phase 4's C3 facts are authored
and the toolchain that blocked them is unblocked. Read the Progress log below
before the plan — several plan details were superseded by what the
implementation found, and each deviation is recorded there with its reason.

**Start here:**

1. Read `PLAN-stack-multi-project.md` end to end. It carries the evidence with
   `file:line`, so you should not need to re-derive the current behaviour.
2. Read §3 "Ground rules" before writing code — in particular the
   architecture-budget headroom table:
   `src/client/app/useAppGlobalState.ts` has **zero** lines of headroom,
   `KannaSidebar.tsx` has 4, `claude-pty/driver.ts` has 1. New code goes in a
   new module; do not raise a pin.
3. Read the routing skill `.claude/skills/kanna/SKILL.md`, plus
   `kanna-test` (gates), `kanna-loop` (if you touch `setup_loop`),
   `kanna-react-style` + `DESIGN.md` (if you touch `src/client/**`).
4. Run `/c3 query stacks` (and `c3x lookup <file>` per file) before editing.
   Note that stacks have **no** C3 component fact yet — Phase 4 authors it, so
   `c3x lookup` on a `Stack*` file currently answers nothing. That is a known
   gap, not a broken setup.
5. One phase = one branch = one worktree = one PR. Phase 1 is a bug fix and
   must land on its own so it can be reverted independently of the features.

**Baseline:** `main` @ `6fc297f8`. Re-read any line number before editing it.

**Two claims in the plan are unverified on purpose** — do not treat them as
facts, verify them and record the answer under Progress:

- Whether the Claude **Agent SDK** path honours
  `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD` (documented for the CLI; the
  SDK spawns that CLI, but that is inference). Phase 1b tells you how to check
  it with `/context`.
- What a **Codex** turn actually does when asked to read, and to write, a peer
  worktree that is not its `cwd`. Phase 1c's prompt wording depends on the
  answer.

## Goal

A stack chat is aware of every bound project's location, obeys every bound
project's instructions, and cross-project work is coordinated rather than
manually juggled — on all three providers (Claude SDK, Claude PTY, Codex).

## Verify command

```
bun run check && bun run test && bun run check:arch
```

Note: this is the repo-wide gate, not an acceptance oracle for the goal above —
it proves a phase did not regress the tree, and it passes on `main` today. If
you arm an autonomous loop against this file, pass a phase-specific oracle
(`setup_loop` refuses a command that already exits 0) — e.g. for Phase 1a, the
new focused test in `src/server/claude-loop-commands.test.ts` before it is made
to pass.

## Next chunk

**Nothing outstanding.** Every phase in the plan is implemented and the branch is
green. Two follow-ups are deliberately NOT in scope here and want their own
change:

1. **The `/`-catalog gap (PLAN §7.4).** The command and skill picker is
   primary-only, so skills committed in an additional project never appear in a
   stack chat. Fixing it changes `ProjectCommandsSnapshot`'s shape and needs its
   own reasoning about name collisions between projects. Documented under "Known
   limitations" on the wiki's Stacks page; no issue was filed, because opening
   one is an outward-facing action nobody authorized on this task.
2. **A stack-wide autonomous loop (ADR Option B).** Rejected in
   `adr-20260904-cross-project-orchestration` with its four open contracts named.
   If it is wanted, it is a new ADR that answers them first.

Two smaller things a later change could pick up, both pre-existing and neither
caused here: `c3x check`'s last remaining warning is c3-113's stale eval anchor
(`src/client/app/KannaTranscript.store.ts` matches no files), and `.c3/` holds a
`c3-234-.md` whose filename lost its slug.

## Progress (latest first)

- 2026-09-04 **Phase 3 Option A shipped, and Phase 4 completed.** ADR
  `adr-20260904-cross-project-orchestration` moved `proposed` → `accepted` on the
  user's decision, and Option A landed in the three slices it prescribes. Gates:
  `bun run check`, `bun run lint`, `bun run lint:usestate`, `bunx ast-grep test`
  (19 passed), `bun run check:arch` (69 passed), `bun run lint:limits` ("All 4
  ESLint ceilings are tight"), gitleaks v8.30.1 via docker ("no leaks found").
  `bun run test` is 7868 pass / 1 fail — the `waitForTuiReadyDismissingDialogs`
  2000 ms wall-clock flake this file already documents, in PTY code this branch
  does not touch; the `claude-pty/` directory passes 300/300, three runs in a row.
  - **The edge is a `card_link` row of kind `blocked_by`, not a new table.**
    `card_link` is already keyed `(card_id, kind, target_id)` and cascades from
    `card`, so an edge de-duplicates itself, disappears with either endpoint, and
    needs NO migration — which matters, because `board-store.adapter.ts` sits at
    its architecture-budget pin.
  - **The DAG check lives in `board-registry.ts`'s `addCardLink`.** Every
    production card-link write already comes through the registry
    (`board-start-work.ts`, `board-worktree-cleanup.ts`, `agent-coordinator.ts`)
    and none reaches `BoardStore` directly, so validating that one arm means no
    caller can author an unchecked edge. Three refusals: self, cross-board, cycle.
  - **Deviation from the plan: the gate does not fire on a card whose chat is
    live.** Blocking DEFERS starting; a blocker added mid-flight must not strip
    the user's way back into a running chat. A leftover WORKTREE still defers —
    resuming it starts the work — and reports the worktree it found rather than
    reading as though it had vanished.
  - **A blocker clears three ways: done, archived, or gone.** Archived is
    load-bearing because `getCard` returns archived rows: an archived blocker can
    never reach a done column, so treating it as still-blocking would wedge its
    dependents with no gesture left to free them. A board marking no `done`
    column stands the gate down entirely.
  - **`CardDetail.blockers` is the single derivation**, computed once in
    `registry.cardDetail`, so the drawer's list and the start-work gate cannot
    disagree about what "done" means. `board-start-work.ts` consumes it rather
    than recomputing; `unmetBlockers` and a speculative `registry.getCard` were
    both deleted once that landed rather than left as dead surface.
  - **A user gesture was treated as part of the feature, not an extra.** The ADR
    is written against `orchestration-core`'s unreachability, so a server-only
    edge would have repeated it. `CardDependencies.tsx` is a new module; the
    picker offers the board's LOADED pages, prop-drilled from `BoardPane` exactly
    as `cardFields` already is. Deliberately NOT an MCP tool — an agent that can
    author its own ordering constraints can defer its own work.
  - Budget: no pin raised. `CardDrawer.tsx` 830 → 797 and the pin followed it
    down, after two extractions that earn their place independently —
    `describeWorktreeContents` moved beside `discardBlockedReason` /
    `mergeBlockedReason` in `shared/boards/worktree-cleanup.ts`, and the drawer's
    pure wording helpers to `lib/boards/cardDrawerText.ts`.
  - **The C3 deadlock is cleared, and it was worse than "three broken seals".**
    `c3x repair` could not reseal because its own check failed with 8 errors in
    c3-237 / c3-312, and ONE unsealed fact blocks every rebuild — so `c3x lookup`
    answered nothing for any file in the tree. Fixed by authoring the missing
    `## Contract` / `## Derived Materials` / `## Governance` sections from the
    code they describe. `c3x check` is now 242 docs, 0 errors, and the two
    "layer disconnect" warnings are gone too.
  - **Stacks got three facts, not one** — the boards precedent, because stacks
    span three containers: `c3-238` (server), `c3-313` (shared), `c3-121`
    (client), each with its `.c3/eval/` binding and `code-map.yaml` block.
    `c3x lookup` resolves `claude-session-config.ts`, `stack-activity.ts` and
    `StackBoardsRoutePage.tsx` to them. `StacksSection.tsx` matches c3-121 AND
    c3-115, whose glob covers all of `chat-ui/**`; that pre-existing binding was
    left alone rather than narrowed.
  - Churn audited per `CLAUDE.md`: neither known damage pattern (`\|` collapsed
    to `\ |`, a glob's `*` eaten as emphasis) appears. c3x DOES strip backticks
    from ADR headings — no text lost, and restoring them would only be undone by
    the next repair, so it stands.

- 2026-09-04 **Phase 4 + Phase 3 ADR + the rollup.**
  - **Wiki:** `wiki/src/content/docs/features/stacks.md` — what a stack is, the
    primary/additional roles, what each provider can reach, where instructions
    come from, loop scoping, and the two known limitations. Env table
    regenerated. The generator's scrape was widened from `process.env.KANNA_*`
    to `env.KANNA_*`, because a var read off an INJECTED env (the side-effect
    seal's preferred shape) was invisible to it — that surfaced
    `KANNA_PTY_SANDBOX` and `KANNA_UPDATE_COMMAND` as well, both now described.
  - **Resolver dedup (§7.3) landed with Phase 2.** Worth recording what it
    exposed: the two resolvers DISAGREED on a deleted project — the read model
    kept the title with `projectStatus: "missing"`, the prompt path said
    `(missing)`. The shared resolver takes an explicit `{title, active}` lookup
    and keeps the last known title, which is strictly more information.
  - **Phase 3 ADR** `adr-20260904-cross-project-orchestration` (`proposed`):
    Option A (board card `blockedBy`) is the design; **Option B (stack-scoped
    loop) is NOT adopted** — it needs four new contracts (which tree holds the
    tracking file, what "the oracle" means across N trees, what a partial pass
    means for the GOAL MET terminal check, what `run_verify` fingerprints) to
    serve one feature. No Option A code written: the ADR is not accepted.
  - **Stack activity rollup shipped** (`src/shared/stack-activity.ts`), a pure
    fold over the per-chat `ChatActivity` already computed, surfaced on the
    stack sidebar row. No new events, no new state, independent of A/B.
  - **NOT done: the stacks C3 component fact.** See Next chunk — the C3
    toolchain is deadlocked on pre-existing damage and authoring the fact by
    hand would make it worse.
  - **NOT done: filing the `/`-catalog issue** (PLAN §7.4). Opening a GitHub
    issue is an outward-facing action nobody authorized on this task; the gap is
    documented under "Known limitations" in the new wiki page instead.

- 2026-09-04 **Suite flakiness — read test results on this tree with care.**
  The repo-wide suite is nondeterministic on this machine INDEPENDENT of this
  branch. Measured: `main` @ dce10f77 failed 3 of 4 full runs (once with 50
  cascading failures across unrelated files, once `initObservability > SIGUSR2`,
  once `EventStore subagent runs`); this branch passed 4 of 6, its only failure
  being `waitForTuiReadyDismissingDialogs` hitting a 2000 ms wall-clock cap,
  which passes 3/3 in isolation and 300/300 for the whole `claude-pty/`
  directory. Different test each time, none in code this branch touches. Do not
  read a single red run here as a regression — re-run, and compare against a
  `main` run taken at the same time.

- 2026-09-04 **Phase 2 complete.** ADR
  `.c3/adr/adr-20260904-project-stack-instructions.md` written first (status
  `proposed`). `bun run check`, `bun run test` (7818 pass / 0 fail),
  `bun run lint`, `bun run lint:usestate`, `bunx ast-grep test`,
  `bun run check:arch`, `bun run lint:limits`, gitleaks — all pass.
  - Two events (`project_instructions_set`, `stack_instructions_set`), both at
    replay priority 0, round-tripped AND replayed in
    `event-store.stack-methods.test.ts`.
  - Prompt order is BASE → `## Workspace instructions` → `## Stack
    instructions` → `## Project instructions — <title>` → `## Stack projects`
    → roster, rendered by ONE `renderInstructionSections` shared by the Claude
    suffix, the Codex developer instructions and the subagent prompt.
  - **The global block is renamed `## Workspace instructions`.** Anything
    asserting the old heading for the GLOBAL block was updated; the per-project
    blocks now own the words "Project instructions".
  - **Deviation from the plan: `ResolvedStackBinding.instructions` was NOT
    added.** A binding answers "which roots can this chat reach" and a solo
    chat reaches its project without having one, so the two questions got two
    types: `resolveStackProjects` (roots) and `resolveProjectInstructions`
    (blocks, and the single owner of the solo-chat rule).
  - **Deviation: `stack.create` carries `instructions`** rather than the client
    firing a second `stack.setInstructions`. The client has no stack id before
    the ack, and a second `socket.command<T>` would have regressed the
    `untyped-command-results` budget.
  - Budget: no pin raised. Two LOWERED after extractions —
    `useAppGlobalState.ts` 1472 → 1421 (`useStackCommands.ts`),
    `KannaSidebar.tsx` 1007 → 987 (`StackEditPanels.tsx`).
  - `useState` is banned in `src/client`: the dialog's draft is a
    `createScopedStore`, and its openness is `instructionsProjectId` on
    `kannaSidebarStore` (one project at a time, mirroring the stack panels).

- 2026-09-04 **Phase 1 complete (1a + 1b + 1c).** Gates run on the worktree:
  `bun run check` (typecheck+lint+build+bundle), `bun run test` (7782 pass /
  0 fail), `bun run lint:usestate`, `bunx ast-grep test` (19 passed),
  `bun run check:arch`, `bun run lint:limits` ("All 4 ESLint ceilings are
  tight"), gitleaks v8.30.1 via docker ("no leaks found"). `driver.ts` pin
  lowered 1104 → 1095 after the `buildPtyEnv` extraction; no pin raised.
  - **1a** `setupLoop` now resolves `resolveSpawnPaths(chat, project.localPath).cwd`
    and validates against it; `LoopCommandStore.getChat` widened to
    `Pick<ChatRecord, "id"|"projectId"|"stackBindings">` (no cast). The
    same-repo guard now fires only when the workdir differs from the CHAT cwd —
    Kanna created that worktree, so it needs no git round-trip; a
    model-supplied workdir is still checked against `project.localPath`.
    5 tests in `claude-loop-commands.test.ts`. `setup_loop`'s `workdir`
    description updated.
  - **1b** `withAdditionalDirectoryMemory` added beside `buildClaudeEnv` in
    `claude-spawn-helpers.ts` (NOT in `claude-pty/env.ts` as the plan
    sketched — the SDK path must not import from `claude-pty/`).
    `buildPtyEnv` extracted to `claude-pty/env.ts` with its own suite.
    Applied at both spawn sites. `KANNA_STACK_MEMORY=disabled` is read off the
    PASSED env, so the helper is pure and needs no threading from
    `agent-coordinator`.
  - **1c** `buildCodexDeveloperInstructions` added to `kanna-system-prompt.ts`,
    wired at `claude-turn-starter.ts` (main turn) and `subagent-provider-run.ts`
    (Codex subagent).

- 2026-09-04 **Unverified claim #1 — RESOLVED (statically, not by `/context`).**
  `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD` is a registered env var in the
  CLI bundle the Agent SDK path runs: it appears in the typed env-var schema in
  `node_modules/@anthropic-ai/claude-agent-sdk/bridge.mjs` (declared `u.str()`),
  which is the same CLI the SDK spawns. So the SDK path does honour it.
  **The end-to-end `/context` smoke the plan asks for was NOT performed** — it
  needs a live two-project stack chat on both drivers, which cannot be driven
  from a headless session. Whoever runs the branch should do it and replace
  this entry.

- 2026-09-04 **Unverified claim #2 — RESOLVED, and it contradicts the plan.**
  What a Codex turn does with a peer root: Kanna starts EVERY Codex thread
  (`thread/start`, `thread/resume`, `thread/fork` alike) with
  `approvalPolicy: "never"` and `sandbox: "danger-full-access"`
  (`codex-app-server.ts:289,303,314`). So peer roots are **readable and
  writable** — Codex's gap was knowledge, not permission. Two consequences:
  - The comment at `claude-turn-starter.ts:488` ("Cross-root writes use
    grantRoot") was wrong twice over. `grantRoot` is a field on
    `FileChangeRequestApprovalParams` — an approval RESPONSE — and with
    approvals disabled no approval is ever requested. Comment replaced.
  - The Codex block therefore says only that the cwd is the primary and peer
    roots are reached by absolute path. It does NOT claim they are unavailable.
  - **The plan's provider-picker hint was dropped deliberately.** Its proposed
    wording — "Codex works in <primary> only; the other roots are not
    available" — is false given the above. Shipping a UI warning that is
    demonstrably wrong is worse than shipping none, which is the plan's own
    rule about the prompt block. If a signal is still wanted it must say
    "one working directory", not "no access", and that is a much weaker claim
    than a warning pill deserves.

- 2026-09-03 Review + plan written; no code changed. Findings: loop workdir uses
  `project.localPath` not the chat cwd (affects every board-started chat);
  additional roots' `CLAUDE.md` never loads (`--add-dir` does not load memory
  files by default); Codex drops peer roots and the stack block silently
  (`grantRoot` is never set anywhere in `src/`); no per-project or per-stack
  instruction field exists; no cross-project ordering or stack rollup; stacks
  have no C3 component fact and no wiki page.

## Failed approaches

_Append dead-ends here so a later iteration does not repeat them._

## Phase checklist

Detail for each item is in `PLAN-stack-multi-project.md`.

- [x] **1a** Loop arms in the chat's cwd (§4.1a) — bug fix, affects every
      board-started chat
- [x] **1b** `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD` on multi-root
      spawns, both drivers, `KANNA_STACK_MEMORY` opt-out; extract
      `buildPtyEnv` out of `driver.ts` for the headroom (§4.1b)
- [x] **1c** Codex gets the stack block via a shared
      `buildCodexDeveloperInstructions`. The provider-picker hint is
      deliberately NOT shipped — see the Codex finding under Progress.
- [x] **2** `instructions` on project + stack: events, store, protocol, read
      models, prompt composition (`## Workspace instructions` rename), Codex
      parity, subagent parity, sidebar UI (§5) — ADR
      `adr-20260904-project-stack-instructions`
- [x] **3** Cross-project orchestration — ADR **accepted**; Option A (card
      `blocked_by` dependencies) shipped in three slices: the edge and its DAG
      check, the Start-work gate, the drawer section that reads and authors it.
      Stack activity rollup SHIPPED. Option B remains rejected with reasons.
- [x] **4** Housekeeping: wiki `features/stacks.md` DONE (and extended with the
      dependency gesture), env table regenerated DONE, binding resolvers
      deduplicated DONE (with Phase 2), C3 facts `c3-238` / `c3-313` / `c3-121`
      DONE after unblocking the toolchain. `/`-catalog issue NOT filed
      (documented in the wiki instead) — see Next chunk.
