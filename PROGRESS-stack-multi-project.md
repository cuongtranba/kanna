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

**Phase 1a — arm the loop in the chat's own tree.** In `setupLoop`
(`src/server/claude-loop-commands.ts:394-428`), pass
`resolveSpawnPaths(chat, project.localPath).cwd` into `validateLoopSetup`
instead of `project.localPath`; keep the `isWorktreeOfSameRepo` guard against
`project.localPath`. Widen the `LoopCommandDeps.store.getChat` return type to
carry `stackBindings` rather than casting. Update the `setup_loop` `workdir`
description at `src/server/kanna-mcp.ts:563` ("Defaults to the project cwd" →
"Defaults to this chat's working directory").

Write the failing test first: a chat with a primary binding at
`/repo/.worktrees/feat` and no explicit `workdir` must arm with
`workdirAbs === "/repo/.worktrees/feat"` and call `runVerifyCommand` with that
`cwd`. Also cover: skeleton written under the worktree; a solo chat unchanged;
an explicit out-of-repo `workdir` still refused; an already-armed loop's
persisted absolute `workdirAbs` unaffected on replay.

Acceptance: Start work on a board card, arm a loop with no `workdir`,
`PROGRESS.md` appears in the card's worktree and the oracle runs there.

See `PLAN-stack-multi-project.md` §4.1a for the full detail.

## Progress (latest first)

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

- [ ] **1a** Loop arms in the chat's cwd (§4.1a) — bug fix, affects every
      board-started chat
- [ ] **1b** `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD` on multi-root
      spawns, both drivers, `KANNA_STACK_MEMORY` opt-out; extract
      `buildPtyEnv` out of `driver.ts` for the headroom (§4.1b)
- [ ] **1c** Codex gets the stack block via a shared
      `buildCodexDeveloperInstructions`; provider-picker hint on a
      multi-binding chat (§4.1c)
- [ ] **2** `instructions` on project + stack: events, store, protocol, read
      models, prompt composition (`## Workspace instructions` rename), Codex
      parity, subagent parity, sidebar UI (§5) — needs an ADR
- [ ] **3** Cross-project orchestration — ADR first, then Option A (card
      dependencies) and/or Option B (stack-scoped loop); the stack activity
      rollup is independently shippable (§6)
- [ ] **4** Housekeeping: C3 component fact + eval binding, wiki
      `features/stacks.md`, deduplicate the two binding resolvers, file an
      issue for the primary-only `/` catalog (§7)
