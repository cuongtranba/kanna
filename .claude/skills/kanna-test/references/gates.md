# The gates, and what each one protects

## Contents

- Side-effect seal: IO lives in adapters
- Design gate: tokens, not literals
- ast-grep: every rule in rules/
- Pending-state gate: a client promise must be settled by someone

## Side-effect seal: IO lives in adapters

`node:fs`, `chokidar`, sqlite/pg drivers, `node:child_process`, `node:http(s)`,
`Bun.spawn`/`Bun.$`/`Bun.file`, `new Database`, `process.exit`, and `process.env`
are errors across `src/shared/**`, `src/client/**`, **and** `src/server/**`
production code. `src/beacon/**` has its own seal with the same shape (IO only in
`src/beacon/**/*.adapter.ts`). The lint seal leaves `fetch` alone, but the ast-grep rule
`no-raw-fetch` bans it in `src/client/**` outside `src/client/api/**` and
`*.adapter.ts` (see below); `src/shared/**` may call it.

Exempt in the server layer: `*.test.ts(x)`, `src/server/__fixtures__/**`,
`src/server/test-helpers/**`, `src/server/adapters/**`, and any
`src/server/**/*.adapter.ts`.

New IO therefore goes one of two ways: put the call in a file matching an exempt
glob, or inject the operation as a typed port parameter. A file whose whole job is
performing one side effect on behalf of a port is named `*.adapter.ts` and sits
next to that port; a module mixing domain logic with IO extracts the IO into a
sibling `*-io.adapter.ts` rather than renaming the parent. There is no escape
valve: do not reach for `eslint-disable` or `oxlint-disable`. Keeping the domain pure is what lets
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

## ast-grep: every rule in rules/

`bun run lint:usestate` (`ast-grep scan`, run by CI) applies every rule below at
`error`. Each has a `tsx` file and a `-ts` twin unless noted; the rule's `note:`
field names the fix and the ADR. All scope to `src/client/**` minus tests unless
noted.

- **`no-unstable-hook-fn-arg`**: an inline arrow passed directly to a custom `use*`
  hook. A hook that keys an effect on it re-runs every render (React #185). Bind
  with `useCallback`/`useMemo` or hoist. Safe-listed: React built-ins that
  ref-stash or read the argument once, `useShallow`, and `use*Store` selectors;
  `useSyncExternalStore` stays flagged. Safe-list a new hook only with proof it
  ref-stashes its callbacks, editing the regex in both variants in the same PR.
- **`no-unstable-selector-fallback`**: a `use*Store` selector returning inline
  `?? []` / `?? {}` / `|| []` / `|| {}` without `useShallow`. Use a module-level
  `EMPTY` constant or `useShallow`.
- **`no-jsx-inline-state-updater`** (tsx only): a functional updater
  `setX((prev) => …)` inside a JSX attribute. Replace it with a named store action
  that derives the previous value itself.
- **`no-jsx-inline-state-logic`** (tsx only): an inline JSX-attribute arrow calling a
  mutation verb with more than one statement or a lone `if`. A pure transition
  becomes one store action; orchestration over props, refs, or async IO becomes an
  extracted `useCallback`. A new action verb outside
  `set|toggle|clear|reset|open|close|select|begin|finish|mark|dismiss|apply` means
  extending the regex and adding a `rule-tests/` case in the same PR. Both jsx
  rules are tsx-only because the typescript grammar has no `jsx_attribute`.
- **`no-react-usestate`**: `useState` for application state. Singleton state goes in
  `src/client/stores/<feature>Store.ts`; per-instance state in a colocated
  `<Component>.store.ts` via `createScopedStore`.
- **`no-raw-fetch`**: `fetch` / `XMLHttpRequest` outside `src/client/api/**` and
  `*.adapter.ts`. Add a queryFn under `src/client/api/` and call it through React
  Query.
- **`no-raw-websocket`**: `new WebSocket`. Go through `socketStore` actions, fed by
  `SocketBridge`.
- **`no-clientside-effects`**: raw `localStorage`, `sessionStorage`, timers,
  `requestAnimationFrame`, `document`, `window`, or `navigator`. Reach them through
  the storage, timer, and dom adapters in `src/client/adapters/`.
- **`no-arbitrary-px-text`**: `text-[14px]`-style utilities. Use a `--text-N` scale
  token from `src/index.css`.
- **`no-inline-tint-pairing`** (tsx only, no test exemption): a semantic
  `text-{color}` paired inline with `bg-{color}/`. Derive the classes from
  `TONE_PAIRINGS` or `STATUS_PILL_CLASS`.
- **`no-await-in-promise-all`** (all of `src/**`): `await` inside a `Promise.all([...])`
  array, which serialises the work. Pass unawaited promises; awaiting inside an
  async `.map()` callback is fine.

Never silence a false positive with an `ignores` entry: extract the handler, or add
a `not:` clause together with a pinning fixture. A new rule ships with both variants
(where the grammar allows) and `rule-tests/` coverage in the same PR, checked
locally with `bunx ast-grep test` (CI does not run the fixtures). A note in a doc is
not a gate.

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
its test; make it `async () => {}`. How the trigger renders the pending state is in
`.claude/skills/kanna-react-style/SKILL.md`.
