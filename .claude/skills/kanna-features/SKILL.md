---
name: kanna-features
description: Assorted Kanna product features and their load-bearing invariants — Kanban boards and the card lifecycle, hide vs delete project, resumable tus uploads and Range downloads, package auto-update (skills and plugins), the plugin system (subprocess server half, client bundle, addCommandCenterItem), and single-session import live-tail. Use whenever a task touches board-*, card_move, project.delete, uploads or tus, package-update-*, src/server/plugins/**, plugin contributions, or followed-session-registry.
---

# Kanna features — boards, projects, uploads, packages, plugins

Moved verbatim from the root `CLAUDE.md`.

## Single-Session Import Live-Tail (KANNA_IMPORT_FOLLOW_*)

`FollowedSessionRegistry` (`src/server/followed-session-registry.ts`) stat-polls
a single-session import's source Claude transcript file and re-imports the
delta as the source grows, so an imported chat that is still actively being
written to by Claude Code keeps catching up. Three env vars tune it, all
consumed in `src/server/server.ts`:

- `KANNA_IMPORT_FOLLOW_POLL_MS` — stat-poll tick interval driving
  `followedSessionRegistry.tick()`. Default `2000`.
- `KANNA_IMPORT_FOLLOW_ACTIVE_WINDOW_MS` — a single-session import only
  auto-arms tailing when the source file's mtime is within this window of
  "now" (otherwise the source is treated as already finished). Default
  `600000`.
- `KANNA_IMPORT_FOLLOW_IDLE_MS` — the registry stops following a session
  after this long with no file growth. Default `600000`.

## Hide vs Delete project — two different events

**Hide** (`project.remove` → `project_removed`) is reversible: the record stays
with `deletedAt`, and reopening the folder restores the SAME id, so its chats
come back. The snapshot therefore KEEPS hidden projects (without their
`projectIdsByPath` entry). It used to drop them, which silently orphaned a
hidden project's chats at the first log compaction.

**Delete** (`project.delete` → `deleteProjectData` in `ws-router-project.ts`)
removes everything Kanna stored: every chat through the same teardown as
`chat.delete` (which now also removes the transcript file), share tokens,
boards (`BoardStore.purgeProject` — project boards incl. archived, the
project's cards on stack boards, chat links), their git worktrees
(`--force`; branches are kept), notification mutes, the in-folder
`.kanna/{uploads,outputs,exports}` plus emptied `.kanna` / `.kanna-worktrees`
dirs, stack membership, the sidebar slot, and `dataDir/projects/<id>`. It ends
with `project_deleted`, which purges the record, so a reopened folder gets a
NEW id and nothing keyed by the old one can resurface.

**Nothing lingers in append-only logs past the next boot.** A replayed
`project_deleted` forces the boot compaction, and three logs that compaction
never touches are pruned as they load: `tunnels.jsonl` and `shares.jsonl` drop
events of chats that no longer exist, and `push.jsonl` drops the history of any
mute whose latest state is unmuted. Only `project_deleted` triggers the forced
compaction; a single `chat.delete` does not, because compaction also truncates
`tool-requests.jsonl`.

Deliberately NOT deleted: the user's own files, git branches, and Claude
Code's session files under `~/.claude/projects/` (they belong to the CLI, and
"Import Claude Code sessions" can re-import them).

## Kanban Boards — the card's lifecycle

One card is one worktree is one branch is one chat (`board-start-work.ts`).
That chain is what makes three agents on three cards safe: each has its own
checkout, so they cannot touch each other's files.

**A column's behaviour comes from its `semantic`, never its title.**
`ColumnSemantic` is `start | active | review | done`, all optional — a board
that marks none simply does not move cards, and the feature never guesses a
column from what the user called it. Only `active` and `done` drive anything.

**The card moves automatically at exactly two moments, and they are not
symmetric:**

| Moment | Who moves it | Where to |
| --- | --- | --- |
| "Start work" | Kanna (`moveToActiveColumn`) | the `active` column |
| work is finished | **the agent**, via `mcp__kanna__card_move` | `findAdvanceColumn` — one step forward |
| card reaches `done` | only ever the user | — (raises the cleanup question) |

**Why the agent moves its own card and Kanna does not.** There is no turn-end
hook, deliberately: a card takes as many turns as it takes, so "the turn ended"
is not "the work is done" — a host-side move would advance the card the first
time the agent stopped to ask a question. Instead `buildStartWorkPrompt` names
the card id and the destination column id, and asks for the move *when the work
is done and verified*. The card id has to ride the prompt because the agent has
no other way to learn it; without it the agent would have to read the whole
board back and guess which row is its own, which is why `card_move` sat unused
before this. If a deterministic signal is ever wanted, it belongs on an
acceptance oracle (the `run_verify` shape), not on the turn boundary.

**`findAdvanceColumn` picks by ORDER, not semantic** — the next column by rank
(`listColumns` sorts by it). A board names at most one `review` column while it
may hold several stages between `active` and `done`; the built-in Dev pipeline
runs `In progress → Test → QA → Deployment`, so jumping to the `review` column
would skip a stage. One step forward is the only reading that fits every
template.

**`done` is unreachable that way, on purpose.** Reaching it reports the item
CLOSED to a connected tracker (`remoteStateOfColumn`) and raises the worktree
question — merge / discard / leave (`worktree-cleanup.ts`), asked and never
performed, because a column drag is one gesture with no undo and uncommitted
work exists nowhere else. Those are the user's decisions. A board whose only
successor is `done` (the GitHub template's `Open / In progress / Closed`)
advances nothing, and the prompt then says nothing about moving rather than
improvising a destination.

**Agent-origin writes are held back from the tracker.** Every board write
carries a `CardActor`; the MCP tools attribute `{kind:"agent", chatId}`, and
`board-sync.ts` holds such a change with `heldReason: "agent_push_disabled"`
unless that binding set `allowAgentPush`. An agent advancing a card must not
silently close a real issue.

**Agent tools** (`kanna-mcp-boards.ts`, registered only with a `boardRegistry`
+ `chatId` + `projectId`): `board_list`, `board_get`, `card_move`,
`card_create`, `card_comment`. Two disciplines carried over from the
tracking-doc tools: `board_get` returns COUNTS plus a 20-card window and never
a whole board (a 5k-issue import would otherwise blow up one turn), and every
id is resolved against the chat's project before any write, so an agent cannot
reach another project's board by guessing an id.

**C3 has the decisions but not the map.** Five ADRs record why boards are
shaped as they are — `adr-20260810-boards-sqlite-store` (SQLite, not the event
log), `adr-20260811-board-column-semantics-single-source`,
`adr-20260811-board-in-the-workspace`, `adr-20260811-board-owns-its-rendering`,
`adr-20260811-card-start-work` — and they are the first thing to read before
changing this feature. Boards also shipped without a **component** fact; three
now carry it — `c3-310` (boards-domain, `src/shared/boards/**`), `c3-232`
(boards, `src/server/board-*.ts` plus the MCP and WS surfaces), and `c3-119`
(boards-ui, `src/client/**/boards/**`) — each with a `code-map.yaml` block.

## Resumable uploads (tus) and Range downloads

Uploads speak the **tus 1.0.0 protocol** at `/api/projects/<id>/uploads/tus`
(`src/server/tus-uploads.adapter.ts`, `@tus/server` + `@tus/file-store`; browser side
`tus-js-client`, lazy-imported by `src/client/lib/uploadFile.adapter.ts`, whose public
API did not change). The multipart route is gone. The reason is a Cloudflare tunnel:
it refuses any request body over 100 MB with a non-JSON page, so one request can never
carry a big file. ADR `adr-20261008-tus-resumable-uploads`, component `c3-217`.

- **`chunkSize` (8 MiB) must stay under the smallest proxy body cap in front of Kanna.**
  Without it `tus-js-client` sends the whole file in one PATCH and the cap returns
  as "Upload failed". It is load-bearing, not a tuning knob.
- **One tus `Server` per project, its FileStore inside the project** at
  `<project>/.kanna/uploads/.partial`. Finalize **hard-links** the finished partial into
  `.kanna/uploads`, which only works on one filesystem; a shared store under the data
  dir would copy every multi-GB file once more. `link()` falls back to `copyFile` on
  `EXDEV`. The `.partial` directory is not a stored name: a user file called `.partial`
  takes a counter name because the existing entry is not a regular file.
- **Finalize preserves the #1200 reuse rule** (`finalizeUploadFromFile`,
  `uploads.adapter.ts`). On `EEXIST` it compares size, then **streams** both files in
  1 MiB chunks, never `readFile` on a multi-GB file. Identical bytes return
  `reused: true`; different bytes take the next counter name from
  `getUploadCandidateNames`. Client cleanup relies on `reused` so it never deletes a file
  another attachment owns.
- **The partial is removed on tus `POST_FINISH`, not inside `onUploadFinish`.** A
  zero-length upload finishes during creation and `PostHandler` reads the upload again
  after the hook; deleting the partial in the hook made every empty file a 404. The hook
  answers `201` for the creation request (tus-js-client requires a `Location` header,
  which tus only adds for 201 or 3xx) and `200` for a PATCH.
- **A tus error body is always `{"error": "..."}`** (`onResponseError`), so the client
  can show the server's message; a 413 names the limit read live from
  `appSettings.uploads.maxFileSizeMb` (default 2048, max 51200).
- **`MAX_REQUEST_BODY_BYTES` is a fixed 128 MiB**, deliberately decoupled from the size
  setting: tus never sends more than one chunk per request, and deriving it from a
  50 GB cap would lift the body limit of every route.
- **Downloads own their Range handling** (`src/server/http-file-response.ts`).
  `Bun.serve` answers a Range request for any file-backed `Response` itself, with 206
  and **no `If-Range` check**, so `buildFileResponse` sends a satisfiable range as an
  explicit 206 slice and, when a Range header arrived but the full file is the right
  answer (stale `If-Range`, multi-range, malformed), streams the body through a plain
  `ReadableStream` so Bun does not range it. Dropping that wrapper makes a stale
  `If-Range` return 206 with a mismatched file. Validators are a **strong**
  `"<size>-<mtimeMs>"` ETag plus `Last-Modified`; `If-Range` accepts either. The ETag
  must stay strong: RFC 9110 forbids a weak tag from satisfying `If-Range`, so a browser
  download manager would restart from byte 0 instead of resuming.
- **The bare `/uploads/tus` path is tus only for `POST` and `OPTIONS`**
  (`isTusRequest`, `http-dispatcher.ts`). Every other tus verb carries an upload id, so a
  `DELETE` of an attachment stored under the name `tus` still reaches the attachment
  delete route, and `/uploads/tus/content` still serves it.
- **Tests** speak tus with plain `fetch` against the real server
  (`src/server/uploads.test.ts`) and drive the client with a fake `Upload` class passed
  as `loadTus`; no module mock. After a cut PATCH the offset is whatever the server had
  flushed, so assert a prefix and continue from the reported offset, never an exact byte
  count.

## Package Auto-Update (c3-237 + c3-312)

`PackageUpdateManager` (`src/server/package-update-manager.ts`) manages update
detection and application for three package kinds: `skill`, `claude-plugin`,
`codex-plugin`. Component facts: c3-237 (server), c3-312 (shared types/parsers),
c3-116 (PluginsSection UI). ADR: `adr-20260902-package-auto-update`.

**Six load-bearing invariants — do not violate silently:**

1. **Applies are serialized.** `applyUpdates()` throws if `status === "applying"`.
   The UI must disable the Apply button while applying. Concurrent CLI invocations
   could corrupt lock files.

2. **`unknown` is NOT `up_to_date`.** `UpdateAvailability` has four values:
   `up_to_date`, `outdated`, `partial`, `unknown`. `unknown` means the check
   failed (network error, GitHub rate-limit). Do not coerce it to `up_to_date`
   or suppress it in the UI — render a distinct state so the user knows to retry.

3. **Auto-apply defers when any chat is busy.** The `hasAnyChatBusy()` dep is
   injected into `PackageUpdateManagerDeps`. Never remove it or bypass the check
   in `maybeAutoApply` — a running CLI during an active turn can interfere with
   conversation tools.

4. **All state is in-memory; the upstream lock files are the source of truth.**
   Kanna writes no sidecar. `PackageUpdateSnapshot` and `autoApplyHistory` (capped
   at 50) are rebuilt from scratch on every check and lost on server restart.
   Never introduce a Kanna-owned `~/.kanna/packages/` file without an ADR.

5. **A skill is located upstream by its `skillPath`, never by folder base name.**
   `classifySkillUpdate` resolves the lock's `skillPath` through
   `UpstreamTreeIndex.byPath`; `byName` is a fallback for lock entries that
   record no path. A repo may vendor one skill into many agent directories —
   `pbakaus/impeccable` ships 18 copies, all at depth 3 — so a base-name index
   picks whichever tied first and compares the installed hash against a SIBLING
   copy. That reads as `outdated` forever and no update can clear it. When
   `skillPath` is present and a complete tree lacks it, the folder is gone
   upstream: do **not** fall back to a same-named folder elsewhere.

6. **A pinned skill is never offered a plain update, and never auto-applied.**
   `skills update` resolves upstream AT the lock's `ref` and exits 0 having
   changed nothing, so `InstalledPackage.pinnedRef` decides the affordance:
   `repinTarget()` (the single source read by the card, the applier, and the
   manager) names the tag to move to, and the applier issues
   `skills add <repo>/<folder>#<tag>` instead. `maybeAutoApply` and "Update all"
   both skip pinned packages — satisfying a pin means REPLACING it, which is an
   explicit choice about which version to run. The applier re-reads the lock
   after the CLI exits and fails a pinned apply whose revision did not move;
   exit 0 alone cannot distinguish an update from a no-op.

**Re-pin targets are resolved by version, never by list position.**
`resolveLatestTag` tries `releases/latest` first, then the highest semver tag via
`pickLatestSemverTag` (`src/shared/packages/tag-order.ts`). GitHub returns tags
in lexicographic-descending order, so `v20260102-production-cleanup` precedes
`v11.13.4` — reading position is what left a pinned skill with no resolvable
target. Resolution runs only for pinned packages that are behind, so it costs
nothing on an ordinary check.

**Adding a fourth package kind** requires:
- New union member in `PackageKind` (`src/shared/packages/types.ts`)
- New parser in `src/shared/packages/parse-*.ts`
- New checker adapter in `src/server/*-update-checker.adapter.ts`
- New applier adapter in `src/server/*-update-applier.adapter.ts`
- Entry in `package-update-appliers-boot.adapter.ts`
- UI changes in `PluginsSection.tsx`
- Entries in `.c3/eval/c3-237.yaml`, `.c3/eval/c3-312.yaml`, and `.c3/code-map.yaml`

**`CODEX_BINARY_PATH`** is the only env var for this feature. Defaults to
`~/.local/bin/codex`. No other behavior is env-var gated — all configuration
lives in Settings → Plugins (`PackageUpdateSettings` in `settings.json`).

## Plugin System (Paseo-parity)

Third-party plugins that compile to two bundles (a browser one and a server
one), run their server half as a **subprocess** speaking typed RPC over a unix
socket, and contribute UI to the sidebar, the chat footer and a Settings page.
Component fact: `c3-238`.

**Plugins are OFF by default** (`plugins.enabled`, `PLUGIN_SETTINGS_DEFAULTS`).
Every surface — HTTP routes, MCP tools, client host registry — stays dark until
a user opts in.

**One `PluginService` per process, via `plugins/plugin-service-host.ts`.** The
CLI, the HTTP routes and the MCP tools all drive `getPluginService()`. A second
instance would keep a second registry, so a plugin installed over HTTP would be
invisible to `plugin_list` and `reload` would restart a child no other surface
could see. Tests swap it with `setPluginServiceForTest` and MUST restore `null`.

**`install` writes BOTH bundles.** It used to build `built.client` and discard
it, which made `GET /api/plugins/:id/client.js` unserveable no matter what the
route did. `client.js` is served `no-store`: the bundle is rebuilt in place at
the same url, so a cached copy silently defeats `plugin reload` — which is the
entire point of that command.

**The compile runs in its OWN bun process, never in-process.**
`buildPluginBundles` spawns `plugin-build-child.adapter.ts` (same
`process.execPath` + script-path pattern as the plugin server child) with a
20 s deadline, one fresh-process retry, and a marker-line JSON verdict on
stdout; `buildPluginBundlesInProcess` stays exported ONLY for the child.
In-process `Bun.build` with JS plugin callbacks can wedge the whole process:
builds serialize behind a single bundle thread that parks inside the in-flight
build's MiniEventLoop (upstream oven-sh/bun#35060 / #42680; not fixed in the
pinned bun 1.3.11 CI runs). That wedge is what killed the v1.58.1 publish —
`plugin_validate > accepts the hello fixture` sat at its 60 s test timeout
with zero child processes and bun idle in `ep_poll`, every later compile
queued behind the parked thread, and the CI hang watchdog SIGKILLed the run
at 170 s (exit 137). In production the same wedge would have hung a real
install/validate/reload RPC forever. Isolation converts it into a clean
`{ok:false}` after the deadline, and is not a tax: a child compile of the
hello fixture measures ~100–200 ms, faster than the 60 s budgets the tests
used to need. The deadline path is pinned by the `stalling-build-child`
fixture test in `plugin-build.adapter.test.ts`; do not move the compile back
in-process.

**A failed RPC is `200 {ok:false}`, not a 4xx.** The transport succeeded and the
caller needs the plugin's own message; only a malformed REQUEST is a 4xx. A
well-formed id that is not installed is `404`, and a **disabled** surface is
`404` everywhere — never `403`, which would advertise that plugins exist.

**The id is validated before any path join.** It becomes a directory name
downstream, so a traversal-shaped id is rejected at the routing layer.

**Mounting cost three extractions, not three raised allowances.** Three modules
sat EXACTLY on their architecture-budget ceilings, so each got the remedy the
budget message prescribes: `SettingsPage.tsx` 2787 → 2449 (`SkillsSection.tsx`,
which the plugin-system plan itself prescribed), `KannaSidebar.tsx` 1007 → 964
(`SidebarUtilityNav.tsx` — also the natural home for plugin nav entries, which
are navigation destinations exactly like Workflows/Cron/Settings), and
`ChatTranscriptViewport.tsx`, which was two lines under the 700 threshold and so
mounts the footer panel through `PluginsFooterSlot` to keep the call site to one
import and one element.

**`usePluginContributions` is the whole wiring.** It turns the global switch into
loaded contributions in `pluginContributionsStore`. Without it every mounted
surface renders permanently empty — which is precisely the state the feature was
in for a whole phase: components written, mounted nowhere, nothing feeding them.

**Testing a component that reads a zustand store needs `renderClientMarkup`,
not `renderToStaticMarkup`.** zustand v5 serves `getInitialState()` as the
`useSyncExternalStore` SERVER snapshot, so a static render never observes a
`setState` and a working panel looks broken. That helper exists for this and
documents it.

**Installs persist through `settings.installedPlugins`, not through the
service.** `PluginService`'s registry is in-memory, so it takes an injected
`InstalledPluginStore` port: `install`/`setEnabled` write through it, and
`restore()` re-registers from the record WITHOUT recompiling, because the build
output the install produced is already on disk. `installed-plugin-store.ts`
binds that port to the normalized CRUD collection settings already had. Without
this a CLI install was invisible to the running server and every surface
reported nothing after a reboot, while the bundles sat on disk the whole time.

**Two boot points configure it, and both are deliberate.** The server wires it
in `createHttpDispatcher` — that factory runs once, already holds `appSettings`,
and using it avoids growing `server.ts`, which then sat exactly on its line-budget
ceiling (it has since dropped under the 700-line threshold and been delisted). The CLI wires it in its own `plugin` arm, because it is a
separate process. That CLI boot step is **injectable** (`preparePluginService`):
the default constructs a real `AppSettingsManager`, so a test driving
`setPluginServiceForTest` must pass a no-op or the real wiring silently replaces
its fake — which is exactly the regression that caught it.

### `addCommandCenterItem` — a plugin entry in the `/` picker

Merged **client-side**, in `src/client/lib/plugin-slash-commands.ts`. It cannot
go through `local-catalog-io.adapter.ts`: that catalog is DISK-scanned on the
server and its `scope: "plugin"` means **Claude Code** marketplace plugins
(`skills/`, `commands/`, `SKILL.md`) — a different, older feature — while a
Kanna plugin contributes at RUNTIME from an evaluated browser bundle.

**Selecting a plugin command inserts the item's `prompt` TEXT, never `/name`.**
Every other picker entry becomes a `SlashCommandNode`, whose text content is
`` `/${name}` ``, and survives because something downstream resolves that name:
`runBuiltinCommand` intercepts a builtin, and the claude CLI reads a
project/personal/Claude-Code-plugin command off DISK. A Kanna plugin command has
neither, so `/my-plugin:greet` would reach the CLI as a command it rejects — a
picker entry broken by construction. `prompt` is therefore a REQUIRED field on
`PluginCommandCenterItemInput`, and the expansion resolves entirely in the
browser before anything is sent. `$applySlashCommandSelection`
(`SlashCommandTypeaheadPlugin.tsx`) owns the two branches.

**Namespaced `<pluginId>:<name>`, and a taken name is DROPPED, not replaced** —
so a plugin can add to the picker but never shadow a builtin. The dedupe is not
belt-and-braces: `local-catalog-io.adapter.ts` already names Claude Code plugin
commands `<pluginName>:<command>`, the same shape, so the collision is real. The
prompt map is returned FROM `mergePluginCommands` rather than derived from the
item list at the call site, so a dropped item can never still answer a lookup and
hijack the catalog entry that beat it.

**Provider-independent, and always was.** A plugin entry is prompt text Kanna
inserts locally, so it works on every provider exactly as a builtin does. It
predates the catalog itself becoming provider-independent (see **Local skills on
every provider**), which is why `commandsForProvider` — the filter this merge
used to sit after — no longer exists.

**Every client `add*` needs a no-op twin in
`src/server/plugins/plugin-child-entry.adapter.ts`.** Both bundles compile from
the same entry and the server child runs it whole, so a method missing from that
mirror is not an inert call — it is a TypeError inside `contribute`, after which
the child never reports ready and the plugin dies at startup on a timeout that
names nothing. Adding `addCommandCenterItem` to the `hello` fixture is what
surfaced it.

**Deferred by the plan, so not gaps:** `addTheme`,
`addTimelineTransformer/Renderer`, `addComposerPill`, `addAttachmentSource` —
the surfaces where a bad plugin degrades the core product rather than occupying
its own page.
