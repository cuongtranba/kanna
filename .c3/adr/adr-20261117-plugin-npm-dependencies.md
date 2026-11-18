---
id: adr-20261117-plugin-npm-dependencies
c3-seal: e99b965dbcc4d2709ad30be723bcab92c3c60a620dabc78d153338b8f7493d2c
title: plugin-npm-dependencies
type: adr
goal: 'Let a Kanna plugin use any npm package: the compile installs the plugin''s own package.json with bun install, bundles every non-host package into the plugin''s two bundles, lets server code import node and bun builtins, and keeps server-only packages out of the browser bundle, while Kanna keeps checking only the plugin contract (manifest, kannaPluginApi, RPC contracts, no server literal in the client bundle), never which packages a plugin uses.'
status: done
date: "2026-11-17"
---

## Goal

Let a Kanna plugin use any npm package: the compile installs the plugin's own package.json with bun install, bundles every non-host package into the plugin's two bundles, lets server code import node and bun builtins, and keeps server-only packages out of the browser bundle, while Kanna keeps checking only the plugin contract (manifest, kannaPluginApi, RPC contracts, no server literal in the client bundle), never which packages a plugin uses.

## Context

hostModulePlugin in plugin-build.adapter.ts threw for every bare specifier outside CLIENT_HOST_MODULES and SERVER_HOST_MODULES, node builtins included, for both builds. The first real plugin, aegis-marketing, therefore hand-wrote a Slack Socket Mode client over fetch and WebSocket and did all IO through Bun.$. A plugin is the user's own code: Kanna owns the interface contract, not the plugin's dependency choices. One entry file is built twice, for the browser and for bun, and real plugins import their .server.ts files straight from index.ts, so those files are part of the client graph and findServerLiteralLeaks relies on that.

## Decision

buildPluginBundles runs bun install in the plugin source directory before the compile child whenever a package.json is present, with --frozen-lockfile when bun.lock or bun.lockb exists and --no-save otherwise, under its own 300 s deadline; a plugin without package.json builds exactly as before. Resolution keeps host modules shared (one React), lets Bun bundle every other package, and in the server build leaves node and bun builtins external. In the client build, any package or builtin imported directly by a plugin-own .server file resolves to an inert stub (a callable, constructible proxy whose then is undefined), and a builtin imported by any other plugin file is refused with a message pointing at .server.ts. The stub is per import, not per file, so .server files stay in the client graph and the literal-leak check keeps working. Dependency lifecycle scripts follow Bun defaults (trustedDependencies); the plugin's own scripts run with the same trust as its server code. kannaPluginApi stays 1 because the check is an exact match and the change is additive.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-238 | component | The compile pipeline installs dependencies, bundles packages and stubs server-only imports in the client build; the leak risk row's trigger changes | c3-238#n14427@v1:sha256:6fdb5822ed6c6da6d17c8cfd5420b3966296b48efb4b4ce8fc6dd03c2c81ea45 | Change Safety row for the leak risk updated and a row for the dependency install added |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Compile | installPluginDependencies, the resolution rules and the server-only stub | src/server/plugins/plugin-build.adapter.ts |
| Tests | P13 install and RPC through a node:zlib package, client bundle exclusion and evaluation, refusal of node:fs from a client file, missing package named | src/server/plugin-system-acceptance.test.tsx |
| Fixture | with-deps plugin with file: dependencies on two local packages and a committed bun.lock | src/server/\_\_fixtures\_\_/plugins/with-deps |
| Docs | Use npm packages section, MCP tool descriptions, kanna-features skill | wiki/src/content/docs/features/plugins.md |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Stub whole .server files in the client build | Real plugins import .server files from index.ts, so a value exported from one would turn into a stub, and findServerLiteralLeaks would lose the inputs it checks |
| Keep packages external and resolve them at run time | The server bundle is imported from the Kanna data directory, where no node\_modules exists, and the browser cannot resolve packages at all |
| Raise kannaPluginApi to 2 | The manifest check is an exact match, so every installed plugin would be rejected for an additive change |

## Verification

| Check | Result |
| --- | --- |
| bun run test src/server/plugin-system-acceptance.test.tsx src/server/plugins/ | pass |
| bun run check | pass |
| bun run check:arch | pass |
