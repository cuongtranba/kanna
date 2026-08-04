---
id: adr-20260804-project-scoped-slash-command-catalog
c3-seal: 38e16c5378b2f91cd24a319fbce92abba54f69d50689a4c7d0132111b87b3ab2
title: project-scoped-slash-command-catalog
type: adr
goal: Move the composer `/` picker's command catalog off chat state and onto a project-scoped `project-commands` subscription topic, delete the async load and its `slashCommandsLoading` flag entirely, and surface the skills of *enabled* plugins under the command names the Claude Agent SDK actually accepts.
status: accepted
date: "2026-08-04"
---

# project-scoped-slash-command-catalog

## Goal

Move the composer `/` picker's command catalog off chat state and onto a project-scoped `project-commands` subscription topic, delete the async load and its `slashCommandsLoading` flag entirely, and surface the skills of *enabled* plugins under the command names the Claude Agent SDK actually accepts.

## Context

Pressing `/` in a freshly opened chat showed a loading skeleton that never resolved. The disk scan was never the cause — measured 1.5 ms warm / 15 ms cold for 41 entries, and every server-side load completed instantly.

The defect was a dual-store split, and it was deterministic. `ws-router` fired `void agent.ensureSlashCommandsLoaded(chatId)` on chat subscribe; that ran synchronously up to its first `await`, so the chat was still in `slashCommandsInFlight` when the same handler fell through to `pushSnapshots` (whose body is also synchronous). The first full `ChatSnapshot` therefore *always* shipped `slashCommandsLoading: true, slashCommands: []`. That snapshot armed the `chat.ops` delta path, and every later update — including the finished list — arrived as a `sections.set` delta, which the client folds into `chatSnapshot` but never into `slashCommandsStore`, the only store the picker reads. Chats with a previously persisted list skipped the load, which is why the hang looked intermittent.

Underneath sat the real modelling error: the catalog was chat state. It was persisted per chat (`session_commands_loaded`), replayed at startup, and re-sent inside every chat snapshot, though it derives purely from the project's cwd. That is what forced the async load, the in-flight set, and the loading flag into existence. The persistence was also lossy — it normalised away `kind` and `scope`, so restored chats lost their `skill` badges.

Separately, `localCommandsForCwd` filtered to `scope ∈ {project, personal}`, dropping 30 of 41 scanned entries. Those entries could not have been trusted anyway: plugin discovery walked `~/.claude/plugins/marketplaces/*` and namespaced by a longest-prefix guess over each marketplace manifest's `source` fields. Where every plugin declares `source: "./"` (the `anthropic-agent-skills` layout) that guess picks one arbitrarily, labelling every skill in the marketplace with a single wrong plugin prefix — `/name` values the SDK rejects. It also surfaced disabled plugins and a marketplace's own test fixtures.

## Decision

The catalog is a property of the project's cwd, so serve it as one: a `{ type: "project-commands", projectId }` subscription topic whose envelope is built inline from `localCommandsForCwd`. It is a synchronous disk read behind an mtime-validated cache, so there is nothing to await, no in-flight state, and no loading flag to strand. The client keys `slashCommandsStore` by project, so opening another chat in the same project renders from cache with no round trip. `ChatSnapshot.slashCommands`, `.slashCommandsLoading`, both `chat.ops` section keys, `ensureSlashCommandsLoaded`, `slashCommandsInFlight`, and the `session_commands_loaded` event are all deleted.

Cache freshness moves from a blind 30 s TTL to mtime stamps over the scanned roots, the settings files that gate plugins, and every scanned file — directory mtimes alone cannot see an in-place `SKILL.md` edit. The TTL survives only as a long backstop ceiling. Without an injected `statMtimes` port the service caches nothing, so a mis-wired construction is always-correct rather than silently stale.

Plugin discovery is driven by the three files that actually decide invocability — `settings.json` `enabledPlugins` (personal, overridable per project), `installed_plugins.json` `installPath`, and the marketplace manifest's per-plugin `skills[]` subset — instead of by walking the plugins tree. A plugin skill's frontmatter `name` replaces only the last segment of the command, per the current Claude Code docs. An enabled plugin with no install on disk is skipped, never guessed at. The scope filter in `localCommandsForCwd` is then dropped, and the picker ranks project/personal skills above plugin ones so the user's own commands are not buried.

This supersedes `adr-20260724-slash-picker-local-only`, which decided both the chat-scoped load and the plugin-scope exclusion. Its plugin exclusion was a blunt fix for real noise (disabled plugins, test fixtures, mislabelled namespaces); resolving plugins correctly removes the noise at its source instead of hiding the whole scope.

