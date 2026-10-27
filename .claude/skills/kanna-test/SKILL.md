---
name: kanna-test
description: Writes tests the Kanna way and verifies a change against the gates that block merges — bun tests, ESLint, ast-grep, the design gate, and the defect-count ratchets. Use when writing or changing a test, when about to run tests or report work as done, when a test passes locally but fails on CI, when a test reaches for mock(), spyOn, mock.module, a Date.now / fetch / window.confirm / console / process.env patch, a sleep, .skip or `as unknown as`, when check:arch reports a population that "grew to N (pinned at M)" or "dropped to N", when ESLint rejects node:fs / process.env / a raw hex color / backdrop-blur / a native title attribute / no-floating-promises / no-misused-promises / an empty .catch, when ast-grep rejects a hook argument or a store selector, when happy-dom throws "removeChild: The node to be removed is not a child of this node", when bun reports "Export named X not found in module" for an export that plainly exists, or when React error #185 "Maximum update depth exceeded" appears.
user-invocable: false
---

# Testing and verifying a change in Kanna

Kanna enforces most conventions mechanically, so "it looks right" is not a signal.
Several gates fail in ways that point at the wrong file, or only on CI.

## Contents

- Commands
- Verification workflow
- Writing a test
- Ratchets: a pin is a defect count
- React roots, subprocesses, and module mocks
- Gate reference ([references/gates.md](references/gates.md))

## Commands

```bash
bun run test                                     # never bare `bun test`
bun test --conditions production <file>.test.ts  # one suite while iterating
bun run typecheck                                # TS7 by explicit path, never bare tsc
bun run lint && bun run lint:comments            # ESLint gates + the no-comments rule
bun run lint:usestate && bunx ast-grep test      # React #185 + store rules, and their fixtures
bun run check:arch                               # architecture and test-style ratchets
```

`--conditions production` is load-bearing: Lexical's dev ESM build has a
circular-dependency TDZ that crashes a bare `bun test`. Two TypeScript packages
ship a `tsc` binary, so `bunx tsc` resolves ambiguously. `bun run verify:client-arch`
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

## Ratchets: a pin is a defect count

Each ratchet pins the size of a defect population. Growing fails, and shrinking
without lowering the pin also fails, so the pin cannot be reclaimed later.

| Ratchet | Where | Semantics |
| --- | --- | --- |
| `PATTERN_BUDGETS` | `src/ops/architecture/budget.ts` | exact pin over production code |
| `TEST_PATTERN_BUDGETS` | same file | exact pin over `*.test.ts(x)`: mocks, global patches, sleeps, `.only`, `.skip`, double casts, nested describes (#1375) |
| `MODULE_ALLOWANCES` | same file | per-module line ceiling over 700; delist when under |
| `ESLINT_LIMIT_PINS` | same file | equals the configured ESLint ceiling |
| `LEGACY_MODULE_MOCKS` | `src/ops/testing/module-mock-guard.test.ts` | shrink-only allowlist |
| `LEGACY_BODY_ALLOWANCES` | `src/ops/skills/skill-authoring.test.ts` | shrink-only SKILL.md body ceiling over 500 lines |

Reading a breach:

- **`grew to N (pinned at M)`**: the change added a defect. Remove it; do not raise
  the pin. The message names the issue the change regresses.
- **`dropped to N`**: the change removed defects. Set `max: N` in the named
  manifest in the same PR.
- **`scanned no files`**: the include path is stale. Repoint it; never pin at 0.

When a breach fires, check whether a rename would satisfy it. If it would, the
pattern is measuring a spelling, not the defect: widen the pattern instead.

## React roots, subprocesses, and module mocks

**Unmount every React root.** happy-dom gives the process one document, and the
preload wipes `document.body` after each test. A root left mounted, with any
portal it opened, later throws `removeChild: The node to be removed is not a child
of this node` against whichever test is running then, often in another file and
only in CI's file order. Call `root.unmount()`, not just `container.remove()`.
The `afterEach` sweep fails the test that leaked and names the nodes. Mount
components with store-writing effects through `renderForLoopCheck`
(`src/client/lib/testing/`).

**Subprocess-spawning tests** need `stdin: "ignore"`, `GIT_TERMINAL_PROMPT=0`, and
an explicit per-test timeout (`test(name, fn, 30_000)`).

**`mock.module` is banned.** It rewrites bun's process-wide module registry and
nothing restores it between files, so a factory that omits an export kills an
unrelated suite's import with `SyntaxError: Export named '…' not found in module`,
only in CI's file order. Inject the dependency instead (the shape above). The full
incident and the one sanctioned exception (`scripts/test-preload.ts`'s `node:fs`
shim) are in CLAUDE.md under "Module mocks are banned".

## Gate reference

[references/gates.md](references/gates.md) covers what each lint gate protects
and how to satisfy it: the side-effect seal (IO in `*.adapter.ts`), the design
gate (tokens, contrast pairings), the four ast-grep rules, the pending-state
promise rules, and the warnings cap. Read the matching section when one of those
gates fails.
