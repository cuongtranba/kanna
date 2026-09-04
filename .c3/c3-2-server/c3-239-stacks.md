---
id: c3-239
c3-seal: 94efa2cb53b98024bafef6b7afb0e30b4c2638c431ea8fe7aff796d72c8f46eb
title: stacks
type: component
category: feature
parent: c3-2
goal: Bind several project checkouts into one chat, and resolve those bindings into the roots a turn may reach and the instruction blocks its prompt must carry.
uses:
    - ref-strong-typing
    - rule-colocated-bun-test
---

## Goal

Bind several project checkouts into one chat, and resolve those bindings into the roots a turn may reach and the instruction blocks its prompt must carry.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-2 Server |
| Runtime | Pure resolution on the spawn path; stack records live on the event log |
| Consumers | c3-122 (stack sidebar UI), c3-314 (activity rollup), c3-226 (prompt composition), c3-232 (stack-owned boards) |
| Boundary | Owns stack records, bindings, and their resolution; the worktrees themselves belong to c3-210, and prompt wording to c3-226 |

## Purpose

Owns what a stack IS on the server: the record, its member projects, its per-stack and per-project instructions, and the two resolvers that turn a chat's bindings into a spawn configuration and into prompt blocks. Non-goals: creating or removing worktrees, deciding prompt wording, and cross-project sequencing — that is a board concern (adr-20260904-cross-project-orchestration).

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-strong-typing | ref | Stack records and bindings are typed on the wire and never cast | must follow | A binding outlives the project it names |
| adr-20260904-project-stack-instructions | adr | Two additive events at replay priority 0; prompt block order; the solo-chat rule | must follow | applyStoreEvent has no default, so an older binary treats both as no-ops |
| adr-20260904-cross-project-orchestration | adr | Cross-project sequencing is a board edge, not a stack-scoped loop | must follow | Option B was considered and rejected |
| rule-colocated-bun-test | rule | Stack behaviour is pinned by colocated suites | must follow | event-store.stack-methods.test.ts, agent.stack-spawn.test.ts, ws-router.stack.test.ts |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| resolveSpawnPaths | OUT | A chat's bindings become one cwd (the primary) plus additionalDirectories; a chat with bindings and no primary throws rather than guessing one | c3-207 | src/server/claude-session-config.ts |
| resolveStackProjects | OUT | The ONE resolver for named roots — the spawn path and deriveChatSnapshot both call it, so the prompt and the client cannot see different roots; a deleted project keeps its last known title with projectStatus "missing" | c3-208 | src/server/claude-session-config.ts |
| resolveProjectInstructions | OUT | Which projects' instructions apply, synthesizing the solo case from chat.projectId; a project with no record or no instructions contributes no block | c3-226 | src/server/claude-session-config.ts |
| Stack event-store methods | IN/OUT | createStack, listStacks, getStack, setStackInstructions, setProjectInstructions; both instruction events replay at priority 0 | c3-202 | src/server/event-store.stack-methods.test.ts |
| stack.* WS commands | IN | stack.create (carrying instructions, since the client has no stack id before the ack), rename, remove, addProject, removeProject, setInstructions, listWorktrees | c3-208 | src/server/ws-router.stack.test.ts |
| Peer-root memory | OUT | A multi-root spawn sets CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD so each bound root's own rules load; KANNA_STACK_MEMORY=disabled opts out | c3-210 | src/server/claude-spawn-helpers.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/server/claude-session-config.ts | c3-239 Contract | Internal helper shape | src/server/claude-session-config.ts |
| src/server/read-models.ts | c3-239 Contract | Snapshot assembly order | src/server/read-models.ts |
| src/shared/kanna-system-prompt.ts | c3-239 Contract | Block wording | src/shared/kanna-system-prompt.ts |

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | A chat carries stackBindings, or none and is solo | c3-202 |
| Input — bindings | StackBinding[] on the ChatRecord, one primary and N additional | c3-202 |
| Input — projects | Project titles and instructions, looked up per binding | c3-202 |
| Output — spawn | cwd plus additionalDirectories, passed to both drivers | c3-210 |
| Output — prompt | Stack and per-project instruction blocks, plus the roots listing | c3-226 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | One chat edits several repos, obeying each one's rules | c3-122 |
| Primary path | Bindings resolve to roots and blocks at every turn start |  |
| Alternate — solo | No bindings: cwd is the project checkout, and instructions come from chat.projectId |  |
| Alternate — Codex | One working directory, so peer roots are reached by absolute path and the block says so rather than claiming they are unavailable |  |
| Failure — deleted project | The root keeps its last known title and reports projectStatus "missing" |  |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Prompt and UI disagree about the roots | A second inline resolver is reintroduced beside resolveStackProjects | A root listed in the sidebar that the prompt never names | bun run test src/server/read-models.test.ts |
| A solo chat silently loses its project instructions | resolveProjectInstructions is sourced from bindings alone | Instructions edited from the project menu take effect only inside a stack | bun run test src/shared/kanna-system-prompt.test.ts |
| Replay breaks on downgrade | An instruction event is given a non-zero replay priority | An older binary crashes rather than ignoring the event | bun run test src/server/event-store.stack-methods.test.ts |
| A loop arms in the wrong tree | setup_loop resolves the project checkout instead of the chat cwd | PROGRESS.md written beside a tree the agent is not editing | bun run test src/server/claude-loop-commands.test.ts |
