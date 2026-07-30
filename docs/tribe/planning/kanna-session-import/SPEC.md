# SPEC — Single-Session Import by UUID + Live Tribe Runner Visualization

Version: 3 (ground truth — supersedes `docs/plans/2026-07-30-single-session-import-and-tribe-visualization.md` in the kanna repo)
Date: 2026-07-30
Owner ruling: any design acceptable as long as the existing import-all flow is not broken.

## 1. Problem

Kanna's only import gesture is all-or-nothing: `sessions.importClaude` (no
args, `src/shared/protocol.ts:90`) walks every `~/.claude/projects/*/*.jsonl`,
reads + MD5-hashes each file, imports all (`ws-router.ts:1602` →
`importClaudeSessions` in `src/server/claude-session-importer.adapter.ts`).
Import is snapshot-only: no watcher exists; refresh = manual re-click + full
rescan.

The Tribe plugin's Campaign Orchestration Runner
(`/Users/home/repos/todd-skills/plugins/tribe/scripts/runner/`) spawns
headless Agent-SDK sessions that ARE on disk (SDK `persistSession` defaults
true → `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`; cwd is always the
target repo root, `core/session.ts:97`). The runner records every
SDK-assigned session id in the campaign state JSON (`Card.sessionId`,
crash-safe on first `system/init` message) and in log filenames
`<home>/runs/<run-id>/logs/<card>-<sessionId>.log`. Hunter/Skinner workers are
Task-tool subagents whose transcripts are sidecars at
`<dir>/<sessionId>/subagents/agent-<agentId>.jsonl`. Cards run strictly
sequentially — one top-level session at a time.

## 2. Target UX

Sidebar Import button opens a dialog (replaces the bare confirm):

- **Paste one or many session ids** (textarea; splits on whitespace / commas /
  newlines; tolerates `<uuid>.jsonl` and full paths — UUIDs extracted) →
  **Import sessions** → imports each, navigates to the (first) imported chat.
  A session whose file changed recently opens **live-tailing** with a visible
  "following" pill; older sessions open static.
- **Empty input → Import all** — the existing bulk flow, byte-for-byte.
- Per-id errors inline: invalid id, `not_found`, `cwd_missing`, `parse_failed`.
- Re-pasting an imported id: unchanged → opens existing chat; grown →
  delta-append then open (doubles as manual refresh and tail re-arm).
- Active-session warning in dialog copy: sending a message in a followed chat
  takes over the session and stops following (runner-owned sessions are
  view-only by convention).
- Multi-paste IS the campaign bridge UX: a Tribe-side script copies all
  `Card.sessionId`s to the clipboard; the user pastes the whole list.

Continue-in-Kanna needs no new code: import stores
`sessionTokensByProvider.claude = <uuid>`; the next turn resumes via SDK
`resume:` / PTY `--resume` (`agent.ts:2449-2482`,
`claude-pty/driver.ts:287-297`).

## 3. Architecture

```
Foundation (serial, PR A):
  F1 importOneSession(store, session)  — extracted from bulk loop, both paths call it
  F2 extractSessionId (pure, shared) + locateClaudeSessionFile (adapter, O(#dirs) stats)
  F3 sessions.importClaudeSession { sessionIds: string[] } command + handler
     + optional onSessionImported(info) callback seam (no-op until PR C)

Parallel fan-out (after PR A):
  WS-UI    (PR B, kanna)      ImportSessionsDialog + navigate
  WS-Live  (PR C, kanna)      FollowedSessionRegistry: stat-poll tick → delta import
  WS-Drill (PR D, kanna)      lazy-derive subagents dir for imported chats → Tier-2 drill-in
  WS-Bridge(PR E, todd-skills) session-id extraction script (clipboard)

Join: E2E (Tribe-shaped fixture) after B+C; docs + c3 change apply on last kanna PR.
```

Key decisions (rationale in INDEX.md decision log):

- **D1 — Array command.** `sessionIds: string[]` one-or-many. Kanna stays
  Tribe-agnostic; the dialog's multi-paste replaces any WS bridge client.
- **D2 — Live by default.** Single-import auto-arms tailing when source mtime
  is within `KANNA_IMPORT_FOLLOW_ACTIVE_WINDOW_MS` (default 600000). Bulk
  import never tails.
- **D3 — Sibling read-model for tail.** `FollowedSessionRegistry` mirrors the
  WorkflowRegistry disk-watch precedent: stat-poll (tick driver, default
  2000 ms `KANNA_IMPORT_FOLLOW_POLL_MS`), on growth re-parse + delta via
  `importOneSession` (idempotent by row-UUID dedupe). Entries reach clients
  through the normal event-store append → snapshot broadcast. NEVER touches
  the live HarnessEvent/turn pipeline (c3-225).
- **D4 — Single writer.** Tail pauses while a Kanna turn is active on the
  chat and stops **permanently** on user takeover (chat.send). PTY resume may
  mint a NEW session file — the old tail must never re-arm after takeover.
  Idle stop after `KANNA_IMPORT_FOLLOW_IDLE_MS` (default 600000). State not
  persisted; re-paste re-arms (crash-simple).
- **D5 — Lazy drill registration.** For imported chats,
  `subagent-transcript-registry` has no live-driver registration; the ws
  handler lazily derives `<computeProjectDir(cwd)>/<sessionId>/subagents`
  (helpers in `src/server/claude-pty/jsonl-path.adapter.ts`) and registers on
  first drill-in request. Survives restart with zero persistence.
- **D6 — Outcome type.** `importOneSession` returns
  `{status:"created",chatId,newProject} | {status:"updated",chatId} |
  {status:"skipped",chatId?} | {status:"failed",reason:"cwd_missing"|"store_error"}`;
  the bulk loop maps outcomes onto its existing counters so
  `ImportClaudeSessionsResult` and all existing tests stay unchanged.

## 4. Walls (anti-goals — every PR gates on all of them)

| Wall | Metric | Type |
| --- | --- | --- |
| Import-all unchanged | Existing importer/scanner/parser/mapper suites pass **unmodified**; `sessions.importClaude` behavior identical | tripwire |
| Side-effect seal | `bun run lint` green — new IO only in `*.adapter.ts` | tripwire |
| Turn-pipeline isolation | Followed/imported entries never enter the live HarnessEvent pipeline (c3-225) | tripwire (review+test) |
| Single writer | Tail never appends during an active Kanna turn; permanent stop on takeover — proven by registry tests | tripwire |
| Suite green | `bun run test` (`--conditions production`) before every push | tripwire |

Flags: `cannot` (locator unreliable → redesign), `breaking` (any wall fails →
stop), `pointless` (shipped but Tribe watching still inconvenient → re-aim).
Frame changes are owner-only.

## 5. Known risks

- **Dual writers on resume** — mitigated by D4 + dialog warning; runner-owned
  sessions documented view-only.
- **Drill registry fit** — mitigated by spike-first task in PR D; fallback is
  an on-demand read path in the ws case (no registry).
- **Parallel-PR merge friction** — confined to F3's callback seam and one ws
  case per PR; PR A merges first.
- **C3 drift to fix in the ADR** (found in research): c3-214 cites
  `src/server/discovery.ts` (real file: `discovery.adapter.ts`) and a
  nonexistent filesystem watch; importer/scanner adapters are codemap gaps.

## 6. Evidence plan (definition of done)

- Dialog before/after screenshots; a real Tribe campaign session imported by
  UUID visibly growing (following pill on); drill-in screenshot of a Hunter
  child transcript (PR D).
- Test + lint output per PR body; §4 walls checked per PR; merged per repo
  definition of done, then `verify-shipped` per PR.
