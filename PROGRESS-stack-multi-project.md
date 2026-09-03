# PROGRESS — Stack multi-project support

Tracking file for `PLAN-stack-multi-project.md`. Structured for the loop
tooling: read it with `mcp__kanna__query_tracking_file({ file:
"PROGRESS-stack-multi-project.md", sections: ["next chunk"] })` and write to it
with `append_tracking_row` (Progress, Failed approaches) and
`replace_tracking_section` (Next chunk — replace, never append, or completed
chunks pile up and get redone).

## Handoff

**Nothing is implemented.** This branch carries the plan and this tracker only.

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

**Phase 2 — `instructions` on project + stack.** Write the ADR first
(`c3x add adr`), then implement in the dependency order in
`PLAN-stack-multi-project.md` §5: types → events → builders → apply/reducer →
store methods → protocol + router → read models → prompt composition
(`## Project instructions` → `## Workspace instructions` rename) → both
providers → subagent parity → sidebar UI.

Note for the prompt step: a SOLO chat has no `stackBindings`, so the resolver
must synthesize a single-entry list from `chat.projectId` or the feature only
works inside stacks. Decide it once and test both shapes.

New client handlers go in their own module — `useAppGlobalState.ts` still has
zero headroom.

## Progress (latest first)

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
- [ ] **3** Cross-project orchestration — ADR first, then Option A (card
      dependencies) and/or Option B (stack-scoped loop); the stack activity
      rollup is independently shippable (§6)
- [ ] **4** Housekeeping: C3 component fact + eval binding, wiki
      `features/stacks.md`, deduplicate the two binding resolvers, file an
      issue for the primary-only `/` catalog (§7)