`STORE_VERSION` is deliberately NOT bumped. A version mismatch is fail-closed — `clearStorage()` wipes the user's entire chat history — so shipped `turns.jsonl` files keep carrying `session_commands_loaded` lines until the next compaction and must stay replayable.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-0 | system | The picker is a user-facing surface of the whole product; this decision changes what it lists and when it appears | c3-0#n3@v1:sha256:c9f10a833b3e499d1329f9637c65ac8e7c7b9f78b6210e91ff3f44b8d31e38bc "${GOAL}" | No system-level contract changes |
| c3-1 | container | Hosts the composer and the picker store whose keying changes from chat to project | c3-1#n6067@v1:sha256:e6ee951578f4d61705ac19fe636ff75594655216f900a12ae302ea0a1d8607a8 "Render the chat experience: hydrate transcripts, accept input, drive sidebar/settings, and stay synchronized with server state via WebSocket subscriptions." | Confirm the new subscription follows the container's WS-sync shape |
| c3-2 | container | Hosts the catalog service, the new topic's envelope branch, and the retired event | c3-2#n6705@v1:sha256:87984e312939cc03eed326c220cafc5c1bc82c40e789678100477a162a4901ce "Run the local Bun backend: serve HTTP+WebSocket on localhost, coordinate Claude + Codex agent turns, persist events, and broadcast derived read models." | Confirm the retired event leaves replay intact |
| c3-231 | component | Its documented cache was a 30 s TTL and its Business Flow said the coordinator loads the list into ChatSnapshot.slashCommands on chat-open; the cache is now mtime-validated, the consumer is the project-commands envelope, and plugin scope is resolved from enabledPlugins rather than a marketplace walk | c3-231#n8375@v1:sha256:de08e3cd5163c0059a0b60802ae55a330c650814345c52d73b13a0a8e677624c "Scan local Claude Code skills and slash commands (project, personal, plugin) on disk so the composer / picker surfaces every locally invocable entry, not only what the CLI system_init happens to emit." | Foundational Flow, Business Flow, Contract, and Change Safety rows rewritten |
| c3-210 | component | Its governance row claimed the coordinator loads the local list into ChatSnapshot.slashCommands on chat-open; the coordinator no longer owns any slash-command path | c3-210#n7207@v1:sha256:ca6753652cc74facb772fe9c0b2c181c8ccf8285292b29d8bde2240ded58671b "Drive turn lifecycle across providers: start/cancel/resume Claude + Codex sessions, emit normalized transcript events." | c3-231 governance row retargeted |
| c3-115 | component | Its governance row said the picker consumes a merged slashCommands list; the picker now reads a project-keyed store fed by one topic, with no merge and no loading state | c3-115#n6509@v1:sha256:23c91d475ffd6af99a4cfef9b144d312992841e532d43bb60bffc51eb9bd07e6 "Owns the composer and surrounding chrome: Lexical rich-text editor input, provider/model/effort pickers, attachment controls, queued message indicator, send action. Non-goals: transcript rendering, server command execution, chat history." | c3-231 governance row and the picker Business Flow row retargeted |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-side-effect-adapter | The new statMtimes freshness port and the rewritten plugin scan are both IO; they must stay inside local-catalog-io.adapter.ts and reach the service only through injection | ref-side-effect-adapter#n8950@v1:sha256:0f7e313537878f2b9a40701637fa22c1081236a88c5738c704244e97f3e0ddc3 "Two-shape adapter convention, both colocated next to the module that owns the port:" | comply |
| ref-local-first-data | Plugin resolution reads three more local files (settings.json, installed_plugins.json, marketplace manifests) and must stay network-free | ref-local-first-data#n8883@v1:sha256:6b71d8a9c2f48d47b9acda0a867f9936d76727141dc2efbbdfead90101e7fd49 "All persistent state sits under ~/.kanna/data; the server binds to 127.0.0.1 by default and only exposes wider surfaces (LAN, tunnel) when the user opts in." | comply |
| ref-colocated-bun-test | Every new behaviour — mtime validation, plugin resolution, the topic, the project-keyed store, the replay tolerance — lands with a colocated test | ref-colocated-bun-test#n8784@v1:sha256:9490f9305f79ff29d492d099b81c1227c5d277e4a16bf251c1779ddc338f4be8 "Tests sit next to the file under test, named *.test.ts(x), and run under bun test — no separate test directory, no framework churn." | comply |
| ref-provider-adapter | Cited by both c3-210 and c3-115; the catalog is provider-shaped state, and the picker stays gated on the Claude provider — this change must not introduce a per-provider branch anywhere else | ref-provider-adapter#n8916@v1:sha256:6c354267518fab769e6ba895dc71c3d27f8216ea10e1cb84a52a488e8ff7e972 "Normalize Claude Agent SDK and Codex App Server into one transcript + tool-call model so the UI never branches on provider." | comply |
| ref-event-sourcing | Cited by c3-210; retiring session_commands_loaded removes a writer from the log, so replay of existing logs must still be exact | ref-event-sourcing#n8850@v1:sha256:1ff5f5fcbeeb85e1ccfe24b3e3e63babaec81436d2a50381b8e0b560132fd0aa "Every state mutation is first captured as an immutable event appended to a JSONL log; system state is derived by replay + periodic snapshot compaction." | comply |
| ref-zustand-store | Cited by c3-115; the picker's store is rekeyed from chat to project and loses a field, so it must stay a small concern-scoped Zustand store | ref-zustand-store#n9086@v1:sha256:53e3365a2350860110617c32292965a5051709854e758fc7470752136627d86e "Client UI state lives in small Zustand stores scoped by concern (chat input, preferences, sidebar, terminal), persisted selectively via localStorage." | comply |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-colocated-bun-test | Cited by c3-210; every file this change adds or rewrites carries a sibling *.test.ts | rule-colocated-bun-test#n9119@v1:sha256:ce58e026c1076cb18ede38f3a4bd73793f28bf1392d299399571ba446985623f "Every Kanna test must sit next to the file under test, share its basename, and run under bun test." | comply |
| rule-zustand-store | Cited by c3-115; slashCommandsStore is rewritten (byChatId → byProjectId, loading state deleted) and must keep all of that transition inside the store | rule-zustand-store#n9212@v1:sha256:f4987b0b2521426050c0c2a5307760c102f3ed1e0a9334b074ed1913fe818f64 "All client state in Kanna lives in Zustand stores, and so does every transition of it." | comply |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| SECTION_KEYS guard test | Fails if any slash-command key is reintroduced as a chat.ops section — pins the bug class (picker data reachable only through a delta the picker never observes), not just the one field | src/server/chat-ops-diff.test.ts |
| project-commands first-frame test | Asserts the catalog is in ws.sent[0], inverting the original defect | src/server/ws-router.test.ts |
| Retired-event replay test | Initializes a store over a real turns.jsonl carrying a legacy session_commands_loaded line and asserts nothing was wiped; goes red if STORE_VERSION is ever bumped to "migrate" | src/server/event-store.test.ts |
| getReplayEventPriority retired-type test | Pins that a retired type still in a replayed log is priced rather than thrown on, unlike orch_* whose whole jsonl left the replay set | src/server/event-store-helpers.test.ts |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Fold chat.ops sections.set into slashCommandsStore (~20 lines) | Fixes the symptom while keeping the wrong model: a cwd-derived list persisted per chat, replayed at startup, and re-sent in every chat snapshot. The second store remains, so the same class of bug returns with the next picker field. |
| Keep plugin scope excluded and only fix the loading bug | The exclusion was itself a workaround for broken namespacing; the user's 19 invocable plugin skills stay invisible while the picker claims to list what is invocable. |
| Add an fs watcher for live catalog updates | New long-lived IO for a 1.5 ms read that already refreshes on demand. mtime stamps give the same freshness for add/remove/edit at no standing cost. |
| Bump STORE_VERSION and migrate the log | A version mismatch calls clearStorage() — it would delete every user's chat history to retire a derived, disposable field. |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| A future retire drops a case from getReplayEventPriority and breaks startup on shipped logs | RETIRED_EVENT_TYPES prices retired types explicitly and is documented at the definition; the exhaustive throw still guards genuinely unknown types | bun test src/server/event-store-helpers.test.ts src/server/event-store.test.ts |
| Plugin resolution reimplements CLI internals and drifts as Claude Code evolves | Fixture tests pin each rule (enabled gating, installPath, declared subset, colon stems, frontmatter name); unresolvable plugins are skipped rather than guessed | bun test src/server/local-catalog-io.adapter.test.ts |
| The larger list (11 → ~30 entries) reads as noise | Scope-ranked filtering keeps project/personal skills above plugin ones in every match tier | bun test src/client/lib/slash-commands.test.ts |
| mtime stamps miss a change no stamped path reflects | The TTL ceiling remains as a backstop; the stamp set covers roots, per-file mtimes, and the settings files that gate plugins | bun test src/server/local-catalog.test.ts |

## Verification

| Check | Result |
| --- | --- |
| bun test | 3991 pass, 39 pre-existing failures unchanged from origin/main baseline (@lexical dependency init, unrelated) |
| bun run typecheck | clean |
| bun run lint (--max-warnings=0) | clean |
| bunx ast-grep test | 14 passed |
| Emitted plugin names vs the CLI's own list on this machine | exact match: skill-stack:go:audit, document-skills:xlsx, claude-api:claude-api, ymir:ymir, … (19 entries; disabled plugins and marketplace test fixtures absent) |
| Manual (real binary): press /, then open a second chat in the same project and press / immediately | list paints with no skeleton; present on the first keystroke with no round trip |
| Restart against existing ~/.kanna/data | history intact, no "Resetting local history" warning |
