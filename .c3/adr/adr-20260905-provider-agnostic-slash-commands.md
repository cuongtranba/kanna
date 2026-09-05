---
id: adr-20260905-provider-agnostic-slash-commands
c3-seal: 6d73a77849fa6e84b0a304e15bef0250f6c50a9825e6cdffad410e8cfbc0ff7d
title: provider-agnostic-slash-commands
type: adr
goal: Make a typed `/name args` run the local skill or command it names on **every** provider, not only the ones that happen to run the claude CLI, and make a model that has no skill machinery of its own able to discover and use those skills. Kanna already scans the whole local catalog and knows each entry's file path; it simply never opened the file. This decision has Kanna expand the invocation itself for any provider whose harness cannot, and — on Codex, whose protocol offers no way to declare a tool — inject the skill roster into `developerInstructions` so reading a named `SKILL.md` becomes the invocation.
status: done
date: "2026-09-05"
---

# provider-agnostic-slash-commands

## Goal

Make a typed `/name args` run the local skill or command it names on **every** provider, not only the ones that happen to run the claude CLI, and make a model that has no skill machinery of its own able to discover and use those skills. Kanna already scans the whole local catalog and knows each entry's file path; it simply never opened the file. This decision has Kanna expand the invocation itself for any provider whose harness cannot, and — on Codex, whose protocol offers no way to declare a tool — inject the skill roster into `developerInstructions` so reading a named `SKILL.md` becomes the invocation.

## Context

`claude` and `openrouter` both run the Claude Agent SDK with `settingSources: ["user", "project", "local"]` (`claude-session-start.ts`), so the CLI resolves `/name` against `.claude/skills` + `.claude/commands` and expands it before the model sees anything. Codex has no such step: `chat.send` carries the literal string, `claude-turn-starter.ts` hands it to `turn/start`, and the model answers `/kanna-test src` as prose.

The client hid the symptom rather than fixing it. `commandsForProvider` (`src/client/lib/slash-commands.ts`) filtered the picker down to Kanna's three builtins on codex, on the stated grounds that "disk-scanned Claude Code skills mean nothing to a provider that does not run the claude CLI". That was true of the CLI and false of the files: a `SKILL.md` is markdown instructions, and any model can follow them. The filter therefore made the entire local catalog — project, personal, and enabled-plugin scopes — unreachable on codex, with no error and no affordance hinting it existed.

`LocalCatalogService` already holds everything needed. `scanLocalCatalog` records `filePath` on every `RawCatalogEntry`; `toSlashCommand` drops it because the picker does not need it. No server code has ever read a skill BODY — `readFrontmatterPrefix` reads the first 8 KiB for metadata and stops.

Codex constrains the second half of the decision absolutely. Its app-server protocol exposes no tool-declaration surface: `ThreadStartParams` carries no `mcpServers`, `TurnStartParams` carries no `tools`, and `handleRequest` answers any unrecognised `item/tool/call` with `Unsupported dynamic tool call`. The one per-session injection point is `developerInstructions`, today fed only by workspace/stack/project instructions. Codex does run `approvalPolicy: "never"` with `sandbox: "danger-full-access"`, so a personal or plugin skill outside the project cwd is reachable by absolute path — the gap is knowledge, not permission, exactly as adr-20260904 found for stack roots.

Two modules are at their architecture-budget ceiling and constrain where code may land: `claude-turn-starter.ts` was 695 lines against the 700 threshold, and `agent-coordinator.ts` sits exactly on its 1484-line allowance.

## Decision

**One named predicate decides who expands.** `providerExpandsSlashCommands` (`provider-model-types.ts`) lists the providers whose harness does it — claude and openrouter — and everything else gets Kanna's expansion. The default direction is the load-bearing part: a provider added later and forgotten by the list gets WORKING slash commands, where a default of "the harness handles it" would silently give it none. Its membership equals `providerUsesSdkSession` today and a test pins the agreement, but the two answer different questions (how a prompt is DELIVERED versus what the prompt should BE), so they stay separate functions.

**The expansion is pure, and the file read is a port.** `src/shared/slash-expansion.ts` owns `parseSlashInvocation`, `stripFrontmatter`, `substituteArguments` (`$ARGUMENTS`, `$1..$9`) and `buildSlashExpansion`. A COMMAND expands to its substituted body verbatim, because a command file *is* a prompt and wrapping it would change what its author wrote; a SKILL gets a header naming the skill, its directory and the arguments, because `SKILL.md` is a document about how to do something rather than a request. `src/server/skill-invocation.ts` binds the catalog to a chat — resolving the cwd through the same `resolveChatCwd` the turn uses, so an expansion can never read a different project's `.claude` than the turn it starts.

