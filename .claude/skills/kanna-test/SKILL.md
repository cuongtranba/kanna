---
name: kanna-test
description: Writes tests the Kanna way and verifies a change against the merge gates: Vitest through vp test under Bun, Oxlint through vp lint, ast-grep, the design gate and the defect-count ratchets. Use when writing or changing a test, when about to run tests or report work as done, when a test passes locally but fails on CI, when a test reaches for vi.fn, vi.mock, a Date.now / fetch / console / process.env patch, a sleep, .skip or `as unknown as`, when lint rejects node:fs / process.env / a raw hex color / backdrop-blur / a native title / no-floating-promises / no-misused-promises / an empty .catch, when ast-grep rejects a hook argument, a store selector, useState, raw fetch or WebSocket, or a raw timer/DOM global, when happy-dom throws "removeChild: The node to be removed is not a child of this node", when a test file reports "(0 test)" with "Spread syntax requires ...iterable", when Vitest says "Invalid Chai property: toStartWith", or when React error #185 "Maximum update depth exceeded" appears.
user-invocable: false
---

# Testing and verifying a change in Kanna

Kanna enforces most conventions mechanically, so "it looks right" is not a signal.
Several gates fail in ways that point at the wrong file, or only on CI.

## Contents

- Commands
- Verification workflow
- Writing a test
- Vitest under Bun facts
- React roots, subprocesses, and module mocks
- Gate reference ([references/gates.md](references/gates.md))

## Commands

```bash
bun run test                                     # bun --bun vp test run; never bare `bun test`
bun run test <file>.test.ts                      # one suite while iterating
bun run typecheck                                # vp check --no-lint (tsgolint); never bare tsc
bun run lint && bun run lint:comments            # vp lint --deny-warnings (Oxlint) + the no-comments rule
bun run lint:usestate                            # every ast-grep rule in rules/ (CI runs this)
bunx ast-grep test                               # rule fixtures in rule-tests/ (local only; CI does not run it)
bun run check:arch                               # architecture and test-style ratchets
bun run lint:limits                              # proves each complexity ceiling is still tight
```

`bun run test` is Vitest 5 through Vite+, run INSIDE Bun: the `--bun` is not optional
because server code uses `bun:sqlite`, `Bun.serve`, `Bun.Terminal` and `Bun.spawn`.
`bun:test` is not importable; test files import `describe`/`test`/`expect`/`vi`/hooks
from `"vite-plus/test"` (there are no globals). A bare `bun test` runs the wrong runner.
`bun run verify:client-arch` chains ast-grep, lint, typecheck, and test for client work.

Type checking is tsgolint inside the Oxlint that `vite-plus` bundles. `typescript` 6.x
stays installed only for its classic JS API (`scripts/comment-scan.ts` and two server
tests), so a bare `tsc` is the wrong compiler. Lint rules live in `lint.config.ts`
(pure data): bare names are native Oxlint rules, `typescript/` and `react-hooks/` are
native plugins, and `eslint-js/` runs the real ESLint rule through
`oxlint-plugin-eslint`, which is how the `no-restricted-syntax` AST gates and the four
complexity ceilings work. Suppress with `oxlint-disable` or `eslint-disable`, both
honoured, with the reason after `--`; the seal and design gates admit no suppression.

Scope runs to what changed while iterating. A full-suite run from a subagent while
other agents share the host exhausts it; run the full suite once, from the main
agent, before pushing. Vitest runs one worker per file at cores minus one. Suites that
spawn real shells, PTYs, `claude`/`codex` CLIs or MCP stubs (`terminal-manager`,
`mcp-validator`, `package-inventory-io.adapter`, `workflow-watch-io.adapter`) time out
on a saturated host: try `VITEST_MAX_WORKERS=3`, which mirrors a 4-vCPU CI runner,
before suspecting a test.

## Verification workflow

Copy this checklist and tick it off:

```
- [ ] Targeted suites for every touched file pass
- [ ] bun run typecheck passes
- [ ] bun run lint, lint:comments, lint:usestate pass
- [ ] bun run check:arch passes (pins lowered for every population that shrank)
- [ ] bun run test (full suite) passes once, from the main agent
- [ ] .c3/ facts and docs updated if a contract or rule changed; c3x check passes
```

When a step fails: read the message, fix the cause it names, rerun that step, and
only move on once it passes. Report the real output, including anything skipped.

## Writing a test

A test exists to catch a realistic regression a user could observe. Before adding
or keeping one, name the shipped promise it protects and the bug that makes it
fail. No answer means no test.

- **Public seam.** Exercise the module's public API and assert public values,
  states, events, results, and errors. Never assert private fields, call counts,
  or call order. Do not test helpers, guards, wiring, generated code, or
  third-party behavior directly.
- **No mocks.** Pass a real, in-memory, or deterministic fake through a parameter
  that defaults to the production value, or through an existing deps or `dom`
  object. A callback recorder is a plain array the fake pushes into, not `vi.fn()`.
  This is what the side-effect seal buys: pure domain code takes plain values.
- **No global patches.** Do not reassign `Date.now`, `fetch`, `window.confirm`,
  `console.*`, or `process.env`. A
  failure before the restore line leaks the patch into whichever test in the file
  runs next.
  Inject the clock, dialog, logger, fetch, or environment instead.
- **No sleeps.** Await the promise that produces the state, or poll for the public
  state with a timeout. A fixed delay is flaky on CI and slow everywhere else.
