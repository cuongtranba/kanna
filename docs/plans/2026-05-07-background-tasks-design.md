# Background Tasks: Visibility + Stop Control

**Date:** 2026-05-07
**Status:** Design

## Problem

When the agent runs a long-lived process via `Bash` with `run_in_background: true` (a dev server, a watch task), or when a turn finishes while its stream is still draining, or when a terminal-manager PTY or codex session is alive, the user has no central place to see what is still running. The chat-level "stop" button only stops the active turn, not the leftover processes. If the user forgets, resources leak across sessions and across Kanna restarts.

## Goal

Give the user one calm surface that lists every long-lived task Kanna is responsible for, with a clear way to stop each one, that survives chat closure and Kanna restart without surprises.

## Scope

All long-lived work owned by Kanna:

- **`bash_shell`** — Claude SDK Bash tool calls with `run_in_background: true`.
- **`draining_stream`** — turn finished, stream still open from leftover background work (existing `drainingStreams` map).
- **`terminal_pty`** — PTYs owned by `TerminalManager`.
- **`codex_session`** — sessions owned by `CodexAppServerManager`.

Out of scope: the active turn itself (already steerable via existing chat stop), foreign processes Kanna did not spawn, full log streaming inside the dialog.

## Architecture

### Data model

A new `BackgroundTaskRegistry` (`src/server/background-tasks.ts`) is the single source of truth across all four kinds. It is owned by `AgentCoordinator` and injected into `TerminalManager` and `CodexAppServerManager`.

```ts
type BackgroundTask =
  | { kind: "bash_shell"; id: string; chatId: string | null; command: string;
      shellId: string; pid: number | null; startedAt: number;
      lastOutput: string; status: "running" | "stopping"; orphan?: boolean }
  | { kind: "draining_stream"; id: string; chatId: string;
      startedAt: number; lastOutput: string }
  | { kind: "terminal_pty"; id: string; ptyId: string; cwd: string;
      startedAt: number; lastOutput: string }
  | { kind: "codex_session"; id: string; chatId: string;
      pid: number | null; startedAt: number; lastOutput: string }
```

### Registry API

```ts
class BackgroundTaskRegistry {
  list(): BackgroundTask[]
  listByChat(chatId: string): BackgroundTask[]
  register(task: BackgroundTask): void
  update(id: string, patch: Partial<BackgroundTask>): void
  unregister(id: string): void
  async stop(id: string, opts?: { force?: boolean }): Promise<StopResult>
  on(event: "added" | "updated" | "removed", cb): Unsubscribe
}
```

### Discovery wiring

1. `agent.ts` `trackBashToolEntry` — when a tool call has `input.run_in_background === true`, register on the matching tool result, parse the SDK shell descriptor for `shellId` and `pid`. Update `lastOutput` from later events.
2. The existing `drainingStreams.set` becomes a thin wrapper that also calls `registry.register`. `stopDraining` unregisters.
3. `TerminalManager` registers on spawn, unregisters on exit.
4. `CodexAppServerManager` registers on session start, unregisters on shutdown.

### Stop semantics

| Kind | Strategy |
|---|---|
| `bash_shell` | SIGTERM, 3s grace, then SIGKILL. Use SDK `KillBash` if available; otherwise `process.kill(-pid, "SIGTERM")` on the process group. |
| `draining_stream` | `turn.close()` (existing). |
| `terminal_pty` | `TerminalManager.kill(ptyId)` — graceful HUP/TERM, then KILL. |
| `codex_session` | `CodexAppServerManager.shutdown(chatId)` — already gentle. |

### Persistence + orphan recovery

Only `bash_shell` survives a Kanna restart (PTYs and codex sessions die with their parent). On registry mutation, debounce 500ms, atomic-write `~/.kanna/state/orphan-pids-<port>.json`:

```ts
type PersistedTask = {
  id: string
  pid: number
  command: string
  chatId: string | null
  startedAt: number
}
```

On boot:
1. Read the file.
2. For each entry, `process.kill(pid, 0)` — drop on `ESRCH`.
3. For survivors, register as `bash_shell` with `orphan: true`.
4. Rewrite file with surviving entries.
5. Broadcast snapshot.

Atomic write: temp file plus rename. Path keyed by port to keep multiple Kanna instances from killing each other's processes.

### Shutdown

`SIGTERM` / `SIGINT` handler in `cli.ts`:
- Persist final orphan list.
- Do **not** kill `bash_shell` entries — survival is intentional.
- Gracefully close PTYs (HUP), codex sessions (`shutdown`), draining streams (`turn.close`).