**`` !`cmd` `` and `@path` survive verbatim** and the expansion adds one line telling the model to run or read them with its own tools. Executing a shell command on the send path would put arbitrary execution ahead of the turn meant to approve it, and would need an adapter, a timeout, and a permission decision this change does not want to make.

**`StartTurnForChatArgs.promptOverride` carries what the provider runs; `content` stays what the user typed.** Consumed at exactly one line — `buildPromptText(args.promptOverride ?? args.content, args.attachments)` — so the `user_prompt` entry, the optimistic title and the generated title all still read `/deploy staging` rather than a skill's whole body. `UserPromptEntry.expandedCommand` records what expanded and `UserMessage` renders one muted line; without it "the skill ran" and "your text was sent verbatim" are indistinguishable in the transcript and behave completely differently.

**Dispatch reuses the builtin sites unchanged.** `resolveSlashExpansion` is called from `sendCommand` after `parseBuiltinCommand` returns null (so `/clear` is never shadowed by a project command of that name) and after the `isChatBusy` branch (so a `/skill` typed mid-turn queues like any other message), and from `dequeueAndStartQueuedMessage` for non-steered messages only — a steered message is an injection into a live session, the same reason a builtin falls through as text there.

**The roster rides `developerInstructions`, because nothing else can carry it.** `renderSkillRosterBlock` names each skill, its description and its absolute `SKILL.md` path, capped at `KANNA_SKILL_ROSTER_LIMIT` (60) with truncated descriptions and an explicit "showing N of M" when cut. It is the only consumer of `KannaSystemPromptOptions.skills`: the Claude suffix ignores it, since the CLI loads a skill on demand while this can only inline a pointer. Applied at `thread/start`, so a skill authored mid-chat reaches the model at the next session start — `startSession` reuses a live session on a cwd match.

**The catalog gains two readers over ONE scan, and they differ on exactly one rule.** `resolve(cwd, name)` is restricted to user-invocable entries so an invocation and the picker cannot disagree about which names exist; `skills(cwd)` deliberately INCLUDES `user-invocable: false` entries, because that flag hides a skill from the picker while leaving auto-triggering intact. Both read the cached row; neither rescans.

**Every failure degrades to "send what the user typed."** An unresolvable name may be a path or a command the provider itself knows; an unreadable `.claude` directory costs a skill, while failing the send costs the turn.

**`commandsForProvider` is deleted rather than made to return its argument.** With Kanna expanding locally there is nothing left to narrow, and a function that returns its input is the shallow abstraction this repo removes. The `provider` prop it justified leaves `SlashCommandTypeaheadPlugin` with it.

