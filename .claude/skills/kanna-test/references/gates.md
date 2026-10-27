# The gates, and what each one protects

## Contents

- Side-effect seal: IO lives in adapters
- Design gate: tokens, not literals
- ast-grep: the React #185 class
- Pending-state gate: a client promise must be settled by someone
- Lint warnings ratchet

## Side-effect seal: IO lives in adapters

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
valve: do not reach for `eslint-disable`. Keeping the domain pure is what lets
most of this codebase be tested with plain values instead of mocks.

## Design gate: tokens, not literals

Under `src/shared/**` and `src/client/**` these are errors: arbitrary hex Tailwind
utilities (`bg-[#…]`), raw 6/8-digit hex literals plus the black/white family,
`backdrop-blur`/`backdrop-filter` (the No-Glassmorphism rule, so use a solid
`bg-background`), and a native `title` attribute on an intrinsic element (use the
project Tooltip via `TruncatedText` / `HoverHint`; `iframe` is excluded because its
`title` is an accessibility name). `DESIGN.md` at the repo root is the source of
truth; live tokens are in `src/index.css`.

One sanctioned exemption exists: `TerminalPane.tsx`, for rule 2 only, because
xterm's `ITheme` API takes hex strings rather than CSS vars. Do not add others.

**Tinted pills need a `-text` token.** A semantic surface (`bg-{color}/10`) paired
with a raw or `-foreground` color fails WCAG AA on at least one theme once
composited. Derive from `STATUS_PILL_CLASS` or `TONE_PAIRINGS`
(`src/shared/design/tone-pairings.ts`); `lint:usestate` bans the inline pairing and
`src/server/design/tone-pairings.test.ts` asserts ≥4.5:1 for every entry across
both themes. A new tint context means a new `TONE_PAIRINGS` entry, confirmed green
before touching a component.

## ast-grep: the React #185 class

Four rules, all `error`, with fixtures in `rule-tests/`:

- **`no-unstable-hook-fn-arg`**: an inline arrow passed directly to any custom
  `use*` hook. A hook that keys an effect on that argument re-runs it every render.
  Bind with `useCallback`/`useMemo` or hoist. React built-ins that ref-stash or read
  the argument once are safe-listed; `useSyncExternalStore` stays flagged, because
  an inline subscribe resubscribes every render.
- **`no-unstable-selector-fallback`**: a `use*Store` selector returning inline
  `?? []` / `?? {}` without `useShallow`. A fresh reference every call is exactly
  what drives "Maximum update depth exceeded". Use a module-level `EMPTY` constant
  or `useShallow`.
- **`no-jsx-inline-state-updater`** and **`no-jsx-inline-state-logic`**: state
  *transitions* belong in the store, not in a JSX attribute. A pure transition
  becomes one named store action; orchestration over props, refs, or async IO
  becomes an extracted `useCallback`, since stores never absorb props, refs, or IO.
  Both are tsx-only by design: `jsx_attribute` does not exist in the typescript
  grammar, so the missing `-ts` twin is impossible, not an oversight.

Never silence a false positive with an `ignores` entry: extract the handler, or add
a `not:` clause together with a pinning fixture in the same PR. Adding a new rule
means adding both the tsx and `-ts` variants (where the grammar allows) plus
`rule-tests/` coverage, in that same PR. A note in a doc is not a gate.

## Pending-state gate: a client promise must be settled by someone

`bun run lint` type-checks promises under `src/client/**` (tests excluded):

- **`no-floating-promises` with `ignoreVoid: false`.** `void save()` is an error. A
  user action goes through `runPendingAction(key, () => save())`
  (`src/client/stores/pendingActionsStore.ts`) and its trigger renders
  `usePendingAction(key)`. Background work nobody waits on goes through
  `runDetached(label, promise)`. Inside an async flow, `await` it.
- **`no-misused-promises` on JSX attributes.** An async function passed to a prop
  typed `() => void` is an error. Retype the prop to `() => Promise<void>` and have
  the child launch it with `runPendingAction`. Do not wrap the call in a sync arrow
  that drops the promise.
- **`.catch(() => {})` / `() => undefined` / `() => null` are banned.** They hide
  the failure and slip past the promise rules.

A sync fake handed to a prop that is now `() => Promise<void>` fails typecheck in
its test; make it `async () => {}`. The full rationale is in CLAUDE.md under
**Pending state for side effects**.

## Lint warnings ratchet

`--max-warnings=0` is a cap that only moves down. When warnings drop, lower the cap
in the same PR so they cannot creep back.
