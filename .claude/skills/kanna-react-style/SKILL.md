---
name: kanna-react-style
description: React + TypeScript coding style for Kanna's client (src/client/**). Apply when creating or editing any .tsx/.ts file under src/client, src/shared, or src/server that ships UI behavior. Covers component shape, props typing, state-aware label and tone helpers, pure format helpers, snapshot-stable rendering, mobile/desktop CSS variants, flex rows that never overlap (truncate, break or hold, enforced by lint:flex-overflow), tabular numerics, project-Tooltip-over-native-title, reusing existing primitives before writing new markup, co-located tests, and commit cadence. Trigger on phrases like "add a component", "render X in the navbar", "put this in the sidebar", "format a duration", "show the status", "fix this UI bug", "the number jitters on every tick", "extract a shared component", "make it work on mobile", "the row overlaps", "the badge covers the input", or whenever editing anything under src/client/components, src/client/app, or src/client/lib. Read it before writing the component, not after.
user-invocable: false
---

# Kanna React style

Patterns the Kanna client follows. Match them when adding or editing UI code so the codebase stays coherent. Read `DESIGN.md` (repo root) before any UI work; live tokens are in `src/index.css`.

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

## Strong typing — no `any`, no casts, no `unknown`

`bun run lint` bans `any`, both cast spellings (`x as T`, `<T>x`), and `unknown` in every position of production code. Parsed JSON is `JsonValue` / `JsonObject` (`src/shared/json.ts`), narrowed with `isJsonObject`; a caught error goes through `toError()`. Tests are lint-exempt, but the test-style ratchet counts `as unknown as`, so build real fixtures.

If a type doesn't exist yet, add it. Co-locate single-use types with the component; lift to `shared/types.ts` only when crossing the WS boundary.

```ts
// Yes
interface Props {
  message: TranscriptMessageOf<"result">
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

## Check existing primitives before creating new ones

Before writing a fresh component, scan the relevant `shared.tsx` (or `ui/`) for primitives that already cover the pattern. Two primitive registries to check:

- **Generic UI**: every file in `src/client/components/ui/` (list the directory; it holds buttons, dialogs, tooltips, `truncated-text`, `status-pill`, `spinner`, selects and more).
- **Message rendering**: `src/client/components/messages/shared.tsx` — `MetaRow`, `MetaContent`, `MetaSeparator`, `MetaLabel`, `MetaText`, `RuledLabel`, `ExpandableRow`, `MetaCodeBlock`, `MetaPill`, `VerticalLineContainer`.

Two-tier rule:
1. **If a primitive already fits**, use it directly. No new file.
2. **If you find yourself reaching for new ad-hoc markup that resembles a generic shape** (rule lines + label, dot + text + duration, icon + collapsible block, etc.), the right move is to add the **primitive** to the appropriate `shared.tsx` and have your specific component compose it. Don't bake the generic shape into a domain-specific file — it'll get re-invented next time.

Real example from this codebase: `TurnDurationFooter` first inlined the `<line><MetaLabel>X</MetaLabel><line>` sandwich. That sandwich is generic ("centered label flanked by horizontal rules"), so it was hoisted to `messages/shared.tsx` as `RuledLabel`. `TurnDurationFooter` shrank to a one-liner that composes `RuledLabel`. Future ruled footers (e.g. compact-summary boundaries, divider headers) can now use `RuledLabel` without copying the divider markup.

```tsx
// Yes — domain component composes shared primitive
export function TurnDurationFooter({ durationMs, prefix = "Worked for" }: Props) {
  if (durationMs <= 0) return null
  return <RuledLabel>{prefix} {formatTurnDuration(durationMs)}</RuledLabel>
}

// No — generic rule-line shape baked into one component
export function TurnDurationFooter(...) {
  return (
    <MetaRow className="...">
      <div className="w-full h-[1px] bg-border" />
      <MetaLabel className="...">{prefix} {fmt(durationMs)}</MetaLabel>
      <div className="w-full h-[1px] bg-border" />
    </MetaRow>
  )
}
```

When deciding whether a new shape is "generic enough" to belong in `shared.tsx`: ask whether two unrelated callers would plausibly want it. If yes, hoist it. If only one caller will ever want it, keep it co-located with that caller.

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

// No — re-renders on every resize and reads window, which no-clientside-effects routes through the dom adapter
{useIsMobile() ? <CompactPill /> : <FullPill />}
```

## `tabular-nums` for live numerics

Any element where digits change in place (timers, counters, durations, ages, pids, monospace stamps) gets `tabular-nums`. Without it the row jitters horizontally as glyph widths change.

```tsx
<span className="text-xs text-muted-foreground tabular-nums">{formatLiveDuration(elapsed)}</span>
```

## Flex rows never overlap

A row of label, value, badges and controls gets narrow: the settings column is a fixed 420px,
the sidebar is resizable, phones are 360px. In a non-wrapping flex row every item keeps its
`min-content` width, so a `shrink-0` badge or control cluster beside an unbreakable value
(`api_key_cuong`, a tool name, a job id) pushes the row past its box and the items paint
over each other. The token pool row overlapped its Concurrent control exactly this way once
an API key badge joined the label line.

Decide, for every piece of data text in a row, whether it **yields** or **holds**:

| The text is | Give it | Example |
| --- | --- | --- |
| a name or id that may be long, one line | `truncate`, or `TruncatedText` when the full value matters | label, job id, branch |
| an identifier the reader must see whole | `min-w-0 break-all` | tool name, path |
| prose | `min-w-0 break-words` | notice, description |
| short bounded metadata | `shrink-0` (or `whitespace-nowrap`) | count, clock, badge |

