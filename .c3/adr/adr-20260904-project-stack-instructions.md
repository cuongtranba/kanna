---
id: adr-20260904-project-stack-instructions
title: project-stack-instructions
type: adr
goal: Record why per-project and per-stack instructions are two new event types on the existing logs rather than a settings field, and how they compose into the system prompt on every provider.
status: proposed
date: "2026-09-04"
---

# adr-20260904-project-stack-instructions

## Goal

Record why per-project and per-stack instructions are two new event types on the existing logs rather than a settings field, and how they compose into the system prompt on every provider.

## Context

A Kanna user works in several registered projects at once. Stacks bind N projects into one chat, and both drivers already grant filesystem access to every bound root (SDK `additionalDirectories`, PTY `--add-dir`), with `## Stack projects` naming them in the prompt since adr-20260617.

What was missing is each project's own conventions. The only instruction field was `globalPromptAppend` — ONE string in app settings, rendered under the heading `## Project instructions`, which is a misnomer: it is global, not per project. So a stack chat could write project B while being told only about the workspace-wide rules and project A's implicit context.

adr-20260802 retired `orchestration-core` for being unreachable from any user gesture. Anything added here has to be reachable on day one, which constrains this to fields on entities the sidebar already renders.

## Decisions

### D1 — Two new event types, not a settings field

`project_instructions_set {projectId, instructions}` and `stack_instructions_set {stackId, instructions}` join `ProjectEvent` and `StackEvent`, logged to `projects` / `stacks`.

The alternative — a map keyed by project id inside `settings.json` — was rejected because projects and stacks are event-sourced entities with a lifecycle (created, renamed, deleted, replayed) and settings are not. A settings map would have no answer for a deleted project, would not replay with the entity, and would put half of a project's identity in one store and half in another. `app-settings.ts` also carries a pinned `settings-bound-throws` pattern budget of exactly 14 `throw new Error(` lines, so validation would have had to move anyway.

Both events replay at priority **0**, beside their siblings. A missing case in `getReplayEventPriority` is not a warning — it is bucket 99 and a silently misordered replay.

### D2 — Both events are additive and downgrade-safe

`applyStoreEvent` has no `default` case, so a binary predating these events treats them as no-ops rather than crashing. That is what makes the pair safe to ship without a log migration: an older build reading a newer log loses the instructions and nothing else. Pinned by a replay test.

### D3 — The instruction cap is `GLOBAL_PROMPT_APPEND_MAX_CHARS`, exported rather than duplicated

Every instruction block is spent from the same context window as the global one, so a second, differently-chosen number would only be a second thing to get wrong. The existing constant is exported from `app-settings.ts` and reused by both builders.

### D4 — Absent and empty are the same thing

`instructions?: string`. A builder trims, and a value that trims to empty is stored as absent; the prompt renders only non-empty entries. There is no "explicitly blank" state to preserve, and modelling one would put a distinction in the type that no reader could act on.

Builders return `null` when the value is unchanged, matching `buildRenameStackEvent` — an unchanged write appends no event.

### D5 — A solo chat gets its project's instructions too

This is the decision most likely to be got wrong by reading only the prompt code. `resolveStackProjects` returns `[]` for a chat with no `stackBindings`, which is every solo chat — so sourcing per-project instructions from bindings alone would ship a feature that works only inside stacks, while the field is edited from the ordinary project menu.

The resolver therefore synthesizes a single-entry list from `chat.projectId` when there are no bindings. One consequence is deliberate: a solo chat now renders a `## Project instructions — <title>` block where before it rendered none. The `## Stack projects` block is still gated on real bindings, so a solo chat does not grow a roots listing.

### D6 — The global block is renamed `## Workspace instructions`

Leaving two different things both called "Project instructions" is the comprehension hazard adr-20260802 was written about. The global setting becomes `## Workspace instructions`; `## Project instructions — <title>` is per project. The rename is user-visible in the Settings copy and is made in the same commit as the tests that pin it.

### D7 — Order is BASE, workspace, stack, per-project, roots, roster

```
KANNA_SYSTEM_PROMPT_BASE
## Workspace instructions      (global setting)
## Stack instructions          (stack.instructions)
## Project instructions — T    (one per bound project with instructions)
## Stack projects              (title + role + path)
## Available subagents
```

`KANNA_SYSTEM_PROMPT_BASE` stays first so the refusal policy is read before any user-controlled text; that ordering rule predates this ADR and is not ours to relax. Broad-to-narrow after it: workspace rules, then how the projects relate, then each project's own rules, then the paths those names map to.

### D8 — Parity across providers and into subagents is part of the feature

Claude via `buildKannaSystemPromptAppend`, Codex via `buildCodexDeveloperInstructions`, subagents via `composeSubagentSystemPrompt`. A subagent that can write project B needs B's rules as much as the main agent does; a Codex chat that silently drops them is the same defect this program just fixed for the stack block itself.

## Consequences

- A wide stack's prompt grows by one block per project with instructions. Bounded per entry by D3 and rendered only when non-empty.
- Two more event types on the `projects` and `stacks` logs. Both are small and written only on an explicit user edit.
- The `## Project instructions` heading changes meaning. Anything asserting on the old string for the GLOBAL block must move to `## Workspace instructions` — the drift is caught by `kanna-system-prompt.test.ts`, not by review.
