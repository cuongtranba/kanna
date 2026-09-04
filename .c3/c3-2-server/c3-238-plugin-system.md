---
id: c3-238
c3-seal: 3301c8d5cb96af724c3556a916845978df19b6fb7c8ad6bfe7e890609c0462be
title: plugin-system
type: component
category: feature
parent: c3-2
goal: 'Run third-party plugins for Kanna: compile a plugin directory to two bundles, run its server half as a subprocess speaking typed RPC over a unix socket, keep a bounded log ring per plugin, and expose one service that the HTTP routes, the CLI and the MCP authoring tools all drive.'
uses:
    - ref-event-sourcing
    - ref-side-effect-adapter
    - ref-strong-typing
    - rule-colocated-bun-test
---

## Goal

Run third-party plugins for Kanna: compile a plugin directory to two bundles, run its server half as a subprocess speaking typed RPC over a unix socket, keep a bounded log ring per plugin, and expose one service that the HTTP routes, the CLI and the MCP authoring tools all drive.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-2 Server |
| Runtime | One `PluginService` per process, held by `plugins/plugin-service-host.ts`; plugin children are spawned subprocesses |
| Consumers | c3-121 (plugin UI surfaces), c3-210 (MCP tool registration), c3-206 (settings collection that persists installs) |
| Ownership | The plugin runtime, its RPC protocol, the compile pipeline, and the three surfaces that drive it |
| Default | Plugins are OFF by default; every surface stays dark until the global switch is on |

## Purpose

A plugin is untrusted third-party code, so the design keeps it at arm's length in three ways at once: it is compiled rather than imported, its server half runs in its own process rather than in Kanna's, and its client half is evaluated behind an error boundary. The component exists to make those three separations cheap enough that a plugin can still contribute real UI and answer real RPC.

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-side-effect-adapter | ref | Every filesystem, socket and subprocess call lives in `plugin-service-io.adapter.ts` or `plugin-build.adapter.ts` | must follow | `plugin-service.ts` is the domain state machine and touches no IO |
| ref-strong-typing | ref | The RPC contract and the line protocol are named types on both ends of the socket | must follow | no any/unknown crossing the child boundary |
| rule-colocated-bun-test | rule | Each module sits next to its `.test.ts` | wired compliance target | enforced for `src/server/plugins/**` |
| ref-event-sourcing | ref | Install records are persisted through the settings collection, never a plugin-owned sidecar file | must follow | `settings.installedPlugins` is the durable fact |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| PluginService | OUT | install / list / reload / restore / setEnabled / start / stop / status / call / logs / clientBundle / recordClientError — the one surface the CLI, HTTP and MCP paths share | c3-210 | src/server/plugins/plugin-service.ts |
| HTTP `/api/plugins/*` | OUT | list, client.js, logs, rpc, reload, client-error. Inherits the `/api/` auth gate; a disabled surface answers 404 everywhere, never 403 | c3-121 | src/server/plugin-http-routes.ts |
| Install persistence | IN | `InstalledPluginStore` port bound to `settings.installedPlugins`; `restore()` re-registers at boot without recompiling | c3-206 | src/server/plugins/installed-plugin-store.ts |
| MCP authoring tools | OUT | plugin_list / plugin_validate / plugin_logs / plugin_scaffold / plugin_install / plugin_reload; the three mutating tools are withheld at depth > 0 | c3-210 | src/server/kanna-mcp-plugins.ts |
| CLI | OUT | `kanna plugin install \| ls \| reload \| logs`, dispatched into the same service | c3-202 | src/server/plugin-cli-dispatch.ts |
| Child RPC | OUT | Newline-delimited JSON over a unix socket; the host listens before the child spawns, so the child never races a not-yet-bound socket | c3-313 | src/server/plugins/plugin-rpc-protocol.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/server/plugins/plugin-service.ts | Contract (PluginService) | Runtime-state detail | src/server/plugins/plugin-service.ts |
| src/server/plugin-http-routes.ts | Contract (HTTP surface) | Status-code detail within the stated rules | src/server/plugin-http-routes.ts |
| src/server/plugins/installed-plugin-store.ts | Contract (install persistence) | Write batching | src/server/plugins/installed-plugin-store.ts |
| src/server/kanna-mcp-plugins.ts | Contract (MCP authoring tools) | Tool description wording | src/server/kanna-mcp-plugins.ts |
| src/server/plugin-cli-dispatch.ts | Contract (CLI) | Output formatting | src/server/plugin-cli-dispatch.ts |
| src/server/plugin-system-acceptance.test.tsx | Contract and the phase table in PLUGIN-SYSTEM-PLAN.md | Test framing | src/server/plugin-system-acceptance.test.tsx |

## Change Safety

| Risk | Trigger | Detection | Verification |
| --- | --- | --- | --- |
| A second service instance is created, splitting the registry | Calling `createPluginService()` directly instead of `getPluginService()` | An install made on one surface is invisible to another | `bun test --conditions production src/server/plugin-system-acceptance.test.tsx` |
| An install stops surviving restart | Removing the `configurePluginService` call or the settings write | `plugin ls` reports nothing after a reboot while bundles sit on disk | The P11 acceptance case builds a second service over the same records |
| A server-only import leaks into a client bundle | Widening the compile allowlist | Two SECURITY assertions in the acceptance suite | `bun test --conditions production src/server/plugin-system-acceptance.test.tsx` |
| A stale client bundle is served after reload | Dropping the `no-store` header | `plugin reload` appears to do nothing in the browser | Route test asserting `cache-control: no-store` |
