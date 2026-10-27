---
name: kanna-test
description: Writes tests the Kanna way and verifies a change against the gates that block merges — bun tests, ESLint, ast-grep, the design gate, and the defect-count ratchets. Use when writing or changing a test, when about to run tests or report work as done, when a test passes locally but fails on CI, when a test reaches for mock(), spyOn, mock.module, a Date.now / fetch / window.confirm / console / process.env patch, a sleep, .skip or `as unknown as`, when ESLint rejects node:fs / process.env / a raw hex color / backdrop-blur / a native title attribute / no-floating-promises / no-misused-promises / an empty .catch, when ast-grep rejects a hook argument, a store selector, useState, raw fetch or WebSocket, or a raw timer/DOM global, when happy-dom throws "removeChild: The node to be removed is not a child of this node", when bun reports "Export named X not found in module" for an export that plainly exists, or when React error #185 "Maximum update depth exceeded" appears.
user-invocable: false
---

# Testing and verifying a change in Kanna

Kanna enforces most conventions mechanically, so "it looks right" is not a signal.
Several gates fail in ways that point at the wrong file, or only on CI.

## Contents

- Commands
- Verification workflow
- Writing a test
- React roots, subprocesses, and module mocks
- Gate reference ([references/gates.md](references/gates.md))

## Commands

```bash
bun run test                                     # never bare `bun test`
bun run test <file>.test.ts                      # one suite while iterating
bun run typecheck                                # TS7 by explicit path, never bare tsc
bun run lint && bun run lint:comments            # ESLint gates + the no-comments rule
bun run lint:usestate                            # every ast-grep rule in rules/ (CI runs this)
bunx ast-grep test                               # rule fixtures in rule-tests/ (local only; CI does not run it)
bun run check:arch                               # architecture and test-style ratchets
```

`bun run test` is `bun test --conditions production --timeout 30000`, the flags CI
uses; a bare `bun test` drops both. Two TypeScript packages ship a `tsc` binary,
so `bunx tsc` resolves ambiguously. `bun run verify:client-arch`
chains ast-grep, lint, typecheck, and test for client work.

Scope runs to what changed while iterating. A full-suite run from a subagent while
other agents share the host exhausts it; run the full suite once, from the main
agent, before pushing.

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
  object. A callback recorder is a plain array the fake pushes into, not `mock()`.
  This is what the side-effect seal buys: pure domain code takes plain values.
- **No global patches.** Do not reassign `Date.now`, `fetch`, `window.confirm`,
  `console.*`, or `process.env`. Every test file shares one bun process, so a
  failure before the restore line leaks the patch into whichever test runs next.
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

## React roots, subprocesses, and module mocks

**Unmount every React root.** happy-dom gives the process one document, and the
preload wipes `document.body` after each test. A root left mounted, with any
portal it opened, later throws `removeChild: The node to be removed is not a child
of this node` against whichever test is running then, often in another file and
only in CI's file order. Call `root.unmount()`, not just `container.remove()`.
The `afterEach` sweep fails the test that leaked and names the nodes; it reports
only React-owned leftovers, since Lexical's typeahead appends a menu to
`document.body` that nothing can commit against later. Mount components with
store-writing effects through `renderForLoopCheck` (`src/client/lib/testing/`): it
unmounts roots whose callers skipped its `cleanup` via the teardown registry the
preload publishes on `globalThis.__kannaDomTeardowns`. A helper cannot own an
`afterEach` for this, because bun runs hooks in registration order and the
preload's sweep registers first.

**Subprocess-spawning tests** need `stdin: "ignore"` and `GIT_TERMINAL_PROMPT=0`,
so a hung credential prompt cannot eat the 30s timeout `bun run test` sets.

**`mock.module` is banned.** It replaces an entry in bun's process-wide module
registry and nothing restores it when the file ends (`mock.restore()` covers
functions, not modules). If the mock registers before the real module loads, the
registry holds only the factory's exports, and the next file that imports a
missing one dies with `SyntaxError: Export named '…' not found in module`,
reported against that innocent file and only in CI's ext4 file order. A mock in
`usePluginContributions.test.tsx` did exactly that and blocked the v1.58.0 publish
(#1141). Inject the dependency instead (the shape above).
`src/ops/testing/module-mock-guard.test.ts` fails any mock outside
`LEGACY_MODULE_MOCKS`; that list only shrinks, so converting a file to injection
deletes its entry in the same PR. The one sanctioned module patch is
`scripts/test-preload.ts`'s `node:fs` shim: it loads before every test file and
spreads the real module, so it cannot create order dependence.

## Gate reference

[references/gates.md](references/gates.md) covers what each lint gate protects
and how to satisfy it: the side-effect seal (IO in `*.adapter.ts`), the design
gate (tokens, contrast pairings), every ast-grep rule, and the pending-state
promise rules. Read the matching section when one of those gates fails.
