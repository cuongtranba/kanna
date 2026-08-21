---
name: kanna-test
description: How to verify a change in the Kanna repo — running tests, and clearing the lint, ast-grep, and design gates that block merges. Use whenever you are about to run tests or report work as done, when a test passes locally but fails on CI, when you hit an ESLint error about node:fs / process.env / a raw hex color / backdrop-blur / a native title attribute, when ast-grep rejects a hook argument or a store selector, when happy-dom throws "removeChild: The node to be removed is not a child of this node", or when React error #185 "Maximum update depth exceeded" appears. Read it before writing a test that mounts a component, and before adding any file that performs IO.
user-invocable: false
---

# Verifying a change in Kanna

Kanna enforces most of its conventions mechanically, so "it looks right" is not a
signal. Several of the gates fail in ways that point at the wrong file — or only on
CI — so knowing what each one guards saves a long hunt.

## The commands

```bash
bun run test        # bun test --conditions production --timeout 30000
bun run lint        # eslint src/ --max-warnings=0
bun run typecheck   # TypeScript 7 native compiler
bun run lint:usestate   # ast-grep scan (React #185 + store-discipline rules)
bunx ast-grep test      # the ast-grep rules' own fixture tests
```

`bun run verify:client-arch` chains ast-grep, lint, typecheck, and test — the full
gate, and what to run before declaring UI work done.

**Always run tests through `bun run test`, never bare `bun test`.** The
`--conditions production` flag is load-bearing: Lexical 0.45's dev ESM build has a
circular-dependency TDZ that crashes the run outright, so a bare `bun test` fails
for a reason that has nothing to do with your change. For a single suite while
iterating: `bun test --conditions production src/server/<file>.test.ts`.

**Typecheck through the script, never bare `tsc`.** Two TypeScript packages are
installed — `typescript` (6.x, whose legacy compiler API typescript-eslint still
needs) and `typescript-7` (the real compiler). Both ship a `tsc` binary, so
`bunx tsc` resolves ambiguously. `bun run typecheck` calls TS7 by explicit path.

**Scope test runs to what you changed.** A full-suite run from a subagent while
other agents work the same host exhausts it. Targeted suites plus a typecheck cover
your change; run the full suite once, from the main agent, before pushing.

## Tests that mount React must unmount

happy-dom gives the whole Bun process **one** document, and the preload wipes
`document.body` after each test. That wipe cannot reach a React root you left
mounted — and any portal it opened (Radix Dialog, Popover, Select, or a bare
`createPortal`) used `document.body` itself as its container. When that root next
commits, React tries to remove a node the wipe already took, and happy-dom throws:

```
removeChild: The node to be removed is not a child of this node
```

blaming **whichever test happens to be running at that moment** — a different test,
in a different file. File order comes from the filesystem, so this reproduces on
CI's ext4 and not on APFS. One leaked root in `SharePopover` crashed `CardDrawer`
two files later, with the whole suite green locally.

So: call `root.unmount()`, not just `container.remove()`. The `afterEach` sweep now
fails the test that leaked and names the nodes, so you get told directly instead of
watching an unrelated file explode. For components with effects that write stores,
mount through `renderForLoopCheck` (`src/client/lib/testing/`) — it unmounts roots
whose callers forgot the returned `cleanup`, and asserts no render-loop warnings.

**Subprocess-spawning tests** need `stdin: "ignore"` and `GIT_TERMINAL_PROMPT=0`,
or a credential prompt hangs until the timeout, plus an explicit per-test timeout
(`test(name, fn, 30_000)`) since CI runners are slower than the 5 s default.

## The gates, and what each one is protecting

### Side-effect seal — IO lives in adapters

`node:fs`, `chokidar`, sqlite/pg drivers, `node:child_process`, `node:http(s)`,
`Bun.spawn`/`Bun.$`/`Bun.file`, `new Database`, `process.exit`, and `process.env`
are errors across `src/shared/**`, `src/client/**`, **and** `src/server/**`
production code. Browser-native `fetch` is deliberately allowed in shared/client.

