---
id: ref-side-effect-adapter
c3-seal: c57070a9b08ba9967ec758f5e83f2e9df4027761a591359c47cb72226caa46ae
title: side-effect-adapter
type: ref
goal: Keep every `node:fs`, `node:child_process`, `node:http`/`https`, `bun:sqlite`/`better-sqlite3`/`pg`, and `Bun.spawn`/`Bun.$`/`Bun.file`/`Bun.serve`/`Bun.Terminal` call site in a single, named, leaf-level wrapper file so the rest of `src/server/**` can stay pure and the seal is mechanically enforceable by ESLint without per-file allow-lists.
---

## Goal

Keep every `node:fs`, `node:child_process`, `node:http`/`https`, `bun:sqlite`/`better-sqlite3`/`pg`, and `Bun.spawn`/`Bun.$`/`Bun.file`/`Bun.serve`/`Bun.Terminal` call site in a single, named, leaf-level wrapper file so the rest of `src/server/**` can stay pure and the seal is mechanically enforceable by ESLint without per-file allow-lists.

## Choice

Two-shape adapter convention, both colocated next to the module that owns the port:

1. **Leaf-IO module** — a file whose only responsibility is the side effect itself. Suffix: `<name>.adapter.ts`. Examples on main: `src/server/storage/fs-storage.adapter.ts`, `src/server/claude-pty/pty-process.adapter.ts`, `src/server/machine-name.adapter.ts`, `src/server/orphan-persistence.adapter.ts`.
2. **Mixed-concern module** — domain logic stays in `<name>.ts`; the IO it needs is extracted into a sibling `<name>-io.adapter.ts` and re-imported. Examples on main: `src/server/diff-store.ts` + `src/server/diff-store-io.adapter.ts`, `src/server/server.ts` + `src/server/server-io.adapter.ts`, `src/server/app-settings.ts` + `src/server/app-settings-io.adapter.ts`.

Files matching `src/server/**/*.adapter.ts` (or the legacy `src/server/adapters/**` directory) are the only exempt globs in the `no-restricted-imports` + `no-restricted-globals` override in `eslint.config.js`. Tests, `__fixtures__`, and `test-helpers` are also exempt.

## Why

A pure rename-the-file convention was picked over alternatives because:

- **Per-component allow-lists were tried and rejected** during the 90 → 0 ratchet burndown (PRs #283-#302). Each new component added meant another ESLint override block; the config grew unbounded.
- **Dependency injection alone is not sufficient** — leaf modules must eventually call the real `fs.readFile`, and forcing every leaf through a port interface just to satisfy lint pushed boilerplate into every consumer without adding test seams (consumers already mock through the leaf).
- **Filename is greppable, AST-checkable, and survives moves**. `*.adapter.ts` shows up in IDE search, in `c3x lookup`, in CODEOWNERS, and in PR diffs — no need to remember which globs are exempt.
- **The `-io` infix tells the next reader** that the parent module is a mixed-concern domain file, not a leaf wrapper, and that the IO calls were intentionally extracted (not yet refactored into a port). Without the infix, reviewers cannot distinguish "this file is allowed to call `fs` because it's an adapter" from "this file is allowed to call `fs` because someone forgot to extract".

This boundary is verified by `bun run lint` failing on any new side-effect import in a non-adapter file (final flip landed in PR #303; ratchet tooling deleted in the same PR).

## How

Two file templates, taken verbatim from main.

**Shape 1 — leaf-IO module.** Source: `src/server/machine-name.adapter.ts`. The whole file is the wrapper. No domain logic.

```ts
// src/server/machine-name.adapter.ts
import { hostname } from "node:os"

export function getMachineDisplayName(): string {
  return hostname()
}
```

**Shape 2 — mixed-concern split.** Source: `src/server/server-io.adapter.ts` paired with `src/server/server.ts`.

```ts
// src/server/server-io.adapter.ts
import { stat } from "node:fs/promises"
import type { Stats } from "node:fs"
import type { BunFile, Server } from "bun"

export function getServerFile(p: string): BunFile {
  return Bun.file(p)
}
export function statFile(p: string): Promise<Stats> {
  return stat(p)
}
export function serveHttp<T = unknown>(opts: unknown): Server<T> {
  return Bun.serve(opts as never) as unknown as Server<T>
}
```

```ts
// src/server/server.ts — consumer
import { getServerFile, serveHttp, statFile } from "./server-io.adapter"

const info = await statFile(filePath)
const file = getServerFile(filePath)
const server = serveHttp<ClientState>({ port, hostname, fetch: handler })
```

REQUIRED:

- Filename suffix `.adapter.ts` for both shapes.
- Adapter wraps **one primitive surface** (fs, spawn, http, Bun global, …); do not stack unrelated IO into a single adapter just to satisfy lint.
- Adapter has no domain decisions: it normalizes shape (e.g. `statOrNull`) but does not interpret state.
- For Shape 2, the parent file imports through the sibling adapter only — no direct `node:fs` import survives.

OPTIONAL:

- Adapters MAY export typed helpers (`SpawnResult`, `DirEntry`) so consumers do not import `node:*` types either.
- Adapters MAY re-export node types (`export type { Stats } from "node:fs"`) to keep consumers off the restricted import list.

NOT THIS:

- Do not add `// eslint-disable-next-line no-restricted-imports` to a non-adapter file. The seal has no escape valve; adding a disable was rejected during the burndown as it defeats the audit value.
- Do not rename a mixed-concern file to `<name>.adapter.ts` just to silence the rule — that hides the fact that domain logic is still co-located with IO. Use the `-io.adapter.ts` sibling instead.
- Do not put adapters under arbitrary paths like `src/server/lib/io/`. The colocation rule (sibling-next-to-consumer) is what makes ownership obvious in PR diffs.
