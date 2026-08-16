---
id: adr-20260816-builtin-cron-jobs
c3-seal: 237255298184a7d519e3d278512b5fa973fb9a7d8c7765a0309445c5712dba06
title: builtin-cron-jobs
type: adr
goal: 'Add a `/cron` builtin slash command that arms recurring scheduled instructions on a chat, with two run modes: `inline` (every fire runs in the arming chat with context cleared before each cycle, turning the chat into a monitoring view) and `spawn` (every fire creates a fresh chat in the same project and runs there, while the arming chat collects a live run card per fire). The decision covers the command grammar with hard field-level validation and ready-to-send corrected suggestions, event-sourced persistence on the existing auto-continue log, a recurring `CronScheduler`, skip-and-record overlap semantics, and management surfaces (per-chat footer panel, `/cron list|remove|pause|resume`, and a global `/cron` page across all projects).'
status: accepted
date: "2026-08-16"
---

# Builtin /cron jobs — scheduled instructions with inline and spawn run modes

## Goal

Add a `/cron` builtin slash command that arms recurring scheduled instructions on a chat, with two run modes: `inline` (every fire runs in the arming chat with context cleared before each cycle, turning the chat into a monitoring view) and `spawn` (every fire creates a fresh chat in the same project and runs there, while the arming chat collects a live run card per fire). The decision covers the command grammar with hard field-level validation and ready-to-send corrected suggestions, event-sourced persistence on the existing auto-continue log, a recurring `CronScheduler`, skip-and-record overlap semantics, and management surfaces (per-chat footer panel, `/cron list|remove|pause|resume`, and a global `/cron` page across all projects).

## Context

Kanna already had one-shot auto-continue schedules (rate-limit resume) and notification-driven loops, but no way to run an instruction on a wall-clock schedule ("check CI every 5 minutes", "daily report at 09:00"). Users had to keep a terminal cron or re-type prompts. The constraint set: builtin commands must be parseable exactly as advertised (drift guard in `src/shared/builtin-commands.ts`); durable per-chat state must be event-sourced on the auto-continue JSONL log so it survives restart (the `loop_armed` pattern); the side-effect seal forbids IO in `src/shared/**`; and a mistyped schedule must never reach the model as prompt text — requirement one of the feature is hard validation with self-correction suggestions. The affected topology is the server container's auto-continue component (the event log the cron events ride), plus three new components: a shared cron domain (grammar, schedule parsing, humanizer, snapshots), a server cron feature (scheduler, fire paths, read model, command handlers), and the client cron UI (transcript cards, footer panel, global page).

## Decision

