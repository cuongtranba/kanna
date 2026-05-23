---
id: adr-20260523-pty-instances-status-panel
c3-seal: 139e4cea0a52d79b99365fb6b9f3b67838f17b5f005d6d98b6920074f7bce039
title: pty-instances-status-panel
type: adr
goal: |-
    Add a user-facing surface in the Kanna client that lists every live `claude`
    PTY child (only relevant when `KANNA_CLAUDE_DRIVER=pty`) with its full
    runtime status — identity (pid, sessionId, chat, cwd, model, OAuth account
    label), lifecycle phase, live counters (turns, tokens, last-event age),
    and health/debug fields (smoke-test result, plan-mode flag, masked token,
    output-ring tail) — backed by a live WebSocket push channel, and supports
    per-row actions: open chat, cancel turn, kill process. The decision being
    authorized is: (a) introduce a single in-memory `PtyInstanceRegistry` as
    the canonical aggregator of PTY runtime state, (b) extend the WS protocol
    with a `pty:*` subscription family, (c) ship a `PtyStatusBadge` +
    `PtyInstancesPopover` in the app shell.
status: proposed
date: "2026-05-23"
---

# pty-instances-status-panel

## Goal

Add a user-facing surface in the Kanna client that lists every live `claude`
PTY child (only relevant when `KANNA_CLAUDE_DRIVER=pty`) with its full
runtime status — identity (pid, sessionId, chat, cwd, model, OAuth account
label), lifecycle phase, live counters (turns, tokens, last-event age),
and health/debug fields (smoke-test result, plan-mode flag, masked token,
output-ring tail) — backed by a live WebSocket push channel, and supports
per-row actions: open chat, cancel turn, kill process. The decision being
authorized is: (a) introduce a single in-memory `PtyInstanceRegistry` as
the canonical aggregator of PTY runtime state, (b) extend the WS protocol
with a `pty:*` subscription family, (c) ship a `PtyStatusBadge` +
`PtyInstancesPopover` in the app shell.

## Context

Today PTY mode is opaque from the UI. Driver state is split across
`ClaudePtyRegistry` (on-disk reap registry; chatId/sessionId/pid/cwd only),
`pid-registry.adapter.ts`, ad-hoc fields inside `driver.ts`, and
transcript JSONL files. There is no aggregate view of live children, no
phase enumeration (`spawning|trust|ready|streaming|cancelling|exited`),
no token counters surfaced to the client, and no way for a user to cancel
or kill a stuck PTY without restarting the server. With multiple chats
running in PTY mode simultaneously (subagent delegation chains, multiple
projects) the user has no situational awareness. Affected topology:
c3-225 (claude-pty-driver) owns the spawn lifecycle; c3-208 (ws-router)
multiplexes the channel; c3-110 (app-shell) hosts the status surface;
c3-302 (protocol) defines the wire envelope. Constraints: must obey
ref-strong-typing on the wire, ref-side-effect-adapter in the server
layer, rule-zustand-store and rule-colocated-bun-test on the client.

## Decision

