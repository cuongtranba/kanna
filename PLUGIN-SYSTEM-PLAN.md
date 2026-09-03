# Kanna Plugin System (Paseo-parity)

> **REVISION 2 (post-approval).** Three ratchet measurements taken *after* approval invalidate the
> WS transport in Revision 1. All plugin traffic now rides HTTP. See **Transport correction** below.

## Context

Kanna has **seven separate, hard-coded extension points** — custom MCP servers, custom models,
subagents, text snippets, disk-scanned skills/commands, boards, cron jobs. Each was built by
re-instantiating the same settings-collection CRUD by hand, and none lets a user add *behaviour or
UI Kanna's authors did not anticipate*. There is no Kanna-native plugin concept: the only `plugin`
token in `src/` is Claude Code's catalog, consumed read-only as `CatalogScope = "plugin"`.

[Paseo](https://github.com/getpaseo/paseo) ships exactly that missing layer, and we are porting its
shape: **a plugin is a local directory that contributes client UI and daemon-side behaviour from one
TypeScript entry point, with the host providing the runtime modules so plugins ship no dependencies.**

Decisions taken with the user:

- **Full parity in one go** — client UI contributions *and* server contributions with typed RPC.
- **Local-directory install only.** No git, no npm (Paseo's `plugin add owner/repo` deferred).
- **Settings → Plugins page *and* a `kanna plugin …` CLI.**
- **Plus a `mcp__kanna__plugin_*` tool family** so Kanna's own agent can scaffold, validate, install,
  reload and debug a plugin for the user — the authoring loop is part of the feature.

Outcome: a user (or Kanna's agent on their behalf) writes a directory of TypeScript, runs one
command, and gets a real page in the app and a real handler on the daemon — no Kanna rebuild, no
fork, no dependencies in the plugin.

---

## Feasibility proof (done, not assumed)

Kanna's client is a **prebuilt Vite bundle** shipped in the npm package, so plugin UI can only load
at runtime. Paseo uses esbuild + a host module registry. Kanna has **no esbuild dependency** — but
runs on Bun, and `Bun.build` is native.

**Verified on Bun 1.3.14, this machine:**

```ts
await Bun.build({
  entrypoints: ["./e.tsx"], target: "browser", format: "cjs", minify: true,
  external: ["react", "react/jsx-runtime", "react/jsx-dev-runtime", "zod"],
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
})
// → require("react"), require("react/jsx-runtime"), require("zod"); CommonJS; 769 bytes
```

This decides the client architecture:

- `format: "cjs"` + `external` turns each host module into a literal `require("<name>")`.
- The loader is `new Function("require", "module", "exports", code)` with a `require` resolving
  **only** from a host registry, else throwing Paseo's exact error
  `Module "<name>" is not available in plugin client code`.
- This shares the **host React instance by identity**, so hooks work. No import map, no blob URL,
  no second React, **no new dependency**.
- The `define` is load-bearing: without it Bun emits `react/jsx-dev-runtime`.

Same call with `target: "bun"` produces the server bundle. **`Bun.build` is a sealed global, so it
lives in `plugin-compile.adapter.ts` only.**

---

## Transport correction (Revision 2)

Revision 1 routed plugin traffic through the WS command switch. **Measured after approval, that
breaches two exact ratchets and one ESLint ceiling at once:**

| Gate | Measured now | Pin | Effect of one plugin arm |
|---|---|---|---|
| `handleCommand` complexity (`ws-router.ts:216`) | **138** | `complexity` **138** | 139 → `limit_raised` |
| `^\s*case "` in `ws-router.ts` | **129** | `ws-router-dispatch-arms` **129** | 130 → exact-ratchet breach |
| `\.command<` in `src/client/**` | **60** | `untyped-command-results` **60** | 61 → exact-ratchet breach |

```
bunx eslint src/server/ws-router.ts --rule '{"complexity":["error",1]}'
#   216:3  Async function 'handleCommand' has a complexity of 138.
grep -cE '^\s*case "' src/server/ws-router.ts                      # 129
grep -rE '\.command<' src/client/ | grep -v test | wc -l           # 60
```

**Therefore: no `case` arm in `ws-router.ts`, and no new `socket.command<T>` anywhere.**
All plugin traffic rides `POST/GET /api/plugins/*` via `http-api-routes.ts` + `http-dispatcher.ts`,
neither of which carries any ratchet.

This is the better design regardless: the compiled client bundle must be fetched over HTTP anyway,
and `http-dispatcher.ts:87` already gates every `/api/` path
(`if (url.pathname.startsWith("/api/") && !auth.isAuthenticated(req)) return 401`) — **plugin routes
inherit authentication for free.**

Escape hatch if a push channel is later needed: subscription topics are handled by an `if` in
`handleMessage` and their snapshots are built in `ws-router-envelope.ts`, which the
`ws-router-dispatch-arms` budget (`include: ["src/server/ws-router.ts"]`) does not scan. Zero ratchet.

### Other corrections to Revision 1

- **Registration stripping fallback was wrong.** Revision 1 said "TypeScript is already a dependency".
  It is a **devDependency**, and `package.json` `files:` ships only `bin/`, `src/server/`,
  `src/shared/`, `dist/client/` — so no TS parser exists for an installed user. The runtime-no-op
  `PluginContext` plus the suffix-enforced module split is the design, with no parser fallback.
- **Subprocess channel: Unix socket, not fd 3.** Matches Paseo's own `session-socket.ts`. Framing
  reuses the newline-delimited JSON that `codex-app-server.ts` already runs. *Hazard to check first:*
  macOS caps `sun_path` at 104 bytes, and `$HOME` + a 64-char id gets close — fall back to
  `os.tmpdir()` (the path is passed in argv, so it is a one-line change).
- **Client bundle URL must be cache-busted:** `import(/* @vite-ignore */ \`/api/plugins/${id}/client.js?v=${buildHash}\`)`.
  The browser ESM registry is permanent per URL, so without `?v=` "reload" silently re-runs the stale
  module. Easiest thing in the feature to get wrong.
- **`SettingsPage.tsx` allowance must be LOWERED to the post-extraction count in the same PR.**
  Leaving it at 2787 after removing 370 lines is 370 lines of free regression — the `pattern_shrank`
  principle applied to `MODULE_ALLOWANCES`.
- **Do not raise `deps-bundles`.** Pass the existing `PluginService` interface plus scalars
  positionally instead of declaring a new `*Deps` bundle. Raising the pin says the PR made #893 worse.
- **`AS_CAST_BAN`:** `x as T` is banned outside `as const`, and `unknown` in a type annotation is
  banned. Every wire boundary narrows via `zod.parse()` or a `v is T` guard — which returns a typed
  value with no cast, so this costs nothing.
- **`addSurface` hosts on the pane system**, not a react-router page: `PaneTabTarget`
  (`src/client/lib/paneTree/types.ts`) + `paneContentRegistry.ts` is already exactly the registry
  Paseo describes.
- **CLI must prefer a running daemon.** `AppSettingsManager` does not watch `settings.json`, so a
  direct CLI write while the daemon runs is clobbered by the daemon's next write. Every
  settings-mutating subcommand probes `GET /health` first and sends to the daemon if one answers;
  direct write is the offline path only.

---

## Contribution surfaces: Paseo → Kanna

Verified: Kanna has **no command palette** (no `cmdk`; `src/client/lib/keybindings.ts` is a keybinding
map, not a palette), and `RightSidebar.tsx` is a git/diff surface, not a generic panel host. So
Paseo's surfaces do not map one-to-one.

| Paseo | Kanna equivalent | Ship? |
|---|---|---|
| `addSurface` + `addSidebarItem` | `KannaSidebar` nav item + a react-router page (like `WorkflowsPage`) | **Phase 3** |
| `addWorkspacePanel` (`context: "agent"`) | A chat-footer panel beside `WorkflowsSection` / `LoopProgressSection` | **Phase 3** |
| `plugin.handle(rpc)` | Daemon subprocess + typed RPC over the existing WS | **Phase 2** |
| `addCommandCenterItem` | The **`/` slash-command picker** — already merges builtins + disk catalog and already has a `plugin` scope + `SCOPE_RANK` | **Phase 4** |
| `addTheme` | Kanna themes are OKLCH tokens in `src/index.css`; Paseo's is a hex table | **Defer** |
| `addTimelineTransformer/Renderer` | `KannaTranscript` renderers — hottest render path | **Defer** |
| `addComposerPill`, `addAttachmentSource` | `ChatInput` / uploads | **Defer** |

Deferring the last four is deliberate: they are the surfaces where a bad plugin degrades the core
product (transcript render loop, composer input) rather than occupying its own page.

---

## Plugin package format

Directory containing:

```
my-plugin/
  kanna-plugin.json      # { "id": "my-plugin" }  — required manifest
  index.ts               # default export contribute(plugin: PluginContext) => cleanup
  main.client.tsx        # React (react-dom), hooks, panels
  handler.server.ts      # Node/Bun APIs, credentials, RPC handlers
  contract.shared.ts     # zod RPC contracts imported by both sides
  kanna-plugin.d.ts      # generated: types for @kanna/plugin
```

Manifest name is `kanna-plugin.json`, **not** `.claude-plugin/` — must not collide with the Claude
Code plugin catalog Kanna already scans. Ids match the existing MCP rule shape:
`/^[a-z][a-z0-9-]{0,31}$/`, reserved id `kanna`.

**On disk:** installed plugins are referenced by absolute path in settings (the source stays where
the user wrote it, per Paseo's `install`). Compiled bundles + manifest cache go under
`~/.kanna/data/plugins/<id>/{client.js,server.js,meta.json}` via a new `getPluginDir(id)` in
`src/server/paths.ts` (which is pure — it already only joins paths).

---

## Files to create

### Shared (pure — no IO)
| File | Contents |
|---|---|
| `src/shared/plugin-types.ts` | `PluginConfig / PluginInput / PluginPatch / PluginValidationError(Code) / PluginStatus / PluginLogEntry / PluginContribution` union. Mirrors `src/shared/mcp-types.ts` exactly. |
| `src/shared/plugin-manifest.ts` | `parsePluginManifest(json)`, `PLUGIN_ID_REGEX`, `PLUGIN_RESERVED_IDS`, `validatePluginShape` |
| `src/shared/plugin-host-modules.ts` | `CLIENT_HOST_MODULES` / `SERVER_HOST_MODULES` name lists + `hostModuleUnavailableMessage(name)`. **One source** for the compiler's `external`, the loader's registry keys, and the error string — they cannot drift. |
| `src/shared/plugin-rpc.ts` | `defineRpc({name, input, output})`, `PluginRpcContract`, name regex |
| `src/shared/plugin-log-ring.ts` | Pure ring: 500 entries / 256 KiB / 16 KiB per line (Paseo's bounds). Generalise the existing `OutputRing` (`src/server/claude-pty/output-ring.ts`) rather than copying it. |

### Server
| File | Contents |
|---|---|
| `src/server/plugin-compile.adapter.ts` | The **only** `Bun.build` caller. `compilePlugin(dir, target)` → `{code, errors}`. Sets `external` from `plugin-host-modules.ts`, `define` NODE_ENV=production. |
| `src/server/plugin-source-io.adapter.ts` | fs leaf: read manifest, stat entry, resolve absolute dir, confine paths |
| `src/server/plugin-process.adapter.ts` | Subprocess spawn (`Bun.spawn`), following `claude-pty/pty-process.ts` |
| `src/server/plugin-host.ts` | Pure lifecycle state machine: `idle → compiling → running → failed/stopped`, transitions + error text |
| `src/server/plugin-registry.ts` | Per-plugin runtime: compile → spawn → RPC → logs → `snapshot()` / `subscribe()`. Modelled on `workflow-registry.ts` (IO injected, `subscribe()` consumed by `BroadcastManager`). |
| `src/server/plugin-rpc-router.ts` | Routes a `plugin.rpc` WS command to the owning subprocess, zod-validates in and out, times out |
| `src/server/plugin-child-entry.ts` | The subprocess entry: loads `server.js` via the CJS shim, registers `handle()` contracts, speaks the framed protocol on **fd 3**, leaving stdout/stderr free for `console.log` |
| `src/server/ws-router-plugins.ts` | `handlePluginCommand(deps, command, id)` — the domain handler arm |
| `src/server/kanna-mcp-plugins.ts` | `buildPluginToolList(deps, tool)` with the `tool` factory **injected**, exactly like `kanna-mcp-boards.ts` |
| `src/server/cli-plugin.ts` | Pure arg parsing + result formatting for `kanna plugin …` |

### Client
| File | Contents |
|---|---|
| `src/client/plugins/hostModuleRegistry.ts` | `react`, `react/jsx-runtime`, `zod`, `@tanstack/react-query`, `@kanna/plugin` → live host instances |
| `src/client/plugins/evaluatePlugin.ts` | `new Function("require","module","exports", code)` + the unavailable-module error |
| `src/client/plugins/contributionRegistry.ts` | zustand store of live contributions, keyed by pluginId; cleared on disable/reload/remove |
| `src/client/plugins/PluginBoundary.tsx` | Per-plugin error boundary; a throwing plugin degrades to an inline message |
| `src/client/plugins/PluginTheme.ts` | Maps Kanna's OKLCH tokens → Paseo's `theme.colors.*` contract, so plugin code never writes a hex literal |
| `src/client/app/PluginsSection.tsx` | `PluginsSection` + `PluginsSettingsBranch` + `wrapPluginsPatch`, 3-layer pattern |
| `src/client/stores/pluginsSectionStore.ts` | `EditingState = {kind:"list"|"create"|"edit"}` |

---

## Files to modify

- `src/shared/app-settings-types.ts` — `AppSettingsSnapshot.plugins: PluginConfig[]`, `pluginsEnabled: boolean` (global switch, **default `false`**), `AppSettingsPatch.plugins` arm.
- `src/server/app-settings.ts` — `normalizePlugins`, `PLUGIN_CRUD`, `PluginValidationException`, one `applyCollectionPatch` line in `applyPatch`. **Already at its 1897 ceiling** → put `validatePluginShape` + `buildPluginFromInput` in `src/shared/plugin-manifest.ts` and import, adding ~15 lines here, not ~120.
- `src/server/ws-router-defaults.ts` — both `buildInitialAppSettingsSnapshot()` and the patch-merge fallback.
- `src/client/stores/appSettingsStore.ts` — `mergeAppSettingsPatch` pin + `selectPlugins` / `selectPluginsEnabled` (module-level `EMPTY` const, per `no-unstable-selector-fallback`).
- ~~`src/shared/protocol.ts`~~ / ~~`src/server/ws-router.ts`~~ — **NOT MODIFIED.** See Transport correction.
- `src/server/plugin-http-routes.ts` (new) + one chain entry in `src/server/http-dispatcher.ts` —
  `GET /api/plugins`, `GET /api/plugins/:id/client.js`, `GET /api/plugins/:id/logs`,
  `POST /api/plugins/:id/rpc`, `POST /api/plugins/:id/reload`, `POST /api/plugins/:id/client-error`.
  All sit under `/api/`, so the existing auth gate covers them for free.
- `src/client/ports/httpPort.ts` + `src/client/adapters/http.adapter.ts` — add `postJsonBody<T>(url, body: JsonValue)`.
  The existing `postJson` types its body as a flat `Record<string, string|number|boolean|null|undefined>`,
  which cannot carry a nested RPC input.
- `src/server/kanna-mcp.ts` — one `...buildPluginToolList({...})` line.
- `src/shared/tools.ts` — the `mcp__kanna__plugin_*` name constants.
- `src/server/cli-runtime.ts` — a `kind: "plugin"` arm. **Note: the CLI is flag-only today**; this is its first subcommand.
- `src/client/app/SettingsPage.tsx` — one `sidebarItems` row + one render line. It is pinned at 2787; to stay under, **extract the existing 370-line `SkillsSection` (lines 584–953) into `src/client/app/SkillsSection.tsx` in the same PR**, which nets the file smaller.

---

## Server runtime

**Subprocess, not in-process** — matching Paseo, and required here: plugin code is unsandboxed and a
crash must not take the daemon down.

- Spawn `bun src/server/plugin-child-entry.ts` per running plugin.
- **Protocol on fd 3**, not stdout. This is Paseo's "separate channel so `console.log` cannot corrupt
  plugin RPCs", and it is what makes stdout/stderr safe to capture verbatim as logs.
- Framing: newline-delimited JSON `{id, kind: "call"|"result"|"error", name, payload}`.
- zod validates input **before** dispatch and output **after** the handler, both sides.
- Per-call timeout (reuse the 600s tool-callback default shape); on subprocess death every pending
  call rejects, mirroring the `PendingToolSlots` "never drop a continuation" discipline.
- Teardown runs `cleanup()`, then SIGTERM → SIGKILL with a grace window, like
  `KANNA_PTY_SESSION_END_GRACE_MS`.

**Logs:** the ring survives reload and crash, clears on remove, and the Settings viewer carries
Paseo's warning verbatim — *do not log credentials; connected users can read this tail.*

---

## Client runtime

1. Server compiles `client.js` at install/reload; `GET /api/plugins/:id/client.js` serves it.
2. `evaluatePlugin` runs it with the host `require`. **The plugin runtime is a lazy chunk** loaded
   via the existing `createLazyLoader` (`src/shared/lazyModule.ts`) only when `pluginsEnabled` is on
   — so the **350 KB gzip entry budget** (`bun run check:bundle`) is unaffected for the default-off
   majority. This must be asserted, not assumed: `bun run check:bundle` is a Phase-1 exit gate.
3. Contributions land in `contributionRegistry`; `KannaSidebar` and the chat footer read it.
4. Each contribution renders inside `PluginBoundary`.
5. Disable / reload / remove clears that plugin's contributions and unmounts its subtree.

**Registration stripping without Babel.** Paseo Babel-parses `index.ts` to delete the other target's
calls. Kanna has no parser dependency and should not add one. Instead: **`PluginContext` is
target-aware at runtime** — in the client bundle `handle()` is a no-op, in the server bundle
`addSidebarItem()` et al. are no-ops. Both bundles are built from the same entry with the *other*
target's implementation modules resolved to an empty stub via a `Bun.build` plugin `onResolve` on
the `.client.` / `.server.` suffixes.

*Trade-off, stated honestly:* this is weaker than Paseo's AST strip. A top-level side effect in
`index.ts` still runs on both targets, and dead code is eliminated by tree-shaking rather than
guaranteed removal. The suffix-based `onResolve` still gives us the hard part — a `*.server.ts`
import can never reach the client bundle, which is the actual security boundary. If a real strip is
ever needed, TypeScript is already a dependency and `typescript/unstable` exposes a parser.

---

## Security posture

Paseo assumes "trusted unsandboxed local code" on a personal daemon. **Kanna's assumption is weaker**
— it has password auth and a Cloudflare tunnel, so it can be reachable beyond localhost. Plugin
backend code runs with full machine access under the Kanna process.

Gates:

1. `pluginsEnabled` defaults to **`false`**. Nothing compiles or spawns until a human turns it on.
2. **Local absolute paths only.** No git, no npm, no remote fetch — so there is no path from
   "attacker reaches the web UI" to "attacker supplies plugin code".
3. Install/reload/remove require an authenticated session (they ride `/api/` and the WS, both gated).
4. The MCP authoring tools confine every path with `confinePathToDir` (as the tracking-doc tools do)
   and can write only inside the chat's cwd.
5. The log viewer carries the do-not-log-secrets warning.

**Explicitly out of scope: sandboxing.** A plugin is as trusted as the Kanna process. That is stated
in the Settings UI, not buried in docs.

---

## Architecture-budget compliance

- Every new module is **new and small** — the largest (`plugin-registry.ts`) is ~400 lines, well under
  the 700 threshold, so no `MODULE_ALLOWANCES` entry is added.
- `SettingsPage.tsx` is pinned at **exactly** its current 2787 lines, so even the ~10 lines a settings
  section needs is a breach. Pay first by extracting the 370-line inline `SkillsSection`
  (lines 584–953 — the only settings section still inline) to `src/client/app/SkillsSection.tsx`,
  **and lower the allowance to the new count in the same PR.**
- `app-settings.ts` grows ~15 lines against a 1897 ceiling.
- **`deps-bundles` is NOT raised** — no new `*Deps` interface or inline `deps: {` parameter. The MCP
  tool family and the HTTP routes take the existing `PluginService` plus scalars positionally.
- **`ws-router-dispatch-arms` and `untyped-command-results` are untouched** (both at their exact pins).

---

## Phased delivery

**Phase 1 — compile + settings + CLI (no runtime).** `plugin-types`, `plugin-manifest`,
`plugin-host-modules`, `plugin-compile.adapter`, settings collection, `kanna plugin init|install|ls`.
*Exit:* a plugin directory compiles to two bundles and is listed. Unit tests on the pure modules; a
compile test over a fixture plugin in `__fixtures__`.

**Phase 2 — server runtime + RPC.** Subprocess, fd-3 protocol, `defineRpc`, log ring, `plugin.rpc`
WS arm, `reload|logs|enable|disable|remove`.
*Exit:* a fixture plugin's RPC round-trips from a WS command and its `console.log` appears in the
log tail. Tests: protocol framing unit tests, a real-subprocess integration test.

**Phase 3 — client runtime + UI contributions.** Host registry, evaluator, contribution registry,
error boundary, sidebar item + page + chat-footer panel, Settings → Plugins page.
*Exit:* a fixture plugin renders a page and calls its own RPC from a button. Tests:
`renderForLoopCheck` on the contribution registry (**and every mounted root unmounted**, or the
`afterEach` sweep fails a later file); one `e2e/*.pw.ts` spec — the harness already boots against a
seeded temp `KANNA_HOME`, so it can install a fixture plugin end to end.

**Phase 4 — MCP authoring tools + slash-command contributions.** `plugin_init`, `plugin_validate`,
`plugin_install`, `plugin_reload`, `plugin_logs`, `plugin_list`; plugin-contributed slash commands
merged into `localCommandsForCwd`.
*Exit:* Kanna's agent can be asked "write me a plugin that X" and complete the loop unaided.

---

## Riskiest assumptions and the cheapest falsifying experiment

**All pre-flight experiments have been RUN on Bun 1.3.14. Results below are measured, not predicted.**

| # | Assumption | Result |
|---|---|---|
| 1 | `Bun.build` can externalize host modules | ✅ `format:"cjs"` + `external` → `require("react")`. Superseded by #2. |
| 2 | A `Bun.build` `onLoad` shim can replace bare specifiers | ✅ **Adopt this instead of CJS.** ESM out, **zero bare imports remaining**, 391 bytes, all resolution via `globalThis.__KANNA_PLUGIN_HOST__.require(...)`. Native `import()`, real sourcemaps, **no `eval`**. |
| 3 | Unix socket works under Bun | ✅ Bidirectional round trip confirmed. |
| 4 | The planned socket path fits macOS's `sun_path` | ❌ **`~/.kanna/plugins/<64-char-id>/run/host.sock` = 110 bytes, cap is 104.** Must live in `os.tmpdir()` (66 bytes). Would have failed only for long ids — a confusing, late bug. |
| 5 | A `*.server` import is kept out of the client bundle | ⚠️ **Only if the guard THROWS.** Bun silently ignores esbuild's `{errors:[…]}` return shape. A/B measured: `guard=false → success=true, leaked=true` (the marker string shipped to the browser); `guard=true → build fails` naming file and specifier. **This is the security boundary — it needs a regression test, not a code comment.** |
| 6 | `Bun.build` reports plugin failures via `.success` | ❌ A throwing plugin **rejects the promise**. `plugin-build.adapter.ts` must `try/catch`, not only check `.success`. |
| 7 | `define: NODE_ENV=production` is optional | ❌ Load-bearing. Without it Bun emits `react/jsx-dev-runtime`, which must then be in the ABI. |
| 8 | Lazy chunk keeps the entry under 350 KB gzip | Open — `bun run check:bundle` gates P5. Free to check. |
| 9 | Host registry yields one React identity (hooks work) | Open — a second copy throws "Invalid hook call" on first render, so the test is decisive. Rides P5. |

---

## Verification

```bash
bun run typecheck && bun run lint && bun run lint:usestate && bunx ast-grep test
bun run test --conditions production
bun run check:arch          # module + pattern budgets
bun run lint:limits         # complexity ceilings still tight
bun run build && bun run check:bundle   # 350 KB gzip entry budget
bun run test:e2e            # Phase 3+, real Chrome
```

Manual end-to-end (Phase 3): `kanna plugin init /tmp/demo && kanna plugin install /tmp/demo`, enable
plugins in Settings, confirm the sidebar item renders, press its button, confirm the RPC result and
that `console.log` shows in Settings → Plugins → Logs; then `kanna plugin reload demo` and confirm
the change appears.

Per the repo's C3 rule: run `/c3 query plugins` before coding and `/c3 change` in the same PR, adding
each new architecture-significant file to `.c3/eval/c3-NNN.yaml` `code:` **and** `.c3/code-map.yaml`.