`/cron` is a builtin that ALWAYS intercepts — unlike `/clear`'s whole-message-or-fallthrough rule — because an invalid arm line must surface a structured `cron_command_error` transcript entry carrying a complete, re-parse-guaranteed corrected command, never fall through as a prompt. The arm grammar anchors on the LAST `inline`/`spawn` token so instructions need no quoting. Schedules accept 5-field cron, `@shortcuts`, and `every Nm|Nh` interval sugar; intervals stay anchor-based (arm time + k*ms) and are deliberately not rewritten to cron fields. Per user decision, cron OCCURRENCE semantics are owned by the `cron` npm package (kelektiv/node-cron): `CronSchedule` carries the canonical 5-field expression and the server-only `next-fire` module delegates to `CronTime.getNextDateFrom` (verified strictly-after, vixie day OR rule, bounded-search throw on impossible dates mapped to null); the parser stays custom because the suggestion UX needs structured per-field diagnostics the library cannot provide, and luxon stays out of the client bundle because clients only render the server-computed `nextFireAt`. Seven `cron_*` event kinds ride the existing auto-continue event stream (`scheduleId` doubles as job id, the `loop_armed` trick); a sibling `CronScheduler` (not an extension of the one-shot `ScheduleManager`) re-arms after every fire with 6-hour-chunked wall-clock-recomputed timeouts, and rehydrate SKIPS fires missed while the server was down, reporting one visible `server_offline` skip per job. Overlap is skip-and-record with a self-heal: a run still marked running whose chat is demonstrably idle settles as failed(orphaned). Run outcomes are attributed through a settable `onTurnTerminal` observer on `EventStore.recordTurn{Finished,Failed,Cancelled}` — the single choke point all provider finalize paths funnel through — keyed by a `CronRunTag` that rides the queued message onto the ActiveTurn.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-227 | component | The cron_* event kinds ride its auto-continue JSONL log and replay through the same stream; its Contract gains the cron events surface, and its ScheduleManager gains no-op cases for the new kinds | c3-227#n10290@v1:sha256:f7affc2f6d825317e70bae8aa9faf9b19807849a5a39d911e467d871264b9fdd "Auto-continue events" | Event-sourcing ref: all cron mutations land as events first, replayable on boot |
| c3-2 | container | Gains the new cron-scheduler feature component (scheduler, fire paths, read model, command handlers, WS commands + global topic) | c3-2#n8837@v1:sha256:87984e312939cc03eed326c220cafc5c1bc82c40e789678100477a162a4901ce "Run the local Bun backend: serve HTTP+WebSocket on localhost, coordinate Claude + Codex agent turns, persist events, and broadcast derived read models." | Side-effect seal: timers via injected Clock, no direct IO outside adapters |
| c3-3 | container | Gains the new cron-domain shared component (grammar parser, schedule parser, humanizer, snapshot types) | c3-3#n10640@v1:sha256:14758c535c5f7fc755f25004ead7b6d64058321bc3599252e111f640e63dc53e "Publish the wire protocol, core domain types, tool-call normalization, port and branding config that both client and server import — a thin seam that keeps th" | Pure-shared rule: no IO, importable from client and server |
| c3-1 | container | Gains the new cron-ui client component (six transcript cards, footer panel, global management page, sidebar entry) | c3-1#n8055@v1:sha256:e6ee951578f4d61705ac19fe636ff75594655216f900a12ae302ea0a1d8607a8 "Render the chat experience: hydrate transcripts, accept input, drive sidebar/settings, and stay synchronized with server state via WebSocket subscriptions." | Design-system gate + stable-selector rules for the new stores/components |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Hand-rolled next-occurrence calendar math (originally implemented) | User explicitly chose to adopt node-cron as the occurrence authority to avoid maintaining vixie DOM/DOW, DST, and month-length semantics in-repo; the behavioral test table was kept and now pins the library instead |
| Extending ScheduleManager for recurrence | Its one-shot pendingByScheduleId lifecycle and never-checked event switch fit accept/cancel/fired semantics; recurrence, pause state, and re-arm-after-fire would complicate every existing invariant — a sibling with the same Clock is cleaner |
| Global cron registry in settings.json | Per-chat event sourcing reuses the existing durable log, replay, and chat-delete cascade; settings.json would add a second source of truth and a new CRUD surface for state that is inherently chat-scoped |

## Verification

| Check | Result |
| --- | --- |
| bun run test | 6022 pass, 0 fail (495 files) including 140+ cron-specific tests: grammar drift guard (every suggestion re-parses), next-fire behavioral table (vixie OR, leap years, Feb-30 null), FakeClock scheduler recurrence/chunking/rehydrate, fire-path overlap + orphan self-heal, dispatch, read-model folds |
| bun run lint && bun run lint:usestate && bunx ast-grep test | Clean at --max-warnings=0; no design-gate, side-effect-seal, or stable-selector violations |
| bun run typecheck | Clean on TS7 |
| Manual golden path | Arm inline every-5m job, watch clear+run+monitoring entries; arm spawn job, new chat + live run card; /cron list, pause/resume/remove; server restart re-arms with server_offline skip notice; invalid commands surface field-level error + copyable suggestion |