Introduce `PtyInstanceRegistry` (pure in-memory, no IO, no adapter file)
in `src/server/claude-pty/pty-instance-registry.ts`. Driver emits
lifecycle transitions and counter deltas to it; ws-router subscribes
sockets and broadcasts snapshot + delta envelopes. Client `pty-instances`
zustand store mirrors registry state via the existing WS multiplexer.
App-shell renders `<PtyStatusBadge/>` (compact: dot + count) which opens
`<PtyInstancesPopover/>` (radix popover) with one row per instance.
Chosen because: (1) the in-memory registry is the smallest aggregator
that matches c3-225's existing per-spawn lifecycle and avoids polluting
the on-disk reap registry with transient runtime fields; (2) WS push
reuses the protocol already governed by ref-ws-subscription; (3) status
bar dropdown keeps the surface out of the sidebar (sidebar is project-
first by c3-111's contract) and visible from every route.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-225 | component | Driver emits phase transitions + counter deltas; new actions cancel/kill route through driver handles | Review Contract row for new emit surface |
| c3-208 | component | New pty:* command routes + delta fan-out | Review Contract row for new WS surface |
| c3-110 | component | Hosts new status badge in shell chrome | Review Contract row for new shell slot |
| c3-302 | component | New WS envelope types pty:snapshot/delta/subscribe/cancel/kill | Review Contract row for new wire types |
| c3-1 | container | New child component pty-instances-panel will be added under this container | Update Components + Responsibilities rows |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-strong-typing | All new WS envelopes cross the client/server boundary | comply |
| ref-side-effect-adapter | Registry is pure in-memory; no IO. Any disk/process touch must remain in existing .adapter.ts files | comply |
| ref-ws-subscription | New pty:* family rides the single typed WS | comply |
| ref-zustand-store | Client store for instance list | comply |
| ref-event-sourcing | Registry is derived runtime state, NOT persisted; transcript events remain the source of truth for replay | comply |
| ref-colocated-bun-test | All new files get sibling .test.ts(x) | comply |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-strong-typing | New PtyInstanceState, PtyInstanceDelta, WsPty* types cross boundaries | comply |
| rule-zustand-store | Client store must return stable EMPTY ref per render-loop regression rule in CLAUDE.md | comply |
| rule-colocated-bun-test | All new modules ship .test.ts(x) next to source | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Server registry | New src/server/claude-pty/pty-instance-registry.ts exposing snapshot(), subscribe(fn), upsert(chatId, patch), remove(chatId) | pty-instance-registry.ts + pty-instance-registry.test.ts |
| Driver hook | driver.ts reports phase transitions on spawn/trust-dismiss/ready/cancel/exit + token/turn counters from jsonl-to-event | driver.ts diff |
| Protocol types | Add WsPtyInstanceState, WsPtySnapshot, WsPtyDelta, WsPtyCancelCommand, WsPtyKillCommand, WsPtySubscribeCommand discriminated unions | src/shared/protocol.ts |
| WS router | Route new commands; fan out snapshot on subscribe + deltas on registry change | src/server/ws-router.ts |
| Client store | src/client/state-stores/pty-instances-store.ts with stable EMPTY ref + useShallow selectors | pty-instances-store.ts + .test.ts |
| Status badge | src/client/components/pty-status-badge.tsx in app shell footer | pty-status-badge.tsx + .test.tsx |
| Popover | src/client/components/pty-instances-popover.tsx with row, pills, action buttons + kill-confirm dialog | pty-instances-popover.tsx + .test.tsx |
| Component doc | New c3-1-client/c3-119-pty-instances-panel.md wired to c3-1 | c3x add component |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| New component card | c3x add component pty-instances-panel --container c3-1 with Goal/Contract/ParentFit filled per schema | c3x read c3-119 |
| c3-225 Contract row | Add new OUT surface "PtyInstance lifecycle deltas" pointing to registry | c3x write c3-225 --section Contract |
| c3-208 Contract row | Add new IN surface "pty:* command routing" | c3x write c3-208 --section Contract |
| c3-302 Contract row | Add new "WsPty* envelope family" surface | c3x write c3-302 --section Contract |
| c3-110 Contract row | Add new "PTY status badge slot in shell chrome" | c3x write c3-110 --section Contract |
| c3x check | Re-run after every mutation; must remain green | c3x check exit 0 |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| pty-instance-registry.test.ts | Asserts upsert/remove/subscribe semantics, no leaks | bun test src/server/claude-pty/pty-instance-registry.test.ts |
| driver.test.ts | Asserts driver emits phase transitions in expected order | bun test src/server/claude-pty/driver.test.ts |
| ws-router.test.ts | Asserts pty:subscribe → snapshot + later deltas, cancel/kill routed to registry | bun test src/server/ws-router.test.ts |
| pty-instances-store.test.ts | renderForLoopCheck asserts no React error #185 | bun test src/client/state-stores/pty-instances-store.test.ts |
| pty-instances-popover.test.tsx | Asserts row render, action buttons wired, kill requires confirm | bun test src/client/components/pty-instances-popover.test.tsx |
| bun run lint | Side-effect lint rejects any new IO outside .adapter.ts; ratchet stays at 0 | bun run lint --max-warnings=0 |
| c3x check | Validates topology + refs/rules | c3x check |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Persist runtime status in event store as new event kind | Adds event volume per token delta, pollutes replay log, breaks ref-event-sourcing intent (events are user-visible turn state, not process metrics) |
| Reuse ClaudePtyRegistry (on-disk reap registry) | That registry is fsync-on-write for crash recovery; per-token writes would thrash disk and conflate "alive across restart" with "live runtime" |
| Sidebar section instead of status-bar badge | Sidebar contract (c3-111) is project-first navigation; PTY ops view is global cross-project state and doesn't belong in project navigation |
| Poll /api/pty/instances every 1s | Wastes WS multiplexer already governed by ref-ws-subscription; latency higher than push; user explicitly chose live push |
| Server-Sent Events channel | Duplicates transport; we already have one typed WS per ref-ws-subscription |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Token-delta storm overwhelms WS | Coalesce counter deltas at 100 ms trailing edge in registry before broadcast | Unit test asserts ≤ 1 delta per 100 ms window under burst |
| Kill action races driver cleanup leaving zombie | Kill routes through driver's existing SIGTERM→SIGKILL escalation path (5 s grace) | driver.test.ts kill-from-registry case |
| Stable EMPTY ref violated → render loop | Use module-scope const EMPTY: PtyInstanceState[] = [] per CLAUDE.md rule | renderForLoopCheck assertion |
| Subagent chains spawn many PTYs and clutter popover | Group child PTYs under parent run id; collapse by default | Visual review + popover test asserts grouping |
| Plan-mode flag drift if user toggles via Shift+Tab in TUI | Surface "unknown" state explicitly, mirroring driver warning path | popover renders "plan: unknown" when flag false but TUI may differ |

## Verification

| Check | Result |
| --- | --- |
| bun run lint --max-warnings=0 | exit 0 |
| bun test | all green |
| bun test src/server/claude-pty/pty-instance-registry.test.ts | green |
| bun test src/client/components/pty-instances-popover.test.tsx | green |
| c3x check | exit 0, no drift |
| Manual smoke: start two chats with KANNA_CLAUDE_DRIVER=pty, open popover | both rows visible, phase advances ready→streaming→ready, cancel + kill buttons act on correct row |