Two budget-forced placements, both the remedy the budget message prescribes rather than a raised allowance: the arg/dep shapes move out of `claude-turn-starter.ts` into `claude-turn-starter-types.ts` (695 → 590 lines), and `resolveChatCwd` is extracted to `claude-session-config.ts` so the coordinator's inline copy collapses to one line and pays for the new wiring.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-231 | component | Its projection gains two readers over the same scan — `resolve` (winning entry incl. the `filePath` `list` drops) and `skills` (roster, including picker-hidden entries) — and the adapter gains a whole-file read with a size cap | c3-231#n13711@v1:sha256:af86a2523171ce2100989e5cdf43408957f4c7d723d9e30aa7fcddae8fb550b2 | Confirm IO stays in the adapter, the readers share the cached row, and precedence matches `list` |
| c3-210 | component | Owns the send pipeline and turn spawn: gains the expansion dispatch at the two builtin sites, `promptOverride` on the turn args, and the skill-roster wiring into the Codex branch | c3-210#n13714@v1:sha256:0dbda03798554f84aba3775a7e7116cda8872f4489832f1aacf6191ae698aab9 | Confirm builtin precedence, the busy-check placement, and that claude/openrouter behaviour is unchanged |
| c3-115 | component | The composer picker stops being provider-scoped: `commandsForProvider` and the `provider` prop are deleted, so every local entry is offered on every provider | c3-115#n9744@v1:sha256:5702f22725898f2c6a3245c97132ea96b510873bc6ddb90e5efad08ce2fca12a | Confirm the memoized option list stays reference-stable; ast-grep + lint:usestate gates |
| c3-211 | component | Its protocol has no tool-declaration surface, which is the reason skills reach Codex as a `developerInstructions` roster rather than a tool | c3-211#n13716@v1:sha256:e2f2154b6d6d5dfdd34496571f5cb78554a289f97efdd4b357d651bc00e6fce3 | Confirm the documented protocol surface matches codex-app-server-protocol.ts |
| c3-2 | container | N.A - ancestor named only to complete the top-down descent | N.A - ancestor escape | N.A - ancestor escape |
| c3-1 | container | N.A - ancestor named only to complete the top-down descent | N.A - ancestor escape | N.A - ancestor escape |
| c3-0 | system | N.A - ancestor named only to complete the top-down descent | N.A - ancestor escape | N.A - ancestor escape |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-side-effect-adapter | The catalog file read is new IO and lands in `local-catalog-io.adapter.ts` as `readCatalogFileBody`; `slash-expansion.ts` and `skill-invocation.ts` stay pure and take the read as a required parameter | ref-side-effect-adapter#n10468@v1:sha256:cdbf6975e8a35b0d03558be6822dfae166482c24fb86b0433f60e8167f5c91e4 | comply |
| ref-provider-adapter | The whole point is one transcript model across providers: the same `user_prompt` entry, the same turn shape, and a provider difference expressed as one named capability predicate rather than an `if` chain | ref-provider-adapter#n10435@v1:sha256:3bcf82b74f0f034db61a050837c7182691d29b77181e6f6c7805be1f2e00e180 | comply |
| ref-local-first-data | Cited by c3-231; expansion reads only files the scan already found under the project's `.claude` and `~/.claude`, adds no network call and no new data location | ref-local-first-data#n10402@v1:sha256:6c1744cb29d49192d5bb3ac1662201087df01c9ee04f38fb3f53d04844e79485 | comply |
| ref-colocated-bun-test | Every new module ships its colocated suite, and the two existing suites whose behaviour changed are extended rather than replaced | ref-colocated-bun-test#n10303@v1:sha256:2bc20e87f7c1e3aabe46c42732cca6d91bf2f72516544a2924fe9870e8df4385 | comply |
| ref-zustand-store | Cited by c3-115; deleting the `provider` prop removes a memo dependency and introduces no client state | ref-zustand-store#n10605@v1:sha256:dbc70d01ac1d611dc6a09e8e8e32d43b2566e4f95364435024f241e5109d3498 | comply |
| ref-event-sourcing | Cited by c3-210; the expansion adds one optional field to an existing transcript kind (`UserPromptEntry.expandedCommand`) and introduces no new event type — no history is rewritten and the prompt the provider ran is derived from the stored line, not stored twice | ref-event-sourcing#n12922@v1:sha256:ee0316401639d91b6d6f6b1c3615cf7eab1abbd5cbf9cef319474a29c2567775 | comply |
| ref-tool-hydration | Cited by c3-210; the expansion changes only the prompt text a turn STARTS with and never intercepts the transcript stream mid-turn, so `tool_call` / `tool_result` entries must keep hydrating and persisting exactly as on any other turn — this ADR's obligation is to leave that path untouched, and it does | ref-tool-hydration#n13092@v1:sha256:1cda574e5908fc3b6c85e5bbb9432e5edeee3a0c7d0d11e0230c45ac05c8a718 | comply |
| ref-strong-typing | Cited by c3-211; `SlashCommandExpansion`, `SkillRosterEntry` and `ResolvedCatalogEntry` are named types, and `expandSlashCommand` is a REQUIRED dep so a missed wiring is a compile error rather than a silent loss of every skill | ref-strong-typing#n10506@v1:sha256:eaa7509d80f8a56b00105ed5d46af5a604bfae2e81889e9dac7d7a095fbf5009 | comply |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-colocated-bun-test | New suites sit beside their subjects with matching basenames and run under `bun test --conditions production` | rule-colocated-bun-test#n10638@v1:sha256:2bc20e87f7c1e3aabe46c42732cca6d91bf2f72516544a2924fe9870e8df4385 | comply |
| rule-strong-typing | No `any`, no `unknown`, no cast: the ports are named function types and the catalog reader returns a structural `ResolvedCatalogEntry` rather than a widened record | rule-strong-typing#n10699@v1:sha256:eaa7509d80f8a56b00105ed5d46af5a604bfae2e81889e9dac7d7a095fbf5009 | comply |
| rule-zustand-store | Cited by c3-115; the typeahead loses a prop and gains no `useState` and no JSX-inline state logic | rule-zustand-store#n10731@v1:sha256:dbc70d01ac1d611dc6a09e8e8e32d43b2566e4f95364435024f241e5109d3498 | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| src/shared/slash-expansion.ts | New: `parseSlashInvocation`, `stripFrontmatter`, `splitArguments`, `substituteArguments`, `buildSlashExpansion`, `SlashCommandExpansion` | src/shared/slash-expansion.test.ts |
| src/shared/kanna-system-prompt.ts | New `SkillRosterEntry`, `KANNA_SKILL_ROSTER_LIMIT`, `renderSkillRosterBlock`; `KannaSystemPromptOptions.skills` consumed only by `buildCodexDeveloperInstructions` | src/shared/kanna-system-prompt.test.ts |
| src/shared/provider-model-types.ts | New `providerExpandsSlashCommands`, pinned against `providerUsesSdkSession` | src/shared/provider-model-types.test.ts |
| src/server/skill-invocation.ts | New: `createLocalSkillAccess(catalog, resolveChatCwd, readFileBody)` returning `expandSlashCommand` + `listSkills`; positional params, not an options bundle, so a forgotten wiring cannot compile | src/server/skill-invocation.test.ts |
| src/server/local-catalog.ts | `pickWinners` shared by `reduceCatalog` and the new `reduceSkillRoster`; cache row keeps `winners` + `skills`; new `resolve` / `skills` readers | src/server/local-catalog.test.ts |
| src/server/local-catalog-io.adapter.ts | New `readCatalogFileBody` + `CATALOG_FILE_MAX_BYTES` (256 KiB), null on missing / unreadable / oversized | src/server/local-catalog-io.adapter.test.ts |
| src/server/claude-send-command.ts | `expandSlashCommand` added to `SendCommandDeps` as required; `resolveSlashExpansion` + `expansionTurnArgs` called from `sendCommand` and `dequeueAndStartQueuedMessage` | src/server/claude-send-command.test.ts |
| src/server/claude-turn-starter-types.ts | New: the arg/dep shapes moved out of `claude-turn-starter.ts`, which re-exports them; gains `promptOverride`, `expandedCommand`, `listSkills` | src/server/claude-turn-starter.test.ts |
| src/server/claude-session-config.ts | New `resolveChatCwd(store, chatId)` — the one resolver shared by cron fire, expansion and the roster | src/server/agent-coordinator.ts |
| src/client/lib/slash-commands.ts | `commandsForProvider` deleted; the `provider` prop leaves `SlashCommandTypeaheadPlugin` and `ChatInput` | src/client/lib/slash-commands.test.ts |
| src/client/components/messages/UserMessage.tsx | Renders `expandedCommand` as one muted line beside `auto-sent`, no tinted pill | src/client/components/messages/UserMessage.test.tsx |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| src/shared/provider-model-types.test.ts | Asserts every provider has an answer and that `providerExpandsSlashCommands` agrees with `providerUsesSdkSession`, so the coincidence is a checkable fact rather than an assumption someone collapses | bun test --conditions production src/shared/provider-model-types.test.ts |
| src/server/claude-send-command.test.ts | Pins that codex expands while claude and openrouter are never even asked, that `content` stays the typed line, that a builtin still wins over a same-named catalog entry, that a busy chat queues instead of expanding, and that a steered message falls through as text | bun test --conditions production src/server/claude-send-command.test.ts |
| src/server/local-catalog.test.ts | Pins that `resolve` returns the same winner `list` shows (case-insensitively, with the file path) and refuses a name the picker hides, while `skills` includes it | bun test --conditions production src/server/local-catalog.test.ts |
| src/server/skill-invocation.test.ts | Pins that an unknown name, an unreadable file, an empty body, a missing catalog, an unresolvable cwd and a throwing catalog all degrade to null rather than failing the send | bun test --conditions production src/server/skill-invocation.test.ts |
| src/shared/kanna-system-prompt.test.ts | Pins the roster cap against a 300-skill input and that instructions precede the roster | bun test --conditions production src/shared/kanna-system-prompt.test.ts |
| bun run check:arch | Holds `agent-coordinator.ts` at its 1484-line allowance and refuses a new `Deps` bundle, which is what forced the positional-parameter factory and the `resolveChatCwd` extraction | bun run check:arch |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Register an `mcp__kanna__skill` tool for Codex | Its app-server protocol cannot declare one: `ThreadStartParams` has no `mcpServers`, `TurnStartParams` has no `tools`, and `handleRequest` answers an unrecognised `item/tool/call` with `Unsupported dynamic tool call`. The tool would exist and never be callable |
| Point Codex at Kanna's HTTP MCP server via `-c mcp_servers.kanna.url=...` | Genuinely available (codex-cli 0.153.4 supports streamable-HTTP servers, and sessions are keyed per chat so a per-chat endpoint would work), but it changes the spawn adapter and session lifecycle and hands Codex every other `mcp__kanna__*` tool — a much larger decision than making `/name` work, and one that deserves its own ADR |
| Keep `commandsForProvider` and have it return its argument | A function that returns its input is the shallow abstraction this repo removes, and leaving it implies a narrowing still exists |
| Expand for claude too, so one code path serves everyone | It would bypass the CLI's own skill machinery on the provider where it works best: the CLI loads a skill on demand, while Kanna can only inline the whole `SKILL.md` on every invocation |
| Execute `` !`cmd` `` and inline `@path` at send time, matching the CLI exactly | It puts arbitrary shell execution on the send path, ahead of the turn that is meant to approve it, and needs an adapter, timeouts and a permission model. The markers survive verbatim and the model runs them with the tools it already has |
| Send the expansion as the `user_prompt` content | The transcript bubble and the generated chat title would become the skill's whole body instead of the line the user typed |
| Raise the `agent-coordinator.ts` and `claude-turn-starter.ts` allowances | A pin is a defect count; raising one says the PR made #889 worse. The budget's own prescription — put the code in a module that owns it — produced the types split and the shared `resolveChatCwd`, both of which remove duplication rather than move it |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| A message that merely starts with `/` is swallowed as a command | Expansion returns null for any name the catalog does not resolve, and the message is then sent exactly as typed; the parser also requires the name to start alphanumerically so `//x` and `/ x` never match | bun test --conditions production src/server/skill-invocation.test.ts |
| A large `SKILL.md` inflates every turn it is invoked in | `CATALOG_FILE_MAX_BYTES` (256 KiB) refuses an oversized file outright rather than inlining it, and the roster is separately capped at 60 entries with truncated descriptions | bun test --conditions production src/server/local-catalog-io.adapter.test.ts |
| The Codex roster goes stale after a skill is authored mid-chat | Accepted and documented: `developerInstructions` applies at `thread/start` and `startSession` reuses a live session on a cwd match, so the roster refreshes at the next session start (`/clear`, restart, idle reap) | Manual: author a skill, `/clear`, ask the model what skills it has |
| A skill the picker hides is offered by `/name` after all | `resolve` is restricted to user-invocable winners while `skills` is not; the two projections are asserted against each other | bun test --conditions production src/server/local-catalog.test.ts |
| The catalog read throws on the send path and kills the turn | Both readers catch and degrade to "nothing local"; losing a skill is recoverable, losing the turn is not | bun test --conditions production src/server/skill-invocation.test.ts |

## Verification

| Check | Result |
| --- | --- |
| bun run test | pass — 8052 pass, 2 skip, 6 fail; the 6 are `PaneTabStrip on a phone`, reproduced identically on pristine origin/main (6b4c879a) and untouched by this change |
| bun run check | pass — typecheck (TS7) → lint → build:client → check:bundle; client entry 189301 gzip bytes against a 350000 budget |
| bun run lint | pass — eslint src/ --max-warnings=0 |
| bun run check:arch | pass — `agent-coordinator.ts` holds at 1484, `deps-bundles` unchanged at 84 |
| bun run lint:usestate && bunx ast-grep test && bun run lint:limits | pass — 19 rule tests, no violations, all 4 ESLint ceilings still tight |
| Manual: press `/` in a codex chat | Project, personal and plugin entries appear alongside the builtins |
| Manual: run `/kanna-test` in a codex chat | The reply follows the skill's instructions; the bubble still reads `/kanna-test` with a "ran the kanna-test skill" note |
| Manual: ask a codex chat what skills it has | It answers from the roster and opens one by absolute path without being told where it lives |