At least one item must yield. When several items must stay whole (badges, a masked token, a
status), don't squeeze them onto the label line: move them to a second `flex flex-wrap` line,
as `OAuthTokenPoolCard` does. The column wrapping a yielding item needs `min-w-0` too, or it
refuses to shrink.

`bun run lint:flex-overflow` (`scripts/flex-overflow-scan.ts`, in `bun run check` and CI) fails
on a non-wrapping `flex`/`inline-flex` row that has a `shrink-0`, `flex-none` or
`whitespace-nowrap` child and either (a) a child element rendering `{data}` without a yield or
hold utility (`undeclared-text`), or (b) only holding children (`nothing-yields`). It reads
static class text only, so it cannot see width from a component's own props; still check the
narrowest width the row lives at before you ship.

```tsx
// Yes — the label yields, the badges hold on a wrapping second line
<div className="min-w-0 flex-1">
  <div className="flex min-w-0 items-center gap-2">
    <TruncatedText inline tooltip={entry.label} className="min-w-0 text-sm">{entry.label}</TruncatedText>
    {isCurrent && <span className="shrink-0 whitespace-nowrap ...">In use</span>}
  </div>
  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
    <StatusPill entry={entry} now={now} />
    <code className="whitespace-nowrap ...">{maskToken(entry.token)}</code>
  </div>
</div>

// No — nothing can shrink, so the line overflows onto the controls beside it
<div className="flex items-center gap-3">
  <span>{entry.label}</span>
  <code>{maskToken(entry.token)}</code>
  <span className="shrink-0 whitespace-nowrap ...">API key</span>
</div>
```

## Design rules no linter checks

- No pulse or glow on a status dot (`animate-pulse` is fine on skeletons).
- Kanna Coral covers at most 10% of a screen, and only for the brand mark and destructive intent.
- Flat by default: depth comes from contrast and a 1px soft edge, not shadow.
- Color never communicates alone; pair it with an icon, a label, or weight.

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

Why split: the first commit alone proves the test is meaningful (it can fail). A green test added alongside the implementation can be a tautology.

## Conventional commit prefixes

Conventional Commits, as `git log` on `main` shows (`feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `chore`, `ci`); the type decides the release bump, so `.claude/skills/release/SKILL.md` and `bun run check:commits` own the rules. Scope is the most specific subdir or component name (`chat-navbar`, `read-models`, `event-store`).

## Every side effect shows it is in flight

A control that sends a WS command or an HTTP request renders a pending state
until the request settles. Launch the request with `runPendingAction` and render
`usePendingAction` on the trigger. Both come from
`src/client/stores/pendingActionsStore.ts`:

```tsx
// Yes: the button disables, shows a spinner, and ignores a double click
const key = pendingActionKey("chat.archive", chat.chatId)
const archiving = usePendingAction(key)
const handleArchive = useCallback(() => runPendingAction(key, () => onArchive(chat)), [key, onArchive, chat])
<Button pending={archiving} onClick={handleArchive}>Archive</Button>

// No: nothing happens on screen until the server answers, and a failure vanishes
<Button onClick={() => void onArchive(chat)}>Archive</Button>
socket.command({ type: "cron.remove", chatId, jobId }).catch(() => {})
```

- **`runPendingAction` ignores a second trigger** while the first is in flight,
  clears the flag on settle, and logs a rejection. It returns `void`, so it is
  legal in any handler.
- **Keys** come from `pendingActionKey(scope, ...ids)`: the scope is the WS
  command type (`"chat.archive"`), plus the entity id for a per-row action so
  only that row reads as busy.
- **`<Button pending={pending}>`** disables, sets `aria-busy`, and adds a spinner.
  A non-Button trigger gets `disabled={pending}`,
  `aria-busy={pending || undefined}`, and `<Spinner />`
  (`components/ui/spinner.tsx`) in place of its icon.
  Toggles and selects are disabled while their write is in flight.
- **A menu item that closes on click** has nowhere to show pending, so render it
  on the row the action targets.
- **An async callback prop is typed `() => Promise<void>`**, and the child that
  owns the trigger launches it. Typing it `() => void` hides the promise from the
  one component that can show it. `no-misused-promises` rejects that mismatch.
- **Failures are shown**, through the component's error state or
  `setCommandError` (`kannaStateStore`) for a WS command, never only logged.
- **`runDetached(label, promise)`** (`src/client/lib/runDetached.ts`) is only for
  background work nobody waits on: reconnects, polling, a probe on mount, scroll,
  best-effort cleanup. Using it for a click is the one way around the gate.
- **No new per-component `saving`/`busy` boolean** for an action; use the store.
- **A loading view** renders a loading indicator, never an empty panel.

`bun run lint` enforces the launch side under `src/client/**`:
`no-floating-promises` with `ignoreVoid: false` (`void promise` fails;
`navigate()` is allowlisted), `no-misused-promises` on JSX attributes, and a ban
on `.catch(() => {})` / `() => undefined` / `() => null`. Never silence them with
`eslint-disable` or `oxlint-disable`. Whether the flag is actually rendered is on you
(`adr-20260925-client-pending-action-state`).

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

## Running tests and clearing the gates

`.claude/skills/kanna-test/SKILL.md` owns this: how the suite runs (`bun run
test`, Vitest via `vp test` under Bun), the requirement to unmount every React root you
mount, and the ast-grep and design gates that reject inline hook arguments, unstable
store selectors, raw hex colors, and native `title` attributes. Read it before
writing a test that mounts a component.

Scope runs to what you changed — a full suite from a subagent while other agents
share the host exhausts it:

```bash
bun run test src/client/lib/formatDuration
bun run typecheck
```

## When in doubt

Look at recent commits on `main` for the most current example of a pattern. The code on disk is the spec; this skill is a quick reference for the shapes that recur.
