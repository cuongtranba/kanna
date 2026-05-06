---
name: kanna-react-style
description: React + TypeScript coding style for Kanna's client (src/client/**). Apply when creating or editing any .tsx/.ts file under src/client, src/shared, or src/server that ships UI behavior. Covers component shape, props typing, state-aware helpers, format helpers, snapshot-stable rendering, mobile/desktop variants, tabular numerics, project-Tooltip-over-native-title, centralized abstractions, co-located tests, and TDD commit cadence. Trigger on phrases like "add a component", "render X in the navbar", "format duration", "show state", "fix this UI bug", "extract a shared component", "write a test for this", or whenever editing existing components in src/client/components, src/client/app, or src/client/lib.
user-invocable: false
---

# Kanna React style

Patterns the Kanna client follows. Match them when adding or editing UI code so the codebase stays coherent.

## File layout

```
src/shared/types.ts           # cross-boundary types (server <-> client)
src/server/...                # event-sourced server, ports, read-models
src/client/lib/<helper>.ts    # pure helpers, lowest-level
src/client/lib/<helper>.test.ts  # co-located test
src/client/components/<group>/<Component>.tsx
src/client/components/<group>/<Component>.test.tsx
src/client/app/<Page>.tsx     # page-level composition
```

Prefer co-located tests (`Foo.tsx` next to `Foo.test.tsx`). Helpers separate from components — components import helpers, never the inverse.

## Strong typing — no `any`, no `unknown`

The repo's TS strictness is non-negotiable. Concrete types or interfaces, never `any`. `unknown` is acceptable only when narrowed within the same scope. Test files may use `as any` to reach private members or fixture mocks; production code may not.

If a type doesn't exist yet, add it. Co-locate single-use types with the component; lift to `shared/types.ts` only when crossing the WS boundary.

```ts
// Yes
interface Props {
  message: ProcessedResultMessage
}

// No
function ResultMessage({ message }: { message: any }) { ... }
```

## Pure helpers in `src/client/lib/`

Format, label, and tone logic belongs in `src/client/lib/*.ts`, not inline in components. Helpers must be pure (no DOM, no `Date.now()`, no globals — take inputs as args).

Examples from this codebase:
- `formatDuration.ts` — `formatCompactDuration(ms)`, `formatLiveDuration(ms)`
- `statusLabel.ts` — `statusLabel(status)`, `statusTone(status)`, `statusToneClass(tone)`

Why pure: helpers are deterministic given args, so tests are trivial and rerenders are stable.

```ts
// Yes — pure, args supply state
export function formatCompactDuration(ms: number): string { ... }

// No — helper reads ambient time, callers can't snapshot
export function formatAge(): string { return new Date().toString() }
```

## Snapshot-stable rendering

When the server pushes timing/state via WS snapshots, format using the **server's** timestamp baked into the snapshot (e.g. `derivedAtMs`), not `Date.now()` at render. This keeps numbers stable across React rerenders that fire between events.

```tsx
// Yes
<span>{formatCompactDuration(timings.derivedAtMs - timings.stateEnteredAt)}</span>

// No — drifts on every rerender even with no new event
<span>{formatCompactDuration(Date.now() - timings.stateEnteredAt)}</span>
```

