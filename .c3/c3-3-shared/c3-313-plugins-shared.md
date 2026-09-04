---
id: c3-313
c3-seal: 5cf0269c24d6c10b9def9daef4aefe00f5ad3564fb459dc237eec76d54574c5b
title: plugins-shared
type: component
category: feature
parent: c3-3
goal: 'Own the pure plugin vocabulary both halves of Kanna must agree on: the manifest shape and its id rules, the installed-plugin settings record, the on-disk path layout, the bounded log ring, and the ambient declarations a plugin author codes against.'
uses:
    - ref-side-effect-adapter
    - ref-strong-typing
    - rule-colocated-bun-test
---

## Goal

Own the pure plugin vocabulary both halves of Kanna must agree on: the manifest shape and its id rules, the installed-plugin settings record, the on-disk path layout, the bounded log ring, and the ambient declarations a plugin author codes against.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-3 Shared |
| Runtime | Pure; no IO and no Node globals, because the client bundle imports from here |
| Consumers | c3-238 (plugin runtime), c3-121 (plugin UI surfaces) |
| Ownership | Manifest parsing, plugin id validation, path layout, log-ring bounds, `@kanna/plugin` declarations |

## Purpose

The server compiles and runs a plugin while the client evaluates and renders it, so any disagreement about what a plugin id may contain, where its bundles live, or what its manifest means becomes a security or a correctness bug rather than a mismatch. Keeping that vocabulary in one pure place is what stops the two halves from drifting.

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-strong-typing | ref | Manifest and settings shapes are named types crossing the server/client boundary | must follow | parsers return typed results, never loose records |
| rule-colocated-bun-test | rule | Each module sits next to its `.test.ts` | wired compliance target | enforced for `src/shared/plugins/**` |
| ref-side-effect-adapter | ref | Nothing here touches the filesystem; parsers take text and paths are computed as strings | must follow | `Buffer` is banned here — Vite does not polyfill it |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| Manifest | OUT | `parseKannaPluginManifest` + `isValidPluginId`; the id pattern rejects anything URL-encoding could produce, so a traversal-shaped id cannot reach a path join | c3-238 | src/shared/plugins/manifest.ts |
| Path layout | OUT | Plugins live under the data ROOT, not `data/`; the RPC socket lives in the system temp dir because a build-dir-rooted path overflows the 104-byte `sun_path` cap | c3-238 | src/shared/plugins/paths.ts |
| Settings record | OUT | `InstalledPluginConfig` = `{id, sourceDir, enabled}` and `PluginSettings` = `{enabled}`, defaulting OFF | c3-206 | src/shared/plugins/settings.ts |
| Log ring | OUT | Bounded entry count and per-line byte cap, truncating on UTF-8 boundaries | c3-238 | src/shared/plugins/log-ring.ts |
| Authoring API | OUT | Ambient `@kanna/plugin` / `@kanna/plugin/server` declarations mirroring the host's runtime shapes; plugin source imports them TYPE-only | c3-121 | src/shared/plugins/kanna-plugin.d.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/shared/plugins/manifest.ts | Contract (Manifest) | Error message wording | src/shared/plugins/manifest.ts |
| src/shared/plugins/paths.ts | Contract (Path layout) | Directory naming | src/shared/plugins/paths.ts |
| src/shared/plugins/settings.ts | Contract (Settings record) | Field ordering | src/shared/plugins/settings.ts |
| src/shared/plugins/log-ring.ts | Contract (Log ring) | Bound values | src/shared/plugins/log-ring.ts |
| src/shared/plugins/kanna-plugin.d.ts | Contract (Authoring API) and the host's runtime shapes | Doc comments | src/shared/plugins/kanna-plugin.d.ts |