### Edge cases

| Case | Behavior |
|---|---|
| Chat deleted while bash shell alive | Entry stays. `chatId` becomes null. Label switches to "orphaned (chat deleted)". Stop still works. |
| PID reused by unrelated process | Before kill, verify `comm` (`/proc/<pid>/comm` on Linux, `ps -p pid -o comm=` cross-platform). Mismatch → drop entry, no kill, surface a toast. |
| SIGTERM ignored after 3s | UI swaps in a `Force kill` button. SIGKILL on confirm. |
| User stops draining stream during turn | Existing `stopDraining` path; now also unregisters. |
| > 50 tasks at once | Dialog list virtualizes (windowed render). Render budget < 16ms under 200 rows. |
| Multiple Kanna instances | Orphan file path keyed by listening port. |
| Tunnel mobile client | Same WS channel, sheet variant. |

### WebSocket protocol

New channel `bg-tasks:list` (subscribe → snapshot, then diffs). New command `bg-tasks:stop { id, force?: boolean }` returning `{ ok, error? }`.

### Telemetry

`analytics.ts` events, no PII (no command content):
`bg_task_registered { kind }`, `bg_task_stopped { kind, ageMs, force }`, `bg_task_orphan_kept { count }`, `bg_task_orphan_killed { count }`. Respect existing opt-out.

## UI / UX (impeccable, product register)

### Theme + color

Scene: solo dev at 11pm on a 27-inch monitor, five chats open, three background tasks ticking, wants to glance at the list and stop a forgotten dev server in one keystroke without leaving flow.

That sentence forces calm, low-stim, warm-tinted neutrals. Auto theme follows existing `useTheme`. **Restrained** color strategy. One accent for the running state — warm amber `oklch(0.74 0.12 70)`: not green, not red; states *attention available* without alarming or congratulating. Destructive (force-kill) uses a single solid red. No gradients, no glow, no glassmorphism. All neutrals tinted toward warm hue (chroma 0.005 to 0.01).

### Surface placement

Two surfaces, one Zustand store (`backgroundTasksStore`):

1. **Navbar indicator** in `ChatNavbar.tsx`. Small dot plus count, e.g. `● 3`. Dot is amber when ≥ 1 running, neutral when 0. Project `Tooltip` (not native `title`) on hover: *"3 background tasks · ⌘⇧B"*. Click opens dialog. No badge ring, no pulse.
2. **Background Tasks dialog** (shadcn `Dialog`). Width ~720px desktop, full-screen sheet on mobile. Keyboard: `⌘⇧B` open, `Esc` close, `↑/↓` navigate rows, `Enter` expand, `⌘.` stop focused row.

### Dialog anatomy

```
┌─ Background tasks ─────────────────────  3 running   ─┐
│                                                       │
│  bun run dev                              2m 14s   ⏵ │
│  bash · chat: feat/timings · started 11:02      ⏹    │
│                                                       │
│  pnpm test --watch                       18m 03s   ⏵ │
│  bash · chat: bg-tasks design · started 10:46   ⏹    │
│                                                       │
│  PTY: zsh                                 4h 12m   ⏵ │
│  terminal · /Users/cuongtran/repo/kanna         ⏹    │
│                                                       │
└───────────────────────────────────────────────────────┘
```

Two-line rows. Line 1: command/label (mono, 14px, weight 600) plus age (mono, 13px, weight 500, `tabular-nums`, right-aligned). Line 2: type tag, chat link, started time (sans, 12px, muted) plus stop icon button on the right. Expand chevron `⏵` reveals the last 12 lines of output (mono, 12px, line-height 1.55, scrollable, max 240px).

Dialog title is editorial: weight 500, 18px, letter-spacing -0.01em, sentence case. No icon prefix.

### Motion

- Row enter: opacity 0→1, translateY 4px→0, 180ms ease-out-quart. 24ms stagger across rows. Disabled under `prefers-reduced-motion`.
- Stop confirm: row label crosses out 220ms; age freezes; row fades to muted 320ms before unmount.
- Navbar dot: **static**. No pulse, no glow. Color presence carries the signal.
- Dialog open: scale 0.98→1 plus opacity 0→1, 160ms. No backdrop blur.

### Stop interaction

Inline confirm, never a nested modal:

1. Click stop icon → icon swaps to `Confirm stop?` text button plus `Cancel` ghost (180ms slide-in from right). Other rows dim.
2. Confirm → row enters `stopping` state (status text replaces age, `stopping…`). 3s grace. On exit → row fades out. On timeout → red `Force kill` text button appears in the same slot.
3. `Esc` cancels confirm. Single-row scope; never affects other tasks.

### Empty state

Body shows one editorial sentence, left-aligned, no illustration, no centered icon: *"No background tasks. Anything an agent leaves running here will appear so you can stop it."*

### Orphan-on-boot

Not a modal. A section header at the top of the dialog when present:

```
Found from previous session                                    [Kill all]
  bun dev · pid 48213 · last seen 2h ago                          ⏹
```

User opens the dialog naturally on next session, or via a boot toast: *"3 processes survived restart · review"*. No auto-kill, no surprise dialog interrupting work.

### Mobile variant

Bottom sheet, full width, same anatomy stacked tighter: line 1 command + age, line 2 type + chat, line 3 stop button full-width. Swipe-left exposes stop. Long-press shows full command (replaces the desktop tooltip).

### Accessibility

- Focus rings on every interactive element, never `outline: none` without replacement.
- All actions reachable from keyboard, including stop and force-kill.
- Color is never the only signal: status word + icon shape always pair with color.
- Voice-over reads "Stop bun run dev, running 2 minutes 14 seconds".
- Tabular numerics for age and pid columns.
- Body contrast ≥ 7:1; large text ≥ 4.5:1; never below AA.

## Testing

### Server (`bun test`)

`background-tasks.test.ts`:
- register / update / unregister emit events in order.
- `listByChat` filters correctly.
- stop `bash_shell`: spawn a toy script that traps SIGTERM, verify SIGTERM sent, 3s grace honored, SIGKILL after.
- `force: true`: SIGKILL immediate.
- PID-reuse guard: spawn, capture pid, kill, spawn unrelated `sleep`, attempt stop on the original id → drops without killing the innocent pid.
- Concurrent stops on the same id: idempotent.

`agent.test.ts` extensions:
- Bash tool with `run_in_background: true` → registry has entry on tool_result.
- Draining stream lifecycle → register on insert, unregister on `stopDraining`.
- Chat delete → `bash_shell` entries flip `chatId` to null but stay registered.

`orphan-persistence.test.ts`:
- Write then re-read restores entries.
- Stale pid dropped on boot.
- Corrupted JSON → ignored, fresh start, error logged.
- Atomic write: simulate crash mid-write, file still valid.

### WS router (`ws-router.test.ts` extension)

- Subscribe `bg-tasks:list` → snapshot then diffs.
- `bg-tasks:stop` command routes to registry, returns result.
- Unauthorized stop (id not in registry) → error response, no crash.

### Client (co-located, kanna-react-style)

- `BackgroundTasksDialog.test.tsx`: rows render, age formats via `formatters.ts`, stop click → confirm state → stop dispatched. `⌘.` stops focused row. `Esc` closes.
- `ChatNavbar.test.tsx`: dot color toggles with count. Tooltip uses the project `Tooltip`, not native `title`.
- Snapshot-stable rendering: freeze `Date.now`, assert no layout jitter across age ticks.
- `prefers-reduced-motion` → enter animation disabled.

Test subprocess hygiene per `CLAUDE.md`: any `git` or process spawn in tests must set `stdin: "ignore"` and `GIT_TERMINAL_PROMPT=0`.

### Manual / smoke

- Start dev server via agent, dialog row appears.
- Stop from dialog → `pgrep -f` confirms gone.
- Restart Kanna → orphan section appears with surviving pid.
- Mobile viewport: sheet variant, swipe-left stop.
- macOS VoiceOver reads row label and status correctly.
- Lighthouse contrast checks pass AAA on body text.

## Out of Scope (YAGNI)

- Full log streaming inside the dialog (last 12 lines only; full logs via "View output" into existing terminal pane).
- Grouping by project or by chat (flat list with type column).
- Restart-task action (stop only; restart stays user-driven via chat).
- Notification on task exit (existing chat transcript already records it).
- Cross-machine syncing of orphan state.

## Open Questions

- Does the Claude Agent SDK expose a stable `KillBash` for shells with `run_in_background: true`, or do we always need the PID path? Verify against current SDK docs before implementation.
- Where exactly to surface the boot toast? Candidates: existing notification system in `chatNotifications.ts`, or a new lightweight top-of-app banner. Decide during implementation.