Exempt in the server layer: `*.test.ts(x)`, `src/server/__fixtures__/**`,
`src/server/test-helpers/**`, `src/server/adapters/**`, and any
`src/server/**/*.adapter.ts`.

New IO therefore goes one of two ways: put the call in a file matching an exempt
glob, or inject the operation as a typed port parameter. A file whose whole job is
performing one side effect on behalf of a port is named `*.adapter.ts` and sits
next to that port; a module mixing domain logic with IO extracts the IO into a
sibling `*-io.adapter.ts` rather than renaming the parent. There is no escape
valve — do not reach for `eslint-disable`. Keeping the domain pure is what lets
most of this codebase be tested with plain values instead of mocks.

### Design gate — tokens, not literals

Under `src/shared/**` and `src/client/**` these are errors: arbitrary hex Tailwind
utilities (`bg-[#…]`), raw 6/8-digit hex literals plus the black/white family,
`backdrop-blur`/`backdrop-filter` (the No-Glassmorphism rule — use a solid
`bg-background`), and a native `title` attribute on an intrinsic element (use the
project Tooltip via `TruncatedText` / `HoverHint`; `iframe` is excluded because its
`title` is an accessibility name). `DESIGN.md` at the repo root is the source of
truth; live tokens are in `src/index.css`.

One sanctioned exemption exists — `TerminalPane.tsx`, for rule 2 only, because
xterm's `ITheme` API takes hex strings rather than CSS vars. Do not add others.

**Tinted pills need a `-text` token.** A semantic surface (`bg-{color}/10`) paired
with a raw or `-foreground` color fails WCAG AA on at least one theme once
composited. Derive from `STATUS_PILL_CLASS` or `TONE_PAIRINGS`
(`src/shared/design/tone-pairings.ts`); `lint:usestate` bans the inline pairing and
`src/server/design/tone-pairings.test.ts` asserts ≥4.5:1 for every entry across
both themes. A new tint context means a new `TONE_PAIRINGS` entry, confirmed green
before you touch a component.

### ast-grep — the React #185 class

Four rules, all `error`, with fixtures in `rule-tests/`:

- **`no-unstable-hook-fn-arg`** — an inline arrow passed directly to any custom
  `use*` hook. A hook that keys an effect on that argument re-runs it every render.
  Bind with `useCallback`/`useMemo` or hoist. React built-ins that ref-stash or read
  the argument once are safe-listed; `useSyncExternalStore` stays flagged, because
  an inline subscribe resubscribes every render.
- **`no-unstable-selector-fallback`** — a `use*Store` selector returning inline
  `?? []` / `?? {}` without `useShallow`. A fresh reference every call is exactly
  what drives "Maximum update depth exceeded". Use a module-level `EMPTY` constant
  or `useShallow`.
- **`no-jsx-inline-state-updater`** and **`no-jsx-inline-state-logic`** — state
  *transitions* belong in the store, not in a JSX attribute. A pure transition
  becomes one named store action; orchestration over props, refs, or async IO
  becomes an extracted `useCallback`, since stores never absorb props, refs, or IO.
  Both are tsx-only by design — `jsx_attribute` does not exist in the typescript
  grammar, so the missing `-ts` twin is impossible, not an oversight.

Never silence a false positive with an `ignores` entry: extract the handler, or add
a `not:` clause together with a pinning fixture in the same PR. Adding a new rule
means adding both the tsx and `-ts` variants (where the grammar allows) plus
`rule-tests/` coverage, in that same PR — a note in a doc is not a gate.

### Lint warnings ratchet

`--max-warnings=0` is a cap that only moves down. When warnings drop, lower the cap
in the same PR so they cannot creep back.

## Before you say it is done

Run the gates, read the output, and state the result honestly — if a suite failed,
show it; if you skipped a check, name it. A change is finished when the work is
resolved at its root, its docs and `.c3/` facts are updated, and nothing is left
for a follow-up.