- **Flat shape.** `test("does x", …)` at the top level, or one `describe` per file.
  Titles state behavior; a regression test names the bug. One test proves one
  cause and one decisive outcome.
- **Real fixtures.** Build values through public constructors or complete
  literals. `as unknown as` builds a value production can never hold.
- **Errors.** Guard for control flow, then assert only the promised payload, never
  the class, name, or message unless they are stable API.
- **Never commit `.only` or `.skip`.** Use `test.failing` for a documented known bug.
  Never weaken, skip, or delete a valid test to get green; say the test is wrong.

The injection shape (the remedy #1141 applied):

```ts
export async function loadContributions(
  load: typeof loadFromServer = loadFromServer,
): Promise<Contribution[]> {
  return normalize(await load())
}

test("drops contributions with no id", async () => {
  const result = await loadContributions(async () => [{ id: "" }, { id: "a" }])
  expect(result.map((c) => c.id)).toEqual(["a"])
})
```

A `check:arch` breach (including the test-style `TEST_PATTERN_BUDGETS`) is read
and fixed per `.claude/skills/kanna-design/SKILL.md`.

## Vitest under Bun: facts that cost an investigation

Config is the `test` block of `vite.config.ts`; `testTimeout` and `hookTimeout` are 30s
there (not a CLI flag), so a slower test gets an explicit timeout
(`test(name, fn, 90_000)`).

- **`import.meta.dir` is `undefined`** under Vitest's module runner. Use
  `import.meta.dirname` (Bun supports it), in production files too: a file that reads
  `import.meta.dir` cannot be imported by a test.
- **Bun-only matchers do not exist.** `toStartWith`, `toEndWith`, `toBeString` and
  `toBeNumber` fail with `Invalid Chai property`; use an anchored `toMatch` or
  `toBeTypeOf`. `expect(...).rejects` must be awaited, or Vitest fails the test. `%p`
  is not a `test.each` placeholder; use `%o` or `%s`.
- **A Lexical import cycle looks like `(0 test)`** plus `TypeError: Spread syntax
  requires ...iterable not be null or undefined`. A module-level
  `const NODES = [...KANNA_MESSAGE_NODES]` spreads an export the cycle has not
  initialised yet. Make it lazy, as `renderMessage.tsx` does, rather than reordering
  imports.
- **The `production` export condition is test-mode only.** Lexical 0.45's dev ESM build
  has a circular-dependency TDZ, so `resolve.conditions` and `ssr.resolve` carry
  `production` when `mode === "test"`. Setting it unconditionally changes the client
  build; `bun run build:client` + `bun run check:bundle` must report the same gzip bytes.
- **`blob:` URLs are external** (`server.deps.external`): plugin tests `import()` a
  `blob:` URL that only Bun's native loader resolves.
- **Keep the default `sequence.hooks` (`"stack"`).** `afterEach` hooks run in REVERSE
  registration order, so the sweep in `scripts/test-setup.ts` runs after every hook a
  test file registers. `"list"` fires the sweep first and fails tests that clean up.
- **`tsconfig` is pinned to the root one in test mode**, because `wiki/` extends a
  config that only exists inside `wiki/node_modules`.

## React roots, subprocesses, and module mocks

**Unmount every React root.** happy-dom gives the worker one document, and
`scripts/test-setup.ts` wipes `document.body` after each test. A root left mounted,
with any portal it opened, later throws `removeChild: The node to be removed is not a
child of this node` against whichever test is running then. Call `root.unmount()`, not
just `container.remove()`. The `afterEach` sweep fails the test that leaked and names
the nodes; it reports only React-owned leftovers, since Lexical's typeahead appends a
menu to `document.body` that nothing can commit against later. Mount components with
store-writing effects through `renderForLoopCheck` (`src/client/lib/testing/`): it
unmounts roots whose callers skipped its `cleanup` via the teardown registry the setup
file publishes on `globalThis.__kannaDomTeardowns`. A helper cannot own an `afterEach`
for this, because the setup file's sweep must run after every hook a test registers.

**Subprocess-spawning tests** need `stdin: "ignore"` and `GIT_TERMINAL_PROMPT=0`,
so a hung credential prompt cannot eat the 30s timeout from `vite.config.ts`.

**`vi.mock` and `vi.doMock` are banned.** A module mock substitutes the module for
every importer in the file and keeps passing when the real dependency breaks. Under the
old `bun test` runner `mock.module` also rewrote the process-wide registry and killed
unrelated suites in CI's file order, which blocked the v1.58.0 publish (#1141); Vitest
isolates each file, so that is historical, but the policy stays. Inject the dependency
instead (the shape above). `src/ops/testing/module-mock-guard.test.ts` fails any mock
outside `LEGACY_MODULE_MOCKS`; that list only shrinks, so converting a file to
injection deletes its entry in the same PR. The one sanctioned module patch is the
`node:fs` watch shim in `scripts/test-setup.ts`, armed only by `KANNA_WATCH_LEAK=1`: it
runs before every test file and spreads the real module, so it cannot create order
dependence. Check it with
`KANNA_WATCH_LEAK=1 bun run test src/server/workflow-watch-io.adapter.test.ts` and look
for `[watch-leak] detector armed` on stderr.

## Gate reference

[references/gates.md](references/gates.md) covers what each lint gate protects
and how to satisfy it: the side-effect seal (IO in `*.adapter.ts`), the design
gate (tokens, contrast pairings), every ast-grep rule, and the pending-state
promise rules. Read the matching section when one of those gates fails.
