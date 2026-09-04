---
title: Lint & Tests
description: Every gate that blocks a merge, and why each one exists.
---

## Run the tests

```bash
bun run test                          # everything
bun run test src/server/agent.test.ts # one suite
```

:::caution[Never bare `bun test`]
`bun run test` is `bun test --conditions production --timeout 30000`. The
`--conditions production` is not optional: Lexical 0.45's dev ESM build has a
circular-dependency TDZ that crashes a bare `bun test` before any test runs.
The 30 s timeout matters too — Bun's 5 s default is too tight for CI runners.
:::

## The gate list

CI runs these in order, and each covers something the others do not:

| Command | Catches |
| --- | --- |
| `bun run lint` | ESLint at `--max-warnings=0`: the side-effect seal and the design gate |
| `bun run lint:usestate` | ast-grep: the React #185 rules and inline tint pairings |
| `bun run check:arch` | The architecture budget ratchet |
| `bun run lint:limits` | Proves the complexity ceilings are still *tight* |
| `bun run typecheck` | TypeScript 7, by explicit path |
| `bun run build` | The client build |
| `bun run check:bundle` | Bundle size and CJS interop |
| `bun run test` | The suite |

`bun run check` chains typecheck → lint → build:client → check:bundle, which is
the fastest single command that catches most of it. `bunx ast-grep test` runs
the fixtures for the rules in `rules/`, and `bun run scan:secrets` runs gitleaks
over the working tree — wire the pre-commit hook once with `bun run setup:hooks`.

Two more workflows gate a PR: **gitleaks** (any finding blocks the merge) and
**semgrep**.

## Why `lint:limits` exists

`eslint.config.js` pins four complexity ceilings at today's maxima. A ceiling
nothing reaches gates nothing — pinned at 141 while the worst function is 90
leaves 50 points of free regression. `lint:limits` re-runs ESLint with every
ceiling lowered by one and requires each rule to report at least one violation,
which proves the ceiling is still binding.

## Why `check:arch` exists

The previous complexity program closed all seven of its workstreams as
COMPLETED while its own metrics moved the wrong way — modules over 700 lines
went 18 → 21 → 23 and production LOC rose by ~4,000. Nothing in CI could
observe that, so nothing objected.

`src/ops/architecture/budget.ts` now pins each defect population. A breach names
the filed issue your change just made worse. When one fires, check whether the
cheapest way to satisfy it is a **rename** — if it is, the pattern is measuring a
spelling rather than the defect, and the pattern is what needs fixing.

## The design gate

`bun run lint` also enforces the visual system (`DESIGN.md`) across
`src/client/**` and `src/shared/**`. Banned outright:

- Arbitrary hex Tailwind utilities (`bg-[#…]`) — use a token class
- Raw hex colour literals, including the `#000` / `#fff` family — use CSS vars
- `backdrop-blur` / `backdrop-filter` — the No-Glassmorphism rule
- Native `title` on intrinsic elements — use the project Tooltip

There is no escape valve; do not add `eslint-disable` comments.

Contrast is gated twice: `lint:usestate` bans inline tinted-pill pairings, and
`bun run test src/server/design/tone-pairings.test.ts` asserts WCAG AA for every
pairing in both themes. A raw semantic token (`--warning`, `--info`,
`--success`) is a **background, never ink** — `bg-warning` on a dot is right,
`text-warning` on a label is a bug, and a separate guard fails the build on it.

## Render-loop regression checks

A `use*Store` selector must return a stable reference. Inline `?? []` or `?? {}`
produces a fresh ref on every call and triggers React error #185:

```ts
const EMPTY: Subagent[] = []
useStore((state) => state.list ?? EMPTY)
// or
useStore(useShallow((state) => state.list ?? []))
```

Components with effects that write stores should be covered by
`renderForLoopCheck` in `src/client/lib/testing/`.

## Every React root a test mounts must be unmounted

This one is enforced, and the failure it prevents is genuinely baffling.

happy-dom gives the whole Bun process **one** document, and the test preload
wipes `document.body` after each test. That wipe cannot reach a React root the
test left alive — and any portal that root opened (Radix Dialog, Popover,
Select, `createPortal`) had `document.body` itself as its container. The next
time that root commits, React tries to remove a node the wipe already took, and
happy-dom throws `removeChild: The node to be removed is not a child of this
node` — blaming **whichever test happens to be running at that moment**, in a
different file.

File order is the filesystem's, so it reproduces on CI's ext4 and not on APFS.
In PR #646 a leaked `SharePopover` root crashed `CardDrawer` two files later,
with the full suite green locally.

The `afterEach` sweep now fails the test that actually leaked, naming the nodes.
Call `root.unmount()` — `container.remove()` is not enough.

## Test subprocess discipline

When a test spawns `git` or another subprocess:

- Set `stdin: "ignore"`
- Set `GIT_TERMINAL_PROMPT=0`
- Give it an explicit timeout: `test(name, fn, 30_000)`

A hung credential prompt otherwise eats the whole test timeout.

## Not on the critical path

`bun run test:e2e` (Playwright, real Chrome) is deliberately **not** wired into
CI — it needs a real browser, not the happy-dom that `bun test` runs against.
Run it on demand.
