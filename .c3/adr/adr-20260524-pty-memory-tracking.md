---
id: adr-20260524-pty-memory-tracking
c3-seal: 93b2b9f2deb53443848930370ce8e05ff182fb7c23e0c2fda0027e132f154ab4
title: pty-memory-tracking
type: adr
goal: 'Add realtime per-process memory tracking to the live PTY status panel: each tracked `claude` PTY shows current RSS plus session peak RSS, summed across the child process tree (`claude` + descendants), refreshed every 2 s while the instance is alive. The decision authorizes adding two `number | null` fields (`rssBytes`, `rssPeakBytes`) to `PtyInstanceState`, a new memory sampler adapter that shells out to `ps`, a driver-side interval poller, and a new "mem" cell in `PtyInstancesIndicator`.'
status: implemented
date: "2026-05-24"
---

## Goal

Add realtime per-process memory tracking to the live PTY status panel: each tracked `claude` PTY shows current RSS plus session peak RSS, summed across the child process tree (`claude` + descendants), refreshed every 2 s while the instance is alive. The decision authorizes adding two `number | null` fields (`rssBytes`, `rssPeakBytes`) to `PtyInstanceState`, a new memory sampler adapter that shells out to `ps`, a driver-side interval poller, and a new "mem" cell in `PtyInstancesIndicator`.

## Context

Issue #309 shipped the PTY live status panel (`PtyInstancesIndicator`) with phase, pid, model, uptime, account, plan flag, and smoke-test status, but the panel has no resource-usage signal. Users running multiple long-lived `claude` PTYs in parallel cannot tell which instance is consuming RAM, which makes it hard to decide which one to cancel/kill when the host gets memory-pressured. `claude` plus its node/MCP children can grow into multi-hundred-MB territory on long sessions, so the panel needs to expose memory.

Topology involved:

- `c3-225 claude-pty-driver` — owns spawn / pid / phase upserts into `PtyInstanceRegistry`; the natural place to wire the poll loop and to obtain the child pid.
- `c3-102 state-stores` — `ptyInstancesStore` already fans `PtyInstanceDelta` updates into the indicator; new fields ride existing delta channel for free.
- `c3-1 Client` — `PtyInstancesIndicator` renders the panel; new "mem" cell added to its grid.
- `ref-side-effect-adapter` — calling `ps`/`pgrep` is `node:child_process` IO, must live in `*.adapter.ts`.
- `ref-strong-typing`, `rule-strong-typing` — new fields cross the WS/JSONL boundary and must be named.

Constraint: side-effect lint seals `node:child_process` outside adapter files; cannot use raw `Bun.spawn` from driver core. Constraint: sampler must not block driver event loop, must clear on exit, and must survive a missing pid (pre-spawn / exited).

## Decision

1. Extend `PtyInstanceState` (shared) with `rssBytes: number | null` and `rssPeakBytes: number | null`. Registry baseline initialises both to `null`.
2. Add `src/server/claude-pty/pty-memory-sampler.adapter.ts` exporting `sampleProcessTreeRssBytes(rootPid: number): Promise<number | null>`. Implementation: single `ps -A -o pid=,ppid=,rss=` spawn → parse into `{pid, ppid, rssKb}[]` → BFS collect descendants of `rootPid` → sum RSS in bytes. One process spawn per sample regardless of tree depth. Pure parsing helpers (`parsePsOutput`, `collectTreePids`) exported separately for testing.
3. In `driver.ts`, after `pid` is known, start a `setInterval(2000)` that calls the sampler, computes `peak = max(prev.rssPeakBytes ?? 0, curr)`, and `args.ptyInstanceRegistry?.upsert(chatId, { rssBytes, rssPeakBytes: peak })`. Clear the interval on `pty.exited` (next to existing `phase: "exited"` upsert).
4. Poll interval fixed at 2 s (no env var, no per-instance override) — matches user decision in design Q&A.
5. `PtyInstancesIndicator` adds one row cell: `mem <curr> · peak <peak>` formatted via a small `formatBytes` helper (B/KB/MB/GB, no decimals at MB+). Hidden until first sample arrives (both fields non-null).