Where Date.now is unavoidable (e.g. sidebar rows that don't carry derivedAtMs), accept it but use `tabular-nums` to mask jitter.

## State-aware label + tone helpers

When a single enum drives both human-readable text and visual tone, write three thin helpers next to each other:

```ts
// statusLabel.ts
export function statusLabel(status: KannaStatus): string { /* enum -> "Idle"/"Running" */ }
export function statusTone(status: KannaStatus): StatusTone { /* enum -> tone enum */ }
export function statusToneClass(tone: StatusTone): string { /* tone -> Tailwind class */ }
```

Components compose: `statusToneClass(statusTone(status))`. Adding a new status touches one file. Never ship raw enum identifiers to UI (`waiting_for_user` should never render as text).

## Centralize repeated markup

Three lines is fine. Two near-identical JSX blocks across two render paths is duplication — extract to a component. Pattern from this codebase: `TurnDurationFooter` covers both success and failure branches of `ResultMessage`, parameterized by a `prefix` prop (`"Worked for"` vs `"Failed after"`).

Signs you should extract:
- Same wrapper markup in two `if/else` arms of one component
- Same markup repeated across sibling components
- Format helper invoked from JSX in three places

```tsx
// Yes — one source of truth, branches differ only by prop
{success ? <TurnDurationFooter durationMs={d} /> : <TurnDurationFooter durationMs={d} prefix="Failed after" />}

// No — copy-paste markup with different label string
{success
  ? <MetaRow><MetaLabel>Worked for {fmt(d)}</MetaLabel></MetaRow>
  : <MetaRow><MetaLabel>Failed after {fmt(d)}</MetaLabel></MetaRow>}
```

## Defensive guard, not optional chaining the JSX

When required props can be absent, render `null` (or a stable fallback wrapper) early. Don't sprinkle `?.` deep inside the JSX tree — readers can't tell what's optional.

```tsx
// Yes
{timings && status ? (
  <div className="flex-1 flex items-center justify-center">
    <span>{statusLabel(status)} {formatLiveDuration(timings.derivedAtMs - timings.stateEnteredAt)}</span>
  </div>
) : (
  <div className="flex-1 min-w-0" />  // preserve layout
)}

// No
<div>
  <span>{status ? statusLabel(status) : ""}</span>
  <span>{timings?.derivedAtMs ? formatLiveDuration(timings.derivedAtMs - timings.stateEnteredAt) : null}</span>
</div>
```

The fallback `<div className="flex-1 min-w-0" />` matters: without it, the sibling layout collapses when the data isn't ready.

## Mobile vs desktop: CSS variants, not JS branches

Use Tailwind's `hidden md:flex` / `flex md:hidden` to render two markups one of which the browser shows. Don't compute the breakpoint in React.

```tsx
// Yes — both render, CSS picks one
<>
  <span className="hidden md:flex ...">{full}</span>
  <span className="flex md:hidden ...">{compact}</span>
</>

// No — JS reads window, causes hydration mismatches and SSR drift
{useIsMobile() ? <CompactPill /> : <FullPill />}
```

## `tabular-nums` for live numerics

Any element where digits change in place (timers, counters, durations, monospace stamps) gets `tabular-nums`. Without it the row jitters horizontally as glyph widths change.

```tsx
<span className="text-xs text-muted-foreground tabular-nums">{formatLiveDuration(elapsed)}</span>
```

## Project Tooltip over native `title`

Native `title=""` is laggy (~700ms hover delay), unstyled, and renders as one line joined by `·` or `\n`. Use the project's `Tooltip` / `TooltipTrigger` / `TooltipContent` from `src/client/components/ui/tooltip` for any breakdown longer than a few words.

```tsx
// Yes
<Tooltip>
  <TooltipTrigger asChild><span className="cursor-help">{stateLabel}</span></TooltipTrigger>
  <TooltipContent>
    <div>Chat created {ago}</div>
    <div>Idle {idle}</div>
    <div>Running {running}</div>
  </TooltipContent>
</Tooltip>

// No
<span title={`Chat created ${ago} · Idle ${idle} · Running ${running}`}>{stateLabel}</span>
```

## TDD commit cadence

Bug fixes and small additions can ship as a single commit. New behavior is two commits:

1. `test(scope): add <thing> tests (failing)` — the failing test file alone
2. `feat(scope): implement <thing>` — minimal code to pass

Why split: the first commit alone proves the test is meaningful (it can fail). A green test added alongside the implementation can be a tautology. The repo's history under `feature/chat-session-timings` follows this pattern.

## Conventional commit prefixes

Match the repo's existing convention:
- `feat(scope): ...` — new behavior
- `fix(scope): ...` — bug fix
- `test(scope): ...` — test-only changes
- `chore(scope): ...` — refactor, dependency, infra
- `docs(scope): ...` — markdown only
- `ux(scope): ...` — visual / interaction polish that isn't a bug

Scope is the most specific subdir or component name (`chat-navbar`, `read-models`, `event-store`, `result-message`). Subject ≤ 50 chars, present tense, no period.

## Don't over-comment

Default: zero comments. Only annotate **why** when:
- A subtle invariant exists that the code can't express
- A workaround for a specific bug or constraint
- An intentional `Math.max(0, ...)` guarding against clock skew

Don't restate the code, don't reference the PR, don't add `// added for issue #28` — those rot. Prefer renaming the variable or extracting a helper over writing a comment.

## Live state vs idle state styling

When a row or pill represents a live process, give the live variant a **different visual weight** than the idle one:
- Idle: `text-muted-foreground`, default opacity
- Live (running/waiting/failed): full opacity, `font-medium`, tone-colored dot
- Use `tabular-nums` on the live duration so it ticks without re-laying-out the row

The sidebar `ChatRow` widens its trailing slot (`w-6 → w-20`) when the chat is live so a longer `Running 0:12` label fits without colliding with the hover-only action buttons. Apply the same trick anywhere a live label needs more horizontal space than its idle counterpart.

## Server boundary contract

Anything that crosses the WS boundary lives in `src/shared/types.ts`. `ChatRuntime`, `SidebarChatRow`, `ChatStateTimings` — all defined once and imported on both sides. Never duplicate a shape on the client. Never let a server-only type leak into the client (server types live in `src/server/events.ts` etc.).

When extending a shared type, keep new fields:
- Required if every snapshot will populate them (e.g. `timings: ChatStateTimings` on `ChatRuntime`)
- Optional if only some rows carry them (e.g. `stateEnteredAt?: number` on `SidebarChatRow`)

## Resource safety when running tests

Tests run via `bun test <path>`. Only run tests for files you change:

```bash
bun test src/server/event-store src/server/read-models
bun test src/client/lib/formatDuration src/client/components/messages
bunx tsc --noEmit
```

Never run the full suite from a subagent — parallel full builds exhaust the host. Targeted runs scoped to changed files + a typecheck cover the same ground for the work you actually did.

## When in doubt

Look at recent commits on `main` (or a feature branch shipped recently — e.g. `feature/chat-session-timings`) for the most current example of a pattern. The code on disk is the spec; this skill is a quick reference for the shapes that recur.
