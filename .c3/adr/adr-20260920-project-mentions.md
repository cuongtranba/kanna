---
id: adr-20260920-project-mentions
c3-seal: 584739e18d7315915d7935fdeeba457cd30a3295664537aad5c3edff51e4d1cd
title: project-mentions
type: adr
goal: Let a user pull a second project into a running chat by typing `@project/<name>` in the composer, so the agent gains both the intent (it is told which project the user named, and where it lives) and the reach (that project's root is granted to the provider session). The decision is to express this on the EXISTING `chat.stackBindings` field rather than as a parallel "mentioned projects" concept, and to make the turn-starter the single place the attach happens.
status: proposed
date: "2026-09-20"
---

## Goal

Let a user pull a second project into a running chat by typing `@project/<name>` in the composer, so the agent gains both the intent (it is told which project the user named, and where it lives) and the reach (that project's root is granted to the provider session). The decision is to express this on the EXISTING `chat.stackBindings` field rather than as a parallel "mentioned projects" concept, and to make the turn-starter the single place the attach happens.

## Context

Cross-project reach already exists, but only as stacks: `chat.stackBindings` feeds `resolveSpawnPaths` (`claude-session-config.ts`), which maps the primary binding to `cwd` and the rest to `additionalDirectories` (SDK) / `--add-dir` (PTY), and `resolveStackProjects` renders the `## Stack projects` system-prompt block (adr-20260617-adr-20260617-stack-projects-system-prompt). Project instructions for every bound project ride the same field through `resolveProjectInstructions`.

The field was writable in exactly one place: the `chat_created` event (`event-store-write-ops.ts`). So the decision to work across projects had to be made before the first message, from the sidebar's stack row. A user who is already mid-conversation and realises they need a second repo has no gesture at all — they must open a new chat.

adr-20260904-cross-project-orchestration states the constraint this repo holds itself to: anything proposed here must be reachable from a gesture the user already makes on day one, or it repeats the `orchestration-core` mistake of shipping an unreachable engine. Typing `@` in the composer is exactly such a gesture; it already opens a picker carrying two mention kinds (`@agent/<name>`, `@<file-path>`) through `MentionNode` and `MentionTypeaheadPlugin`.

## Decision

A third mention kind, `@project/<slug>`, namespaced like `@agent/<name>` because a bare `@foo` already means a file path and would collide with the path suggester.

Selecting one from the picker inserts a `MentionNode` whose wire text is `@project/<slug>`. On send, the turn-starter resolves the slug and appends that project to `chat.stackBindings` as `role: "additional"` with `worktreePath = project.localPath`. When the chat had no bindings, its own project is seeded as `primary` at its existing `localPath`, so the working directory does not move.

Four decisions carry the weight:

D1 — Write into `stackBindings`, do not mint a parallel concept. Spawn paths, the prompt block, and project instructions all already read that field; a separate list would duplicate three resolvers that exist.

D2 — Attach at the turn-starter, not in `sendCommand`. `claude-turn-starter.ts` is the single point where the chat record, its project, `resolveSpawnPaths`, `resolveStackProjects` and `resolveProjectInstructions` are all in scope. One call site there covers a user send, a queued dequeue, a cron fire, a loop wake and a retry; placing it in `sendCommand` would need the same code mirrored at `dequeueAndStartQueuedMessage` and would still miss the rest.

D3 — A mention never sets `stackId`, and may bind a project that is not a member of the chat's stack. `buildCreateChatEvent` requires a bound project to be a stack member; an ad-hoc mention is by definition not a stack decision, so `buildAttachChatProjectsEvent` passes no stack to the shared validator and leaves `stackId` alone.

D4 — Slugs come from one pure shared function used by both sides. Project titles are the `localPath` basename and can collide, so `buildProjectMentionIndex` qualifies BOTH colliding sides with their parent segment over an id-sorted list, making the result independent of input order. Server resolution tries the exact slug first, then falls back to a unique-basename match, so a slug minted by a client with a slightly stale project list still resolves.

The cost is one provider-session respawn on the first mention, because `spawnClaudeTurn` compares `session.additionalDirectories` and rebuilds when it differs. The respawn resumes via `sessionToken`, which `closeClaudeSession` does not clear, so the conversation survives.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-0 | system | The system boundary containing every component this decision touches | c3-0#n3@v1:sha256:c9f10a833b3e499d1329f9637c65ac8e7c7b9f78b6210e91ff3f44b8d31e38bc | Confirm the gesture stays reachable from the composer and adds no new external surface |
| c3-1 | container | Owns the React client; holds both the picker hook and the composer nodes changed here | c3-1#n9364@v1:sha256:e6ee951578f4d61705ac19fe636ff75594655216f900a12ae302ea0a1d8607a8 | Confirm reference stability and the design gate across both client changes |
| c3-2 | container | Owns the event-sourced server; holds the new event, its write op and the attach choke point | c3-2#n10256@v1:sha256:87984e312939cc03eed326c220cafc5c1bc82c40e789678100477a162a4901ce | Confirm the event folds identically live and on replay, and that IO stays in adapters |
| c3-3 | container | Owns the shared contracts both sides import; holds the mention grammar and the prompt builder | c3-3#n12462@v1:sha256:14758c535c5f7fc755f25004ead7b6d64058321bc3599252e111f640e63dc53e | Confirm the type lives in src/shared once and is not re-exported through types.ts |
| c3-301 | component | Owns the shared domain types; gains src/shared/project-mention.ts, the one definition of the mention grammar and the slug index both client and server read | c3-301#n12487@v1:sha256:f052cf0299d7d5dbfada18fbbf1a7e952442b4016787c6c30723382112309b38 | Confirm named boundary types, no any / unknown, colocated test |
| c3-210 | component | Owns turn start and the event store; gains the chat_projects_attached event, buildAttachChatProjectsEvent, and the attach call in claude-turn-starter.ts | c3-210#n10774@v1:sha256:ca6753652cc74facb772fe9c0b2c181c8ccf8285292b29d8bde2240ded58671b | Confirm the new event replays, and that the attach is the single choke point |
| c3-110 | component | Owns the client hooks feeding the composer; gains useProjectSuggestions reading the sidebar snapshot | c3-110#n9621@v1:sha256:8d467214a2dbc5cf341cd31b54660de18b2f9baef295c94a728736a1b1c49b29 | Confirm the store selector returns a stable reference (React #185) |
| c3-115 | component | Owns the Lexical composer; MentionNode gains the project kind and MentionTypeaheadPlugin a third option group | c3-115#n9886@v1:sha256:55ff85bd7e08123ceb990d355fef4d00d2c8d3638acd072d817d80d3383ef86f | Confirm the design gate: no new inline tint pairing, no native title |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-colocated-bun-test | Cited by c3-210; three new modules and three widened ones need tests beside them | ref-colocated-bun-test#n13031@v1:sha256:9490f9305f79ff29d492d099b81c1227c5d277e4a16bf251c1779ddc338f4be8 | comply |
| ref-cqrs-read-models | Cited by c3-110; the picker reads the existing sidebar read-model and adds no new projection or transport | ref-cqrs-read-models#n13064@v1:sha256:768802027896fc8c9ebd415cf63483f64e0c5f2f4bc10f21079a8f7d51c38dcd | N.A - no read-model added; PeerWorktreeStrip already renders resolvedBindings |
| ref-tool-hydration | Cited by c3-210; this decision normalizes no tool call and touches no hydration path | ref-tool-hydration#n13267@v1:sha256:376e5fee261bd3b463633f19523020439854d9bd11ddc28ff5cffe12d8ed485e | N.A - no tool-call hydration touched |
| ref-ws-subscription | Cited by c3-110; the attach rides the turn-start path, so no WS command or topic is added | ref-ws-subscription#n13300@v1:sha256:856dbc5b26887801a91ee1acf2a59bd940bd7592ddaa57b46a8689de86dd07cc | N.A - no WS surface changed |
| ref-zustand-store | Cited by c3-115; the new hook reads an existing store and adds no store or action | ref-zustand-store#n13333@v1:sha256:53e3365a2350860110617c32292965a5051709854e758fc7470752136627d86e | comply - selector returns a module-level EMPTY, no new store |
| ref-local-first-data | chat_projects_attached is a new record persisted to the local chats log; the binding must survive a restart with no server-side store | ref-local-first-data#n13130@v1:sha256:6b71d8a9c2f48d47b9acda0a867f9936d76727141dc2efbbdfead90101e7fd49 | comply - appended to the existing chats log, no new storage |
| ref-side-effect-adapter | The decision needs a filesystem existence check, which domain code may not perform directly | ref-side-effect-adapter#n13195@v1:sha256:d97da3a35cbbfc743202e4b37a53c5ae837c6f8c802bdd22685991e0bfe439ee | comply - pathExists is injected as a typed parameter and supplied from the existing project-paths-io.adapter leaf |
| ref-strong-typing | The mention grammar, the slug index and the attach decision all cross the client↔server and log↔read-model boundaries and must be named types | ref-strong-typing#n13234@v1:sha256:390cd8fee6d22c17530c1b9551d02cbd40ea33c56574b7ebc313f21961a707af | comply — ProjectMentionIndex, MentionableProject, MentionedProjectAttachArgs, ProjectSuggestion |
| ref-event-sourcing | chat_projects_attached is a new persisted event and must fold identically on live append and on replay | ref-event-sourcing#n13097@v1:sha256:1ff5f5fcbeeb85e1ccfe24b3e3e63babaec81436d2a50381b8e0b560132fd0aa | comply — replay arm, priority arm, and a replay-equivalence test |
| ref-provider-adapter | The granted root must reach both Claude drivers identically, and the prompt block is built once for both | ref-provider-adapter#n13163@v1:sha256:6c354267518fab769e6ba895dc71c3d27f8216ea10e1cb84a52a488e8ff7e972 | comply — no driver branch; resolveSpawnPaths already feeds SDK additionalDirectories and PTY --add-dir |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-zustand-store | Cited by c3-115; the mention selection is a Lexical editor update, not a store transition, so no inline JSX state logic is introduced | rule-zustand-store#n13459@v1:sha256:f4987b0b2521426050c0c2a5307760c102f3ed1e0a9334b074ed1913fe818f64 | comply - verified by bun run lint:usestate and bunx ast-grep test |
| rule-mcp-name-reserved | Cited by c3-232; this decision registers no MCP server and no tool | rule-mcp-name-reserved#n13398@v1:sha256:14b198db67176b15a6f8ec8867c7a09d1960aec6a98bb33e1fc658ec05e52de3 | N.A - no MCP surface touched |
| rule-strong-typing | Every new export crosses a boundary; the repo bans any, both cast spellings, and unknown in every position | rule-strong-typing#n13427@v1:sha256:7e110467821b764c655f13db69c1331592e23c71af38ac5825037c97b15ea180 | comply |
| rule-colocated-bun-test | Three new modules and three widened ones need tests beside them | rule-colocated-bun-test#n13366@v1:sha256:ce58e026c1076cb18ede38f3a4bd73793f28bf1392d299399571ba446985623f | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Mention grammar | New pure module: pattern, slug index with collision qualification, slug parser, two-stage resolver | src/shared/project-mention.ts + .test.ts |
| System prompt | renderStackProjectsBlock states what an @project/<name> mention means, so the agent reads it as intent | src/shared/kanna-system-prompt.ts |
| Event | chat_projects_attached variant, log routing, replay priority, apply arm, replay arm | src/server/events.ts, event-store-helpers.ts, event-store-apply.ts, event-store-chat-lifecycle.ts |
| Write op | buildAttachChatProjectsEvent over a validator extracted from buildCreateChatEvent, so the two cannot drift | src/server/event-store-write-ops.ts, event-store.ts |
| Attach decision | Pure decision taking explicit args and a lazy project list, so a message with no mention touches no store | src/server/project-mention-attach.ts + .test.ts |
| Turn start | One call before resolveSpawnPaths, swallowing its own failure | src/server/claude-turn-starter.ts |
| Picker | Hook over the sidebar snapshot with a module-level EMPTY, third option group, project mention kind | src/client/hooks/useProjectSuggestions.ts, MentionNode.tsx, MentionTypeaheadPlugin.tsx |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| src/server/claude-turn-starter.test.ts | Asserts the attach lands, that cwd does not move, that the granted root reaches the spawn as additionalDirectories, and that a message with no mention touches nothing | bun run test src/server/claude-turn-starter.test.ts |
| src/server/event-store.stack-methods.test.ts | Asserts the event replays to identical state, that an unchanged write appends nothing, and that a non-stack-member may be attached | bun run test src/server/event-store.stack-methods.test.ts |
| src/shared/project-mention.test.ts | Pins collision qualification, order independence, and the stale-basename fallback | bun run test src/shared/project-mention.test.ts |
| bun run lint:usestate | ast-grep refuses an unstable store-selector fallback in the new hook | bun run lint:usestate |
| bun run check:arch | Refuses a new export * in types.ts and a new *Deps bundle in src/server | bun run check:arch |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| A bare @<project-name> mention | @foo already means a file path here (useMentionSuggestions → /api/projects/:id/paths), so the picker and mention-parser would both need a disambiguation rule, and a project named like a top-level directory stays genuinely ambiguous |
| Prompt-only: name the project and its path, grant no access | The agent would hit permission friction on every read outside cwd; additionalDirectories is the thing that pre-authorises it, and granting it is one field on data the chat already carries |
| Promote the chat to a full stack on mention | Rewrites stackId, needs a worktree choice per project and touches board sync — a heavyweight, undoable consequence for one keystroke |
| A new WS command for attaching | ws-router-dispatch-arms is an exact ratchet at 106 and the flat switch has no exhaustiveness check; the turn-starter choke point needs no new command at all |
| Resolve mentions client-side and send an id list | The wire text is what the transcript bubble and the generated title show; a second structured channel would let the two disagree about which projects a message named |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Two projects share a basename and a mention binds the wrong repo with write access | Collisions qualify BOTH sides with the parent segment, and an ambiguous bare basename resolves to nothing rather than guessing | Test: qualifies BOTH sides of a basename collision; resolveProjectMentions("@project/api", colliding) yields no project |
| The granted root no longer exists on disk and --add-dir fails the CLI spawn | The decision skips any project whose localPath fails pathExists | Test: skips a project whose path is gone from disk |
| The mid-chat respawn loses conversation context | The respawn resumes via sessionToken, which closeClaudeSession does not clear | Manual: reload, send again, confirm the model still has the conversation and no second respawn occurs |
| The attach throws and takes the turn down | The call is wrapped; a failure logs and the turn proceeds without the extra root | Test: every other turn-starter test runs through this call unchanged |
| The store read costs a list allocation on every turn | The decision parses for a mention first and only then calls the project-list thunk | Test: never reads the project list for a message with no mention |

## Verification

| Check | Result |
| --- | --- |
| bun run test | 8310 pass, 6 fail — the 6 are PaneTabStrip on a phone, reproduced identically on the base commit f937ed0d with no changes applied |
| bun run check | pass (typecheck, lint, lint:comments, build:client, check:bundle) |
| bun run lint:usestate | pass |
| bunx ast-grep test | 19 passed, 0 failed |
| bun run check:arch | 69 pass, 0 fail |
| bun run test src/server/claude-turn-starter.test.ts | 27 pass, 0 fail |
| bun run test src/server/event-store.stack-methods.test.ts | 41 pass, 0 fail |