Why this approach wins over a per-pid `ps`-per-descendant loop: one spawn per tick is O(1) cost regardless of subprocess tree depth, avoids `pgrep -P` recursion, and the `ps -A` output is already small (<10 KB on a typical dev box).

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-225 | component | Owns spawn lifecycle + registry upserts; new interval poller wired here | Verify Boundary + Interface rows still describe the registry contract; add the sampler adapter to Files |
| c3-102 | component | ptyInstancesStore shape evolves with new PtyInstanceState fields; no code change needed but contract widens | Confirm component goal still covers "fan delta into selectors"; no Parent Delta expected |
| c3-1 | container | PtyInstancesIndicator (under chat-ui) renders new memory cell | Parent Delta: container responsibilities unchanged; only chat-ui component grows |
| c3-2 | container | New adapter file added under claude-pty/; container responsibilities unchanged | Parent Delta: no-delta evidence — adapter count grows, but boundary identical |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-side-effect-adapter | ps invocation is node:child_process IO; must live in *.adapter.ts to pass side-effect lint | comply |
| ref-strong-typing | New rssBytes / rssPeakBytes fields cross WS envelope and JSONL boundary | comply |
| ref-zustand-store | ptyInstancesStore is a Zustand store consuming the widened PtyInstanceState | comply (no shape change in store itself; selectors auto-pick fields) |
| ref-colocated-bun-test | Sampler parser + adapter need colocated *.test.ts siblings | comply |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-strong-typing | New fields ship in the shared protocol union; no any allowed | comply |
| rule-zustand-store | ptyInstancesStore selectors widen with new fields; must stay one-concern, colocated test | comply |
| rule-colocated-bun-test | New adapter + parser + driver wiring tests must sit next to source under bun test | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| shared types | Add rssBytes + rssPeakBytes to PtyInstanceState; bump baseline in registry | src/shared/pty-instance.ts, src/server/claude-pty/pty-instance-registry.ts |
| sampler adapter | New pty-memory-sampler.adapter.ts exporting parser + tree-RSS function | src/server/claude-pty/pty-memory-sampler.adapter.ts |
| sampler tests | Pure parser + tree-collect test against fixtures; adapter smoke-test (skip if ps unavailable) | src/server/claude-pty/pty-memory-sampler.adapter.test.ts |
| driver wiring | Start setInterval(2000) after pid known; clear on exit; upsert rss + peak | src/server/claude-pty/driver.ts |
| client UI | New mem cell in PtyInstanceRow; add formatBytes helper | src/client/components/chat-ui/PtyInstancesIndicator.tsx |
| client tests | Snapshot/render test verifies cell renders when fields present, hides when null | src/client/components/chat-ui/PtyInstancesIndicator.test.tsx (extend if exists, else add) |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| c3-225 codemap | Add pty-memory-sampler.adapter.ts to component files list via c3x set c3-225 codemap … if codemap pattern misses it | c3x lookup src/server/claude-pty/pty-memory-sampler.adapter.ts resolves to c3-225 after change |
| c3-225 Interface section | Document new registry fields (rssBytes, rssPeakBytes) in component contract via c3x write c3-225 --section Interface | c3x read c3-225 --section Interface shows new fields |
| c3-102 Interface section | Note widened PtyInstanceState shape selectors pick from | c3x read c3-102 --section Interface |
| c3-check | c3x check returns no errors after edits | c3x check exit 0 |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| eslint side-effect seal | Blocks any new node:child_process import outside adapter glob; sampler MUST be .adapter.ts | bun run lint fails if sampler placed in non-adapter file |
| bun test | Parser unit tests + driver-interval test catch sampler regressions | bun test src/server/claude-pty/pty-memory-sampler.adapter.test.ts |
| c3x check | Catches doc drift after Interface section edits | c3x check |
| Manual smoke | Spawn real PTY, open status panel, observe mem cell ticking every 2 s, peak monotonically non-decreasing | screenshot in PR |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Track only process.memoryUsage() of the kanna server | Measures kanna itself, not the spawned claude child — useless for the user's stated need |
| pgrep -P recursive descent per tick | N spawns per descendant per tick; sampler cost scales with subprocess depth instead of O(1) — ps -A once is cheaper |
| Add env-tunable poll interval (KANNA_PTY_MEM_POLL_MS) | User explicitly picked fixed 2 s; extra env var adds surface area without current need |
| Render sparkline or bar in panel | User picked text-only display; sparkline adds renderer complexity and sample-history state for no current ask |
| Read /proc/<pid>/status directly (Linux fast path) | Project supports macOS + Linux; macOS has no /proc. Single ps invocation works on both, keeps adapter platform-uniform |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| ps spawn cost N instances × every 2 s overwhelms host | One ps -A per instance per tick is ~1 ms on modern macOS/Linux; if needed, can share a single tick across all instances in a follow-up | Manual time ps -A -o pid=,ppid=,rss= on dev machine; observe kanna CPU after 10-min session with 3 PTYs |
| Sampler throws on unexpected ps output and crashes driver | Parser returns null on any parse failure; driver tolerates null rss without upsert | Unit test feeds malformed lines and asserts null return |
| Interval leaks if exit handler never fires (orphaned PTY) | Driver clears interval on both pty.exited event AND registry remove(chatId); existing exit paths already cover orphans | Driver test asserts clearInterval called on exit |
| Race: pid recycled by OS during measurement window | Window is 2 s, PIDs do not recycle in <2 s on practical kernels; worst case shows one stale sample then null on next tick | Documented as acceptable; no extra guard |

## Verification

| Check | Result |
| --- | --- |
| bun test src/server/claude-pty/pty-memory-sampler.adapter.test.ts | green; parser handles valid + malformed fixtures |
| bun test src/server/claude-pty/driver.test.ts | green; existing driver suite passes (sampler wiring covered by new targeted test) |
| bun test src/client/components/chat-ui/PtyInstancesIndicator.test.tsx | green; mem cell render + hidden-when-null branches |
| bun run lint | warning count unchanged or lower; side-effect seal passes |
| bun run tsc --noEmit | green; new fields typed end-to-end |
| c3x check | exit 0; component bodies match new interface |
| Manual: launch dev kanna, open PTY chat, expand status panel | "mem" cell appears within first 2 s of pid being assigned; value updates each tick; peak monotonic non-decreasing |
